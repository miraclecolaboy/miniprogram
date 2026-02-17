
const { toNum, pickImg } = require('../../utils/common');
const { groupCouponInstancesForCheckout, buildCouponGroupKey } = require('../../utils/coupon');
const { computeDeliveryFee, computeFreeDeliveryLine } = require('./checkout.helpers');

module.exports = {
  recalcCart() {
    this.initCart(this.data.cart);
  },

  initCart(cart) {
    const list = Array.isArray(cart) ? cart : [];
    const computed = list.map((it) => ({
      ...it,
      productId: String(it.productId || it.id || it._id || '').trim(),
      skuKey: String(it.skuKey || it.skuId || '').trim(),
      price: toNum(it.priceWithSpec ?? it.price, 0),
      count: toNum(it.count, 0),
      total: (toNum(it.priceWithSpec ?? it.price, 0) * toNum(it.count, 0)).toFixed(2),
      img: pickImg(it.img),
    }));

    const goodsTotalFen = computed.reduce((sum, item) => sum + (Math.round(toNum(item.price, 0) * 100) * toNum(item.count, 0)), 0);
    const goodsTotal = goodsTotalFen / 100;
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

    const deliveryFeeNum = computeDeliveryFee(this.data.mode, goodsTotal, this.data, {
      address: this.data.address,
    });
    const deliveryFeeFen = Math.round(toNum(deliveryFeeNum, 0) * 100);
    const payableFen = goodsTotalFen + deliveryFeeFen;

    const vipPreviewDiscountFen = Math.round(payableFen * 0.05);
    const vipDiscountFen = this.data.isVip ? vipPreviewDiscountFen : 0;
    const afterVipFen = Math.max(0, payableFen - vipDiscountFen);
    const couponFaceFen = Math.round(toNum(couponDiscount, 0) * 100);
    const couponAppliedFen = Math.min(couponFaceFen, afterVipFen);
    const finalPayFen = Math.max(0, afterVipFen - couponAppliedFen);
    const discountTotalFen = Math.min(payableFen, vipDiscountFen + couponAppliedFen);
    const finalPayNum = finalPayFen / 100;

    const freeLine = computeFreeDeliveryLine(this.data.mode, this.data, {
      address: this.data.address,
    });
    const freeLineFen = Math.round(toNum(freeLine, 0) * 100);
    const needMoreFen = (freeLineFen > 0 && goodsTotalFen < freeLineFen) ? (freeLineFen - goodsTotalFen) : 0;

    this.setData({
      cart: computed,
      totalPrice: (goodsTotalFen / 100).toFixed(2),
      availableCoupons,
      selectedCoupon,
      selectedCouponKey: selectedCoupon ? buildCouponGroupKey(selectedCoupon) : '',
      couponDiscount: (couponAppliedFen / 100).toFixed(2),
      vipDiscount: (vipDiscountFen / 100).toFixed(2),
      vipPreviewDiscount: (vipPreviewDiscountFen / 100).toFixed(2),
      deliveryFee: (deliveryFeeFen / 100).toFixed(2),
      finalPay: (finalPayFen / 100).toFixed(2),
      discountTotal: (discountTotalFen / 100).toFixed(2),
      freeDeliveryLine: (freeLineFen / 100).toFixed(2),
      needMoreFreeDelivery: (needMoreFen / 100).toFixed(2),
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
