// cloudfunctions/user/services/tradeService.js
const cloud = require('wx-server-sdk');
const {
  COL_ORDERS, COL_USERS, COL_PRODUCTS,
  COL_SHOP_CONFIG, WX_PAY_CALLBACK_FN, FORCE_ENV_ID
} = require('../config/constants');
const { now, toNum } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// --- 内部辅助函数 ---

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))); }

async function _getPayConfig() {
  const got = await db.collection(COL_SHOP_CONFIG).doc('main').get().catch(() => null);
  const cfg = got?.data || {};
  const subMchId = String(cfg.subMchId || '').trim();
  if (!subMchId) throw new Error('请先在商家端配置微信支付子商户号(subMchId)');
  return { subMchId };
}

function computeDeliveryFee(mode, goodsTotal, cfg) {
  const m = String(mode || 'ziti');
  const gt = Number(goodsTotal || 0);
  const wFee = Number(cfg?.waimaiDeliveryFee || 0);
  const kFee = Number(cfg?.kuaidiDeliveryFee || 0);
  const wLine = Number(cfg?.minOrderWaimai || 0);
  const kLine = Number(cfg?.minOrderKuaidi || 0);

  if (m === 'waimai' && wFee > 0 && (wLine <= 0 || gt < wLine)) return wFee;
  if (m === 'kuaidi' && kFee > 0 && (kLine <= 0 || gt < kLine)) return kFee;
  return 0;
}

