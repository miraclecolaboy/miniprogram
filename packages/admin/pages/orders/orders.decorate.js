// packages/admin/pages/orders/orders.decorate.js

const { fmtTime } = require('../../../../utils/common');
const {
  buildStatusText,
  getRefundStatus,
  maskPhone,
  modeText,
  needRefundHandle,
} = require('./orders.helpers');

module.exports = {
  /**
   * 移除旧字段兼容，直接读取新结构
   */
  decorateOrder(o) {
    const hasRefund = !!(o && o.refund);
    const refundStatus = getRefundStatus(o);
    // 售后已结束但订单可继续履约（如拒绝/取消售后）
    const refundEndedButOrderContinues = ['rejected', 'reject', 'cancelled', 'canceled'];
    // 售后进行中/或已退款成功：不允许继续推进订单状态（避免误操作）
    const refundBlocksOrder = hasRefund && !refundEndedButOrderContinues.includes(refundStatus);
    const needHandle = hasRefund && needRefundHandle(o);

    // 商品
    const items = o.items || [];
    const itemsView = items.map((it, idx) => {
      const name = String(it.productName || it.name || '');
      const c = Number(it.count || 0) || 0;
      const spec = String(it.specText || '').trim();
      return { key: `${o._id}_${idx}`, line: `${name} × ${c}${spec ? `（${spec}）` : ''}` };
    });

    // 地址
    const addr = o.shippingInfo || {}; // 直接读取 shippingInfo
    const pickupInfo = o.pickupInfo || {}; // 直接读取 pickupInfo
    const pickupPhone = String(pickupInfo.phone || o.reservePhone || o.receiverPhone || '').trim();
    const receiverName = o.mode === 'ziti' ? '' : (addr.name || '');
    const receiverPhone = o.mode === 'ziti' ? pickupPhone : (addr.phone || '');
    const addrText = `${addr.region || ''}${addr.detail || ''}`;
    const addrCopyText = (o.mode !== 'ziti')
      ? `${[receiverName, receiverPhone].filter(Boolean).join(' ')}\n${addrText}`.trim()
      : '';

    // 自提
    const pickupCodeText = String(pickupInfo.code || '');
    let pickupTimeText = '';
    if (o.mode === 'ziti' && pickupInfo.time) {
      pickupTimeText = typeof pickupInfo.time === 'number'
        ? fmtTime(pickupInfo.time)
        : String(pickupInfo.time).trim();
    }

    // 金额
    const amount = o.amount || {}; // 直接读取 amount
    const payAmountText = Number(amount.total || 0).toFixed(2);
    const goodsAmountText = Number(amount.goods || 0).toFixed(2);
    const deliveryAmountText = Number(amount.delivery || 0).toFixed(2);
    const vipDiscountNum = Number(amount.vipDiscount != null ? amount.vipDiscount : (amount.discount || 0));
    const couponDiscountNum = Number(amount.couponDiscount || 0);
    const vipDiscountText = Number.isFinite(vipDiscountNum) ? vipDiscountNum.toFixed(2) : '0.00';
    const couponDiscountText = Number.isFinite(couponDiscountNum) ? couponDiscountNum.toFixed(2) : '0.00';
    const payMethod = String(o?.payment?.method || '').trim();
    const payMethodText = payMethod === 'balance'
      ? '余额支付'
      : (payMethod === 'free' ? '无需支付' : '微信支付');

    // 状态
    const st = String(o.status || '').toLowerCase();
    const isPaidLike = !!o.paidAt || ['paid', 'making', 'processing', 'ready', 'delivering', 'done'].includes(st);
    const canApplyRefund = !!(isPaidLike && st !== 'cancelled' && (!hasRefund || refundEndedButOrderContinues.includes(refundStatus)));

    return {
      ...o,
      modeText: modeText(o.mode, o.storeSubMode),
      statusView: refundBlocksOrder
        ? (String((o.refund && o.refund.statusText) || '').trim() || buildStatusText(o))
        : buildStatusText(o),
      createdAtText: fmtTime(o.createdAt),
      paidAtText: fmtTime(o.paidAt),
      pickupCodeText,
      pickupTimeText,
      receiverName,
      receiverPhone,
      receiverPhoneMasked: maskPhone(receiverPhone),
      addrText,
      addrCopyText,
      itemsView,
      remarkText: String(o.remark || '').trim(),
      payAmountText,
      payMethodText,
      amountGoodsText: goodsAmountText,
      amountDeliveryText: deliveryAmountText,
      amountVipDiscountText: vipDiscountText,
      amountCouponDiscountText: couponDiscountText,
      expressNoText: String(o.expressNo || '').trim(),
      refundHandled: refundBlocksOrder,
      needRefundHandle: needHandle,
      canApplyRefund,
    };
  },
};
