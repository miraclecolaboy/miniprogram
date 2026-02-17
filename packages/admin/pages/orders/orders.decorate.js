
const { fmtTime } = require('../../../../utils/common');
const {
  buildStatusText,
  getRefundStatus,
  maskPhone,
  modeText,
  needRefundHandle,
} = require('./orders.helpers');

function getBalanceAfterPayText(order) {
  const candidates = [
    order?.payment?.balanceAfterPay,
    order?.balanceAfterPay,
    order?.payment?.balanceAfter,
    order?.balanceAfter,
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n.toFixed(2);
  }
  return '';
}

module.exports = {
  decorateOrder(o) {
    const hasRefund = !!(o && o.refund);
    const refundStatus = getRefundStatus(o);
    const refundEndedButOrderContinues = ['rejected', 'reject', 'cancelled', 'canceled'];
    const refundBlocksOrder = hasRefund && !refundEndedButOrderContinues.includes(refundStatus);
    const needHandle = hasRefund && needRefundHandle(o);

    const items = o.items || [];
    const itemsView = items.map((it, idx) => {
      const name = String(it.productName || it.name || '');
      const c = Number(it.count || 0) || 0;
      const spec = String(it.specText || '').trim();
      return { key: `${o._id}_${idx}`, line: `${name} × ${c}${spec ? `（${spec}）` : ''}` };
    });

    const addr = o.shippingInfo || {};
    const pickupInfo = o.pickupInfo || {};
    const pickupPhone = String(pickupInfo.phone || o.reservePhone || o.receiverPhone || '').trim();
    const receiverName = o.mode === 'ziti' ? '' : (addr.name || '');
    const receiverPhone = o.mode === 'ziti' ? pickupPhone : (addr.phone || '');
    const addrText = String(addr.address || addr.fullAddress || '').trim()
      || `${addr.region || ''}${addr.detail || ''}`;
    const addrCopyText = (o.mode !== 'ziti')
      ? `${[receiverName, receiverPhone].filter(Boolean).join(' ')}\n${addrText}`.trim()
      : '';

    const pickupCodeText = String(pickupInfo.code || '');
    let pickupTimeText = '';
    if (o.mode === 'ziti' && pickupInfo.time) {
      pickupTimeText = typeof pickupInfo.time === 'number'
        ? fmtTime(pickupInfo.time)
        : String(pickupInfo.time).trim();
    }

    const amount = o.amount || {};
    const payAmountText = Number(amount.total || 0).toFixed(2);
    const goodsAmountText = Number(amount.goods || 0).toFixed(2);
    const deliveryAmountText = Number(amount.delivery || 0).toFixed(2);
    const vipDiscountNum = Number(amount.vipDiscount != null ? amount.vipDiscount : (amount.discount || 0));
    const couponDiscountNum = Number(amount.couponDiscount || 0);
    const vipDiscountText = Number.isFinite(vipDiscountNum) ? vipDiscountNum.toFixed(2) : '0.00';
    const couponDiscountText = Number.isFinite(couponDiscountNum) ? couponDiscountNum.toFixed(2) : '0.00';
    const payMethod = String(o?.payment?.method || '').trim();
    const balanceAfterPayText = getBalanceAfterPayText(o);
    const payMethodText = payMethod === 'balance'
      ? '余额支付'
      : (payMethod === 'free' ? '无需支付' : '微信支付');
    const buyerNickName = String(o.buyerNickName || o.userNickName || o.nickName || '').trim();

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
      balanceAfterPayText,
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
      buyerNickName,
      refundHandled: refundBlocksOrder,
      needRefundHandle: needHandle,
      canApplyRefund,
    };
  },
};
