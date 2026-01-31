// pages/checkout/checkout.cart.js
// 结算页：购物车/优惠券计算相关方法

const { toNum, pickImg } = require('../../utils/common');
const { groupCouponInstancesForCheckout } = require('../../utils/coupon');
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
    if (availableCoupons.length === 0) {
      return wx.showToast({ title: '暂无可用优惠券', icon: 'none' });
    }

    const itemList = availableCoupons.map(c => `${c.title} (-￥${c.discount})${Number(c.count || 0) > 1 ? ` x${c.count}` : ''}`);
    itemList.push('不使用优惠券');

    wx.showActionSheet({
      itemList,
      success: (res) => {
        if (typeof res.tapIndex !== 'number') return;
        if (res.tapIndex >= itemList.length - 1) { // 选择了"不使用"或取消
          this.setData({ selectedCoupon: null }, () => this.recalcCart());
        } else {
          const g = availableCoupons[res.tapIndex];
          const groupKey = g && g.groupKey;
          const list = (this._availableCouponItemsMap && groupKey) ? (this._availableCouponItemsMap.get(groupKey) || []) : [];
          const picked = list[0] || null;
          this.setData({ selectedCoupon: picked }, () => this.recalcCart());
        }
      }
    });
  },
};

