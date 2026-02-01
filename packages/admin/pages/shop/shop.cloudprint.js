// packages/admin/pages/shop/shop.cloudprint.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { toInt } = require('./shop.helpers');

module.exports = {
  // --- 云打印 ---
  onCloudPrintInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [field]: safeStr(e.detail.value),
      cloudPrintChanged: true,
    });
  },

  async onSaveCloudPrint() {
    const session = getSession();
    if (!session?.token || !this.data.cloudPrintChanged) return;
    const { cloudPrinterSn, cloudPrinterUser, cloudPrinterKey, cloudPrinterTimes } = this.data;
    if (!cloudPrinterSn || !cloudPrinterUser || !cloudPrinterKey) {
      return wx.showToast({ title: 'SN、USER、UKEY均为必填项', icon: 'none' });
    }
    const r = await call('admin', {
      action: 'shop_setConfig',
      token: session.token,
      cloudPrinterSn,
      cloudPrinterUser,
      cloudPrinterKey,
      cloudPrinterTimes: toInt(cloudPrinterTimes, 1),
    }, { loadingTitle: '保存中' }).catch(() => null);
    if (!r?.ok) return wx.showToast({ title: r?.message || '保存失败', icon: 'none' });
    this.setData({ cloudPrintChanged: false });
    wx.showToast({ title: '打印机配置已保存', icon: 'success' });
  },
};

