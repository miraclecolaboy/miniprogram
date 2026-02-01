// packages/admin/pages/shop/shop.pay.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');

module.exports = {
  // --- 微信支付 ---
  onSubMchIdInput(e) { this.setData({ subMchId: safeStr(e.detail.value), payChanged: true }); },

  async onSavePayConfig() {
    const session = getSession();
    if (!session?.token || !this.data.payChanged) return;

    const subMchId = safeStr(this.data.subMchId);
    if (!subMchId) return wx.showToast({ title: '请填写子商户号', icon: 'none' });

    const r = await call('admin', {
      action: 'shop_setConfig',
      token: session.token,
      subMchId,
    }, { loadingTitle: '保存中' }).catch(() => null);

    if (!r?.ok) return wx.showToast({ title: r?.message || '保存失败', icon: 'none' });
    this.setData({ payChanged: false });
    wx.showToast({ title: '已保存', icon: 'success' });
  },
};

