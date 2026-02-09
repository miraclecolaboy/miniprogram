// [New File] cloudfunctions/user/services/orderQueryService.js

const cloud = require('wx-server-sdk');
const { COL_ORDERS } = require('../config/constants');
const { now, formatTimeText, getTempUrlMap } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

async function _mapOrderForView(order) {
  if (!order) return null;

  const type = order.mode || 'ziti';
  const rawStoreSubMode = String(order.storeSubMode || '').trim();
  const storeSubMode = type === 'ziti'
    ? (['tangshi', 'ziti'].includes(rawStoreSubMode) ? rawStoreSubMode : 'ziti')
    : '';
  const storeSubModeText = storeSubMode === 'tangshi' ? '堂食' : (storeSubMode === 'ziti' ? '自提' : '');
  let status = order.status || 'processing';
  let statusText = order.statusText || '准备中';

  if (status === 'pending_payment') {
    statusText = '待支付';
  } else if (status === 'processing') {
    statusText = '准备中';
  } else if (status === 'ready') {
    statusText = '待取餐';
  } else if (status === 'delivering') {
    statusText = '派送中';
  } else if (status === 'done') {
    statusText = '已完成';
  } else if (status === 'cancelled') {
    statusText = '已取消';
  }

  const amount = order.amount || {};
  const vipDiscountNum = Number.isFinite(Number(amount.vipDiscount))
    ? Number(amount.vipDiscount)
    : Number(amount.discount || 0); // legacy
  const couponDiscountNum = Number.isFinite(Number(amount.couponDiscount))
    ? Number(amount.couponDiscount)
    : 0;
  const fee = {
    goods: Number(amount.goods || 0).toFixed(2),
    delivery: Number(amount.delivery || 0).toFixed(2),
    // legacy field used by old UI ("会员折扣")
    discount: vipDiscountNum.toFixed(2),
    vipDiscount: vipDiscountNum.toFixed(2),
    couponDiscount: couponDiscountNum.toFixed(2),
    total: Number(amount.total || 0).toFixed(2),
  };

  const allImageFileIds = (order.items || []).map(it => it.image).filter(Boolean);
  const tempUrlMap = await getTempUrlMap(allImageFileIds);

  const itemsView = (order.items || []).map(it => ({
    ...it,
    image: tempUrlMap[it.image] || '',
    price: Number(it.price || 0).toFixed(2)
  }));
  
  // [核心修正] 简化 canApplyRefund 的计算逻辑
  const isPaid = order.payment?.status === 'paid';
  const isCancelled = status === 'cancelled';
  const isDone = status === 'done';
  const doneAt = order.doneAt || 0;
  const over3Days = isDone && doneAt > 0 && (now() - doneAt) > 3 * 24 * 60 * 60 * 1000;
  
  const refundStatus = order.refund?.status?.toLowerCase();
  
  // 检查售后是否处于一个“进行中”或“已成功”的非终结状态
  // 如果是，则不能再次申请
  const refundIsActive = ['applied', 'processing', 'success'].includes(refundStatus);
  
  // 最终判断：必须已支付、未取消、未超3天，且没有正在处理的售后
  const canApplyRefund = isPaid && !isCancelled && !over3Days && !refundIsActive;
  
  const canCancelPayment = status === 'pending_payment';

  const payMethod = String(order.payment?.method || '').trim();
  const payMethodText = payMethod === 'balance'
    ? '余额支付'
    : (payMethod === 'free' ? '无需支付' : '微信支付');

  const refundView = order.refund
    ? {
        ...order.refund,
        statusText: (String(order.refund.status || '').toLowerCase() === 'applied')
          ? '审核中'
          : (order.refund.statusText || ''),
      }
    : null;

  return {
    _id: order._id,
    orderNo: order.orderNo,
    status,
    statusText,
    mode: type,
    storeSubMode,
    storeSubModeText,
    modeText: type === 'ziti' ? (storeSubModeText || '自提') : (type === 'waimai' ? '外卖' : '快递'),
    items: itemsView,
    goodsView: itemsView.map(it => ({ productName: it.productName, count: it.count, image: it.image })),
    amount: fee,
    totalPrice: fee.total,
    totalCount: (order.items || []).reduce((sum, item) => sum + item.count, 0),
    canApplyRefund,
    canCancelPayment,
    payMethod,
    payMethodText,
    isVip: !!order.isVip,
    refund: refundView,
    pickupInfo: order.pickupInfo || {},
    shippingInfo: order.shippingInfo || {},
    remark: order.remark || '',
    storeName: order.storeName || '',
    pointsEarn: order.pointsEarn || 0,
    createdAt: order.createdAt,
    createdAtText: formatTimeText(order.createdAt),
    paidAt: order.paidAt || 0,
    paidAtText: formatTimeText(order.paidAt),
    doneAt: doneAt,
    doneAtText: formatTimeText(doneAt),
  };
}

async function listMyOrders(openid, { tab = 'doing', pageNum = 1, pageSize = 10 }) {
  const skip = (pageNum - 1) * pageSize;

  const buildQuery = (refundCond) => {
    const where = { _openid: openid };

    if (tab === 'doing') {
      // Orders with after-sale should be shown only in the "refund" tab.
      where.status = _.in(['pending_payment', 'processing', 'ready', 'delivering']);
      where.refund = refundCond;
    } else if (tab === 'done') {
      // Orders with after-sale should be shown only in the "refund" tab.
      where.status = _.in(['done', 'cancelled']);
      where.refund = refundCond;
    } else if (tab === 'refund') {
      where.refund = _.exists(true);
    } else {
      return null;
    }

    return db.collection(COL_ORDERS)
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize);
  };

  let query = buildQuery(_.exists(false));
  if (!query) return { data: [] };

  let res;
  try {
    res = await query.get();
  } catch (e) {
    // Some envs might not support exists(false). Fallback to "refund == null" (null or missing).
    if (tab === 'doing' || tab === 'done') {
      res = await buildQuery(_.eq(null)).get();
    } else {
      throw e;
    }
  }
  
  const list = await Promise.all(res.data.map(order => _mapOrderForView(order)));
  return { data: list.filter(Boolean) };
}

async function getOrderDetail(openid, orderId) {
  if (!orderId) throw new Error('Missing orderId');
  
  const res = await db.collection(COL_ORDERS).doc(orderId).get();
  
  if (!res.data || res.data._openid !== openid) {
    return { error: 'order_not_found', message: 'Order not found or permission denied' };
  }
  
  const mappedOrder = await _mapOrderForView(res.data);
  return { data: mappedOrder };
}

module.exports = {
  listMyOrders,
  getOrderDetail,
};