function genOrderNo() {
  const d = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const rnd = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}${rnd}`;
}

function genPickupCode4() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// --- 订单服务 ---

async function createOrder(event, openid) {
  const { mode, items, addressId, remark, pickupTime, paymentMethod, userCouponId, storeSubMode } = event;

  const rawStoreSubMode = String(storeSubMode || '').trim();
  const storeSubModeFinal = mode === 'ziti'
    ? (['tangshi', 'ziti'].includes(rawStoreSubMode) ? rawStoreSubMode : 'ziti')
    : '';

  // Be tolerant to older/buggy clients: default to wechat when missing/invalid.
  let payMethod = String(paymentMethod || '').trim();
  if (!['wechat', 'balance'].includes(payMethod)) payMethod = 'wechat';

  if (!['ziti', 'waimai', 'kuaidi'].includes(mode)) return { error: 'invalid_mode' };
  if (!Array.isArray(items) || items.length === 0) return { error: 'cart_empty' };
  if (mode !== 'ziti' && !addressId) return { error: 'address_required' };

  const nowTs = now();
  let orderId = '';
  let finalPayAmount = 0;
  let orderNo = '';

  try {
    // [修复] 事务偶发冲突/抖动：自动重试一次，避免用户必须点两次下单
    let txResult;
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        txResult = await db.runTransaction(async tx => {
      const productIds = [...new Set(items.map(it => it.productId))];

      const productsRes = await tx.collection(COL_PRODUCTS).where({ _id: _.in(productIds) }).get();
      const productMap = new Map(productsRes.data.map(p => [p._id, p]));
      
      const skuMap = new Map();
      productsRes.data.forEach(p => {
        if (p.hasSpecs && Array.isArray(p.skuList)) {
          p.skuList.forEach(sku => {
            if (sku.skuKey) {
              skuMap.set(sku.skuKey, {
                ...sku,
                productId: p._id,
                productName: p.name,
                thumbFileID: p.thumbFileID || (p.imgs && p.imgs[0]) || ''
              });
            }
          });
        }
      });

      let goodsTotal = 0;
      const orderItems = [];

      for (const item of items) {
        const product = productMap.get(item.productId);
        if (!product || product.status !== 1) throw { error: 'product_unavailable', message: `商品「${product?.name || '未知'}」已下架` };
        
        let price = 0, specText = '';
        if (item.skuId) {
          const sku = skuMap.get(item.skuId);
          if (!sku) throw { error: 'sku_unavailable', message: `商品「${product.name}」的规格已失效` };
          price = sku.price;
          specText = sku.specText;

        } else {
          if (product.hasSpecs) throw { error: 'missing_sku', message: `「${product.name}」是多规格商品` };
          price = product.price;
        }

        goodsTotal += price * item.count;
        orderItems.push({
          productId: product._id, skuId: item.skuId || '', productName: product.name,
          specText, image: product.thumbFileID || (product.imgs && product.imgs[0]) || '',
          count: item.count, price
        });
      }

      const [shopConfigRes, userRes] = await Promise.all([
        tx.collection(COL_SHOP_CONFIG).doc('main').get(),
        tx.collection(COL_USERS).doc(openid).get()
      ]);
      const shopConfig = shopConfigRes.data || {};
      const user = userRes.data || {};

      if (mode === 'kuaidi' && shopConfig.kuaidiOn === false) {
        throw { error: 'kuaidi_disabled', message: '快递暂未开放' };
      }
      
      const deliveryFee = computeDeliveryFee(mode, goodsTotal, shopConfig);
      const memberLevel = Number(user.memberLevel || 0);
      const isVip = memberLevel >= 4; // Lv4: permanent 95% price (5% off)
      const vipDiscount = isVip ? Number(((goodsTotal + deliveryFee) * 0.05).toFixed(2)) : 0;

      let couponDiscount = 0;
      if (userCouponId) {
        const coupon = (user.coupons || []).find(c => c.userCouponId === userCouponId);
        if (!coupon) throw new Error('优惠券无效');
        if (goodsTotal < toNum(coupon.minSpend, 0)) throw new Error('未达到优惠券使用门槛');
        couponDiscount = toNum(coupon.discount, 0);
      }
      
      finalPayAmount = Math.max(0, goodsTotal + deliveryFee - vipDiscount - couponDiscount);
      const paidImmediately = payMethod === 'balance' || finalPayAmount <= 0;
      const paymentMethodFinal = finalPayAmount <= 0 ? 'free' : payMethod;

      if (payMethod === 'balance') {
        if (user.balance < finalPayAmount) throw { error: 'insufficient_balance', message: '余额不足' };
        await tx.collection(COL_USERS).doc(openid).update({ data: { balance: _.inc(-finalPayAmount) } });
      }
      
      if (userCouponId) {
        await tx.collection(COL_USERS).doc(openid).update({
          data: {
            coupons: _.pull({ userCouponId })
          }
        });
      }
      
      const address = mode !== 'ziti' ? (user.addresses || []).find(a => a.id === addressId) || null : null;
      orderNo = genOrderNo();
      
      const orderDoc = {
        _openid: openid, orderNo,
        status: paidImmediately ? 'processing' : 'pending_payment',
        statusText: paidImmediately ? '准备中' : '待支付',
        mode,
        storeSubMode: storeSubModeFinal,
        items: orderItems,
        amount: { 
          goods: Number(goodsTotal.toFixed(2)), 
          delivery: Number(deliveryFee.toFixed(2)), 
          // legacy alias used by some order detail UIs ("会员折扣")
          discount: vipDiscount,
          vipDiscount, 
          couponDiscount,
          total: Number(finalPayAmount.toFixed(2)) 
        },
        payment: { method: paymentMethodFinal, status: paidImmediately ? 'paid' : 'pending', paidAt: paidImmediately ? nowTs : 0 },
        userCouponId: userCouponId || '',
        shippingInfo: address,
        pickupInfo: { code: mode === 'ziti' ? genPickupCode4() : '', time: mode === 'ziti' ? pickupTime : '' },
        remark: remark || '', isVip, memberLevel, pointsEarn: Math.floor(finalPayAmount),
        createdAt: nowTs, updatedAt: nowTs, paidAt: paidImmediately ? nowTs : 0,
        storeName: shopConfig.storeName || '',
        buyerNickName: String(user.nickName || '').trim(),
      };
      const addRes = await tx.collection('orders').add({ data: orderDoc });
      return { orderId: addRes._id, orderNo };
        });
        break;
      } catch (e) {
        // 业务异常不重试
        if (e && typeof e === 'object' && e.error) throw e;
        if (attempt >= maxAttempts) throw e;
        await sleep(120);
      }
    }

    orderId = txResult.orderId;
    orderNo = txResult.orderNo;

    if (payMethod === 'wechat' && finalPayAmount > 0) {
      try {
        const { subMchId } = await _getPayConfig();
        const payRes = await cloud.cloudPay.unifiedOrder({
          body: '订单支付', outTradeNo: orderNo, totalFee: Math.round(finalPayAmount * 100),
          tradeType: 'JSAPI', openid, spbillCreateIp: '127.0.0.1', subMchId,
          functionName: WX_PAY_CALLBACK_FN, envId: FORCE_ENV_ID || cloud.getWXContext().ENV
        });
        await db.collection('orders').doc(orderId).update({ data: { 'payment.outTradeNo': orderNo } });
        return { ok: true, data: { orderId, payment: payRes.payment, paid: false } };
      } catch (e) {
        await db.collection('orders').doc(orderId).remove().catch(()=>{});
        return { error: 'wxpay_failed', message: e.message || '无法发起微信支付' };
      }
    }

    return { ok: true, data: { orderId, paid: true } };
  } catch (e) {
    return { error: e.error || 'transaction_failed', message: e.message || '订单创建失败，请重试' };
  }
}

async function sysHandlePaySuccess(payEvent) {
    const outTradeNo = payEvent.outTradeNo || payEvent.out_trade_no;
    if (!outTradeNo) return { errcode: 0, errmsg: 'OK' };
  
    const orderRes = await db.collection('orders').where({ 'payment.outTradeNo': outTradeNo }).limit(1).get();
    const order = orderRes.data[0];
    if (!order) return { errcode: 0, errmsg: 'OK' };
    if (order.payment.status === 'paid') return { errcode: 0, errmsg: 'OK' };
  
    const nowTs = now();
    const openid = order._openid;
    
    await db.collection('orders').doc(order._id).update({
      data: {
        status: 'processing', statusText: '准备中', paidAt: nowTs,
        'payment.status': 'paid', 'payment.paidAt': nowTs,
        'payment.transactionId': payEvent.transactionId || payEvent.transaction_id || ''
      }
    });
    
    if (order.pointsEarn > 0 && openid) {
      await db.collection('users').doc(openid).update({
        data: { points: _.inc(order.pointsEarn) }
      }).catch(console.error);
    }
    
    return { errcode: 0, errmsg: 'OK' };
}

async function sysHandleRefundSuccess(refundEvent) {
    const outRefundNo = refundEvent.out_refund_no || refundEvent.outRefundNo;
    const refundStatus = refundEvent.refund_status || refundEvent.refundStatus;

    if (!outRefundNo) {
        console.warn('[sysHandleRefundSuccess] Callback is missing out_refund_no', refundEvent);
        return { errcode: 0, errmsg: 'OK' };
    }

    try {
        const orderRes = await db.collection(COL_ORDERS).where({
            'refund.outRefundNo': outRefundNo
        }).limit(1).get();

        const order = orderRes.data[0];
        if (!order) {
            console.error(`[sysHandleRefundSuccess] Order not found for outRefundNo: ${outRefundNo}`);
            return { errcode: 0, errmsg: 'OK' };
        }

        if (order.refund && order.refund.status === 'success') {
            console.log(`[sysHandleRefundSuccess] Refund for ${outRefundNo} already marked as success. Skipping.`);
            return { errcode: 0, errmsg: 'OK' };
        }

        const nowTs = now();
        let updateData = {};
        const successTime = refundEvent.success_time || '';

        if (refundStatus === 'SUCCESS') {
            updateData = {
                'refund.status': 'success',
                'refund.statusText': '退款成功',
                'refund.refundedAt': nowTs,
                'refund.logs': _.push({
                    ts: nowTs,
                    text: `微信支付退款已到账。${successTime ? `到账时间: ${successTime}` : ''}`
                })
            };
        } else {
            updateData = {
                'refund.status': 'failed',
                'refund.statusText': '退款失败',
                'refund.logs': _.push({
                    ts: nowTs,
                    text: `微信支付退款失败，微信返回状态: ${refundStatus}`
                })
            };
        }

        await db.collection(COL_ORDERS).doc(order._id).update({
            data: { ...updateData, updatedAt: nowTs }
        });

        console.log(`[sysHandleRefundSuccess] Processed callback for outRefundNo: ${outRefundNo}, status: ${refundStatus}`);
        return { errcode: 0, errmsg: 'OK' };

    } catch (e) {
        console.error(`[sysHandleRefundSuccess] CRITICAL ERROR processing outRefundNo: ${outRefundNo}`, e);
        return { errcode: 0, errmsg: 'OK' };
    }
}


async function cancelUnpaidOrder(orderId, openid) {
    const orderRes = await db.collection('orders').doc(orderId).get();
    const order = orderRes.data;
    if (order && order._openid === openid && order.status === 'pending_payment') {
        await db.collection('orders').doc(orderId).update({
            data: { status: 'cancelled', statusText: '用户取消' }
        });
        return { ok: true };
    }
    return { ok: false, message: '订单状态不符或无权限' };
}

async function applyRefund(orderId, openid, reason, remark) {
  if (!orderId) throw new Error('缺少订单ID');
  if (!reason) throw new Error('缺少退款原因');

  const orderRes = await db.collection(COL_ORDERS).doc(orderId).get();
  const order = orderRes.data;

  if (!order || order._openid !== openid) {
    throw new Error('订单不存在或无权限');
  }

  const isPaid = order.payment?.status === 'paid';
  const isCancelled = order.status === 'cancelled';
  const doneAt = order.doneAt || 0;
  const isDone = order.status === 'done';
  const over3Days = isDone && doneAt > 0 && (now() - doneAt) > 3 * 24 * 60 * 60 * 1000;

  const refund = order.refund || null;
  const refundStatus = refund ? (refund.status || 'pending').toLowerCase() : '';
  const canReapplyRefund = refund && ['rejected', 'cancelled'].includes(refundStatus);

  const canApply = isPaid && !isCancelled && !over3Days && (!refund || canReapplyRefund);

  if (!canApply) {
    throw new Error('当前订单状态不支持申请售后');
  }
  
  const nowTs = now();
  const refundDoc = {
    status: 'applied',
    statusText: '审核中',
    reason: reason,
    remark: remark || '',
    source: 'customer',
    appliedAt: nowTs,
    logs: [{ ts: nowTs, text: '用户发起售后申请' }]
  };

  await db.collection(COL_ORDERS).doc(orderId).update({
    data: {
      refund: refundDoc,
      updatedAt: nowTs
    }
  });

  return { ok: true, data: { orderId } };
}

async function cancelRefund(orderId, openid) {
  if (!orderId) throw new Error('缺少订单ID');

  const order = await db.collection(COL_ORDERS).doc(orderId).get().then(r => r.data);

  if (!order || order._openid !== openid) {
    throw new Error('订单不存在或无权限');
  }

  if (order.refund?.status !== 'applied') {
    throw new Error('当前状态无法取消售后');
  }

  const nowTs = now();
  await db.collection(COL_ORDERS).doc(orderId).update({
    data: {
      // Remove after-sale info so the order returns to normal "doing/done" tabs.
      refund: _.remove(),
      updatedAt: nowTs
    }
  });

  return { ok: true };
}


module.exports = {
  createOrder,
  cancelUnpaidOrder,
  sysHandlePaySuccess,
  sysHandleRefundSuccess,
  applyRefund,
  cancelRefund,
};
