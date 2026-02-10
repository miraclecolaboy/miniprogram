// pages/checkout/checkout.pay.js
// 结算页：支付相关方法

const { ensureLogin, refreshUserToStorage } = require('../../utils/auth');
const { callUser } = require('../../utils/cloud');
const { sleep, toNum } = require('../../utils/common');
const { requestPaymentAsync, isUserCancelPay } = require('../../utils/wxPay');
const { CART_CLEAR: KEY_CART_CLEAR } = require('../../utils/storageKeys');

module.exports = {
  applyDefaultPayMethod() {
    const { balance, finalPay } = this.data;
    const shouldBalance = toNum(balance, 0) >= toNum(finalPay, 0) && toNum(finalPay, 0) > 0;
    const method = shouldBalance ? 'balance' : 'wechat';
    this.setData({ payMethod: method });
  },

  choosePay(e) {
    const method = e.currentTarget.dataset.method;
    if (method !== 'wechat' && method !== 'balance') return;

    if (method === 'balance' && toNum(this.data.balance, 0) < toNum(this.data.finalPay, 0)) {
      wx.showToast({ title: '余额不足', icon: 'none' });
      return;
    }

    this.setData({ payMethod: method });
  },

  async onPayTap() {
    if (this.data.paying) return;
    if (this._initPromise) await this._initPromise.catch(() => {});
    const { mode, cart, address, payMethod, remark, pickupTime, selectedCoupon, storeSubMode } = this.data;
    if (!Array.isArray(cart) || cart.length === 0) return wx.showToast({ title: '购物车为空', icon: 'none' });
    if (mode !== 'ziti' && !address) return wx.showToast({ title: '请选择地址', icon: 'none' });

    try {
      this.setData({ paying: true });
      await ensureLogin();
      wx.showLoading({ title: '正在创建订单...', mask: true });

      const payload = {
        mode,
        storeSubMode: mode === 'ziti' ? storeSubMode : '',
        items: cart.map(it => ({ productId: it.productId || it.id || it._id || '', skuId: it.skuKey || it.skuId || '', count: it.count })),
        addressId: address ? address.id : '',
        remark,
        pickupTime,
        paymentMethod: payMethod,
        userCouponId: selectedCoupon ? selectedCoupon.userCouponId : ''
      };

      // [修复] 下单偶发失败：对 createOrder 做一次轻量重试（常见于事务/网络抖动）
      const callCreateOrder = async () => (await callUser('createOrder', payload)).result;
      let out;
      try {
        out = await callCreateOrder();
      } catch (e0) {
        await sleep(220);
        out = await callCreateOrder();
      }

      const retryable = out && !out.ok && ['transaction_failed', 'server_error'].includes(String(out.error || '').trim());
      if (retryable) {
        await sleep(220);
        out = await callCreateOrder();
      }

      if (!out || !out.ok) throw new Error(out.message || '创建订单失败');

      wx.hideLoading();
      const { orderId, payment, paid } = out.data;

      if (paid) {
        wx.showToast({ title: '支付成功', icon: 'success' });
      } else {
        try {
          await requestPaymentAsync(payment);
          wx.showToast({ title: '支付成功', icon: 'success' });
        } catch (ePay) {
          if (isUserCancelPay(ePay)) {
            wx.showToast({ title: '已取消支付', icon: 'none' });
            callUser('cancelUnpaidOrder', { orderId }).catch(() => {});
          }
          throw ePay;
        }
      }

      wx.setStorageSync(KEY_CART_CLEAR, { ts: Date.now() });
      refreshUserToStorage().catch(() => {});
      setTimeout(() => { wx.switchTab({ url: '/pages/trade/trade-list/trade-list' }); }, 400);

    } catch (e) {
      wx.hideLoading();
      if (!isUserCancelPay(e)) {
        wx.showToast({ title: e.message || '支付失败', icon: 'none' });
      }
    } finally {
      this.setData({ paying: false });
    }
  },
};
