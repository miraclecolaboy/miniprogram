// packages/admin/pages/shop/shop.cloudprint.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { toInt } = require('./shop.helpers');

function mapStatusToDot(statusText) {
  const s = String(statusText || '');
  return s.includes('在线') && s.includes('正常');
}

module.exports = {
  // --- 云打印 ---
  onCloudPrintInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [field]: safeStr(e.detail.value),
      cloudPrintChanged: true,
    });
  },

  async onRefreshCloudPrintStatus(options = {}) {
    const silent = !!options.silent;
    const session = getSession();
    if (!session?.token) return;

    if (this.data.cloudPrintStatusLoading) return;

    this.setData({ cloudPrintStatusLoading: true });
    try {
      const r = await call('cloudPrint', {
        action: 'status',
        token: session.token,
      });

      if (!r?.ok) {
        const msg = r?.message || '查询失败';
        this.setData({
          cloudPrintStatusOk: false,
          cloudPrintStatusText: `云打印：${msg}`,
        });
        if (!silent) wx.showToast({ title: msg, icon: 'none' });
        return;
      }

      const statusText = String(r.statusText || '未知');
      this.setData({
        cloudPrintStatusOk: mapStatusToDot(statusText),
        cloudPrintStatusText: `云打印：${statusText}`,
      });
    } catch (e) {
      const msg = e?.message || '查询失败';
      this.setData({
        cloudPrintStatusOk: false,
        cloudPrintStatusText: `云打印：${msg}`,
      });
      if (!silent) wx.showToast({ title: msg, icon: 'none' });
    } finally {
      this.setData({ cloudPrintStatusLoading: false });
    }
  },

  async onTestCloudPrint() {
    const session = getSession();
    if (!session?.token) return;

    const r = await call('cloudPrint', {
      action: 'test',
      token: session.token,
    }, { loadingTitle: '测试打印中' }).catch(() => null);

    if (!r?.ok) {
      return wx.showToast({ title: r?.message || '测试失败', icon: 'none' });
    }

    wx.showToast({ title: '已发送测试打印', icon: 'success' });
    this.onRefreshCloudPrintStatus({ silent: true });
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
    this.onRefreshCloudPrintStatus({ silent: true });
    wx.showToast({ title: '打印机配置已保存', icon: 'success' });
  },
};
