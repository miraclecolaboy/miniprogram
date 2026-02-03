// pages/checkout/checkout.cart.js
// 结算页：购物车/优惠券计算相关方法

const { toNum, pickImg } = require('../../utils/common');
const { groupCouponInstancesForCheckout, buildCouponGroupKey } = require('../../utils/coupon');
const { computeDeliveryFee } = require('./checkout.helpers');

module.exports = {
  recalcCart() {
    this.initCart(this.data.cart);
  },

  initCart(cart) {
    const list = Array.isArray(cart) ? cart : [];
    const computed = list.map((it) => ({
      ...it,
      // Normalize for createOrder payload.
      productId: String(it.productId || it.id || it._id || '').trim(),
      skuKey: String(it.skuKey || it.skuId || '').trim(),
      price: toNum(it.priceWithSpec ?? it.price, 0),
      count: toNum(it.count, 0),
      total: (toNum(it.priceWithSpec ?? it.price, 0) * toNum(it.count, 0)).toFixed(2),
      img: pickImg(it.img),
    }));

    const goodsTotal = computed.reduce((sum, item) => sum + (item.price * item.count), 0);
    const rawAvailableCoupons = (this.data.userCoupons || []).filter(c => toNum(c?.minSpend, 0) <= goodsTotal);
    const { groups: availableCoupons, itemsMap } = groupCouponInstancesForCheckout(rawAvailableCoupons);
    this._availableCouponItemsMap = itemsMap;

    let couponDiscount = 0;
    let selectedCoupon = this.data.selectedCoupon;

    if (selectedCoupon && !rawAvailableCoupons.some(c => c.userCouponId === selectedCoupon.userCouponId)) {
      selectedCoupon = null;
    }

    if (selectedCoupon) {
      couponDiscount = toNum(selectedCoupon.discount, 0);
    }

    const deliveryFeeNum = computeDeliveryFee(this.data.mode, goodsTotal, this.data);
    const vipDiscountNum = this.data.isVip ? Number(((goodsTotal + deliveryFeeNum) * 0.05).toFixed(2)) : 0;
    const finalPayNum = Math.max(0, goodsTotal + deliveryFeeNum - vipDiscountNum - couponDiscount);

    let freeLine = 0;
    if (this.data.mode === 'waimai') freeLine = toNum(this.data.minOrderWaimai, 0);
    if (this.data.mode === 'kuaidi') freeLine = toNum(this.data.minOrderKuaidi, 0);
    const needMore = (freeLine > 0 && goodsTotal < freeLine) ? (freeLine - goodsTotal) : 0;

    this.setData({
      cart: computed,
      totalPrice: goodsTotal.toFixed(2),
      availableCoupons,
      selectedCoupon,
      selectedCouponKey: selectedCoupon ? buildCouponGroupKey(selectedCoupon) : '',
      couponDiscount: couponDiscount.toFixed(2),
      vipDiscount: vipDiscountNum.toFixed(2),
      deliveryFee: deliveryFeeNum.toFixed(2),
      finalPay: finalPayNum.toFixed(2),
      freeDeliveryLine: freeLine.toFixed(2),
      needMoreFreeDelivery: needMore.toFixed(2),
      points: Math.floor(finalPayNum),
    });
  },

  onSelectCoupon() {
    const { availableCoupons } = this.data;
    if (availableCoupons.length === 0) return wx.showToast({ title: '暂无可用优惠券', icon: 'none' });
    this.setData({ showCouponPopup: true });
  },

  closeCouponPopup() { this.setData({ showCouponPopup: false }); },

  useNoCoupon() {
    this.setData({ showCouponPopup: false, selectedCoupon: null }, () => this.recalcCart());
  },

  useCoupon(e) {
    const groupKey = String(e?.currentTarget?.dataset?.key || '').trim();
    const list = (this._availableCouponItemsMap && groupKey) ? (this._availableCouponItemsMap.get(groupKey) || []) : [];
    const picked = list[0] || null;
    this.setData({ showCouponPopup: false, selectedCoupon: picked }, () => this.recalcCart());
  },
};
