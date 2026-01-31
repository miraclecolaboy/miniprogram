// utils/wxPay.js
// 微信支付相关的小工具：统一 timeStamp/string 兼容与取消判断。

function requestPaymentAsync(payment) {
  const p = payment || {};
  const timeStamp = p.timeStamp != null ? String(p.timeStamp) : '';

  return new Promise((resolve, reject) => {
    wx.requestPayment({
      ...p,
      timeStamp,
      success: resolve,
      fail: reject,
    });
  });
}

function isUserCancelPay(err) {
  const msg = String(err?.errMsg || err?.message || '');
  return msg.includes('cancel') || msg.includes('取消');
}

module.exports = { requestPaymentAsync, isUserCancelPay };

