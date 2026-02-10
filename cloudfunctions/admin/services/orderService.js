// cloudfunctions/admin/services/orderService.js
const cloud = require('wx-server-sdk');
const { 
  COL_ORDERS, 
  COL_SHOP_CONFIG,
  COL_CUSTOMERS, // [修正] 确保引入用户集合常量
  REFUND_CALLBACK_FN 
} = require('../config/constants');
const { now, moneyToFen, genOutRefundNo32 } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ... [listOrders, getOrder, updateOrderStatus, applyRefund 函数保持不变] ...
async function listOrders(tab, pageNum, pageSize) {
  const skip = (pageNum - 1) * pageSize;

  // 售后状态拆分：
  // - "进行中"：需要放在【售后】栏，便于集中处理
  // - "已处理"：放在【已完成】栏（包括拒绝/取消/退款成功等）
  const refundFinalStatuses = ['success', 'refunded', 'rejected', 'reject', 'cancelled', 'canceled'];
  // 这些状态表示售后已结束，但订单可能仍需继续履约（如拒绝/取消售后）
  const refundEndedButOrderContinues = ['rejected', 'reject', 'cancelled', 'canceled'];

  const buildQuery = (noRefundCond) => {
    if (tab === 'making') {
      return db.collection(COL_ORDERS).where(_.and([
        { status: _.in(['paid', 'making', 'processing']) },
        _.or([
          noRefundCond,
          { 'refund.status': _.in(refundEndedButOrderContinues) },
        ]),
      ]));
    }
    if (tab === 'ready') {
      return db.collection(COL_ORDERS).where(_.and([
        { status: 'ready' },
        _.or([
          noRefundCond,
          { 'refund.status': _.in(refundEndedButOrderContinues) },
        ]),
      ]));
    }
    if (tab === 'delivering') {
      return db.collection(COL_ORDERS).where(_.and([
        { status: 'delivering' },
        _.or([
          noRefundCond,
          { 'refund.status': _.in(refundEndedButOrderContinues) },
        ]),
      ]));
    }
    if (tab === 'refund') {
      // 售后栏仅展示“处理中”的售后：refund.status 不在已处理集合内
      return db.collection(COL_ORDERS).where(_.and([
        { refund: _.exists(true) },
        { 'refund.status': _.nin(refundFinalStatuses) },
      ]));
    }
    if (tab === 'done') {
      // 已完成：
      // 1) 普通已完成/已取消订单（无售后字段）
      // 2) 已处理完成的售后（refund.status 属于已处理集合）
      return db.collection(COL_ORDERS).where(_.or([
        _.and([{ status: _.in(['done', 'cancelled']) }, noRefundCond]),
        _.and([{ refund: _.exists(true) }, { 'refund.status': _.in(refundFinalStatuses) }]),
      ]));
    }
    return db.collection(COL_ORDERS).where(_.and([
      { status: _.in(['paid', 'making', 'processing']) },
      _.or([
        noRefundCond,
        { 'refund.status': _.in(refundEndedButOrderContinues) },
      ]),
    ]));
  };

  const fetch = async (noRefundCond) => {
    const query = buildQuery(noRefundCond);
    return await query.orderBy('createdAt', 'desc').skip(skip).limit(pageSize).get();
  };

  // Prefer exists(false) to match "field does not exist", fallback to eq(null) for portability.
  let res;
  try {
    res = await fetch({ refund: _.exists(false) });
  } catch (e) {
    res = await fetch({ refund: _.eq(null) });
  }

  return { ok: true, list: res.data || [] };
}
async function getOrder(key) {
  if (!key) return { ok: false, message: '缺少订单ID' };
  const res = await db.collection(COL_ORDERS).doc(key).get().catch(() => null);
  if (!res || !res.data) return { ok: false, message: '订单不存在' };
  return { ok: true, data: res.data };
}
async function updateOrderStatus(orderId, status, note, sess) {
  if (!orderId || !status) throw new Error('缺少参数');

  const updateData = {
    status,
    updatedAt: now()
  };

  if (status === 'ready') updateData.statusText = '待取餐';
  else if (status === 'delivering') updateData.statusText = '派送中';
  else if (status === 'done') {
    updateData.statusText = '已完成';
    updateData.doneAt = now();
  }

  await db.collection(COL_ORDERS).doc(orderId).update({ data: updateData });
  return { ok: true };
}
async function applyRefund(orderId, reason, remark, sess) {
    const nowTs = now();
    const order = await db.collection(COL_ORDERS).doc(orderId).get().then(r => r.data);
    if (!order) throw new Error('订单不存在');

    const refundDoc = {
        status: 'applied',
        statusText: '等待处理',
        reason: reason || '商家主动售后',
        remark: remark || '',
        source: 'merchant',
        appliedAt: nowTs,
        logs: [{ ts: nowTs, text: '商家发起售后申请' }]
    };

    await db.collection(COL_ORDERS).doc(orderId).update({
        data: { refund: refundDoc, updatedAt: nowTs }
    });
    return { ok: true };
}

/**
 * [核心修正] 修正事务 API 调用方式
 */
async function handleRefund(orderId, decision, remark, sess) {
  if (!orderId) throw new Error('缺少订单ID');
  if (!['approve', 'reject'].includes(decision)) throw new Error('无效的决定');

  const nowTs = now();
  let isWxPayRefund = false;
  let wxPayPayload = {};

  await db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection(COL_ORDERS).doc(orderId);
    const orderDoc = await orderRef.get();
    const order = orderDoc.data;
    
    if (!order) throw new Error('订单不存在');
    if (!order.refund || !['applied', 'pending'].includes(order.refund.status)) {
      throw new Error('当前状态无法处理售后');
    }

    const logEntry = {
      ts: nowTs,
      text: `商家 ${decision === 'approve' ? '同意' : '拒绝'} 售后。备注：${remark || '无'}`
    };

    if (decision === 'reject') {
      await orderRef.update({
        data: {
          'refund.status': 'rejected',
          'refund.statusText': '商家已拒绝',
          'refund.handleRemark': remark,
          'refund.handleAt': nowTs,
          'refund.logs': _.push(logEntry)
        }
      });
      return; // 事务内结束
    }
    
    // --- 同意售后 ---
    const refundAmount = Number(order.amount?.total || 0);

    if (refundAmount <= 0) {
      await orderRef.update({
        data: {
          'refund.status': 'success',
          'refund.statusText': '售后完成(0元)',
          'refund.handleRemark': remark || '0元订单，无需退款',
          'refund.handleAt': nowTs,
          'refund.refundedAt': nowTs,
          'refund.logs': _.push(logEntry)
        }
      });
      return; // 事务内结束
    }
    
    if (order.payment?.method === 'balance') {
      const userRef = transaction.collection(COL_CUSTOMERS).doc(order._openid);
      await userRef.update({
        data: { balance: _.inc(refundAmount) }
      });
      
      await orderRef.update({
        data: {
          'refund.status': 'success',
          'refund.statusText': '退款成功(已退回余额)',
          'refund.handleRemark': remark,
          'refund.handleAt': nowTs,
          'refund.refundedAt': nowTs,
          'refund.logs': _.push(logEntry)
        }
      });
      return; // 事务内结束
    }

    // 准备微信支付退款（在事务外执行）
    isWxPayRefund = true;
    const outRefundNo = `refund_${genOutRefundNo32()}`;
    wxPayPayload = {
        outTradeNo: order.orderNo,
        outRefundNo,
        totalFee: moneyToFen(refundAmount)
    };
    
    await orderRef.update({
      data: {
        'refund.status': 'processing',
        'refund.statusText': '退款处理中',
        'refund.handleRemark': remark,
        'refund.handleAt': nowTs,
        'refund.outRefundNo': outRefundNo,
        'refund.logs': _.push(logEntry)
      }
    });
  });

  // 如果是微信支付退款，在事务成功后执行
  if (isWxPayRefund) {
    const shopConfig = await db.collection(COL_SHOP_CONFIG).doc('main').get().then(r => r.data).catch(()=>({}));
    const subMchId = shopConfig.subMchId;
    if (!subMchId) throw new Error('商户号未配置，无法发起退款');

    try {
      await cloud.cloudPay.refund({
        subMchId,
        outTradeNo: wxPayPayload.outTradeNo,
        outRefundNo: wxPayPayload.outRefundNo,
        totalFee: wxPayPayload.totalFee,
        refundFee: wxPayPayload.totalFee,
        refundDesc: `售后退款：${wxPayPayload.outTradeNo}`,
        functionName: REFUND_CALLBACK_FN,
        envId: cloud.getWXContext().ENV
      });
      return { ok: true, message: '退款请求已提交' };
    } catch(e) {
      console.error('[handleRefund] cloudPay.refund failed:', e);
      await db.collection(COL_ORDERS).doc(orderId).update({
        data: {
          'refund.status': 'failed',
          'refund.statusText': '退款发起失败',
          'refund.logs': _.push({ ts: now(), text: `退款接口调用失败: ${e.message || '未知错误'}` })
        }
      });
      throw new Error(`退款发起失败: ${e.message || '请检查云后台日志'}`);
    }
  }

  return { ok: true };
}


async function orderUpdateWithLog({ id, patch, sess, action, note }) {
  await db.collection(COL_ORDERS).doc(id).update({
    data: {
      ...patch,
      updatedAt: now(),
      logs: _.push({
        action: action || 'update',
        ts: now(),
        note: note || '系统操作'
      })
    }
  });
  return { ok: true };
}


module.exports = {
  listOrders,
  getOrder,
  updateOrderStatus,
  applyRefund,
  handleRefund,
  orderUpdateWithLog,
  autoDoneKuaidiOrders: async () => ({ok: true})
};
