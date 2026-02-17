
const { requireLogin } = require('../../utils/auth');
const { call } = require('../../utils/cloud');

module.exports = {
  onCopyAddress(e) {
    const text = e.currentTarget.dataset.copytext || '';
    if (text) wx.setClipboardData({ data: text });
  },

  onCallPhone(e) {
    const phone = String(e.currentTarget.dataset.phone || '').trim();
    if (!phone) return;
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: (err) => {
        const msg = String(err?.errMsg || '');
        if (!msg.includes('cancel')) {
          wx.showToast({ title: '拨号失败', icon: 'none' });
        }
      }
    });
  },

  onOpenExpressModal(e) {
    const orderId = e.currentTarget.dataset.id || '';
    const no = e.currentTarget.dataset.no || '';
    if (!orderId) return;
    this.setData({ expressModal: { show: true, orderId, value: no } });
  },

  onCloseExpressModal() {
    this.setData({ expressModal: { show: false, orderId: '', value: '' } });
  },

  onExpressInput(e) {
    this.setData({ 'expressModal.value': String(e.detail?.value || '').trim() });
  },

  async onConfirmExpress() {
    const session = requireLogin();
    if (!session) return;
    const { orderId, value } = this.data.expressModal || {};
    const expressNo = String(value || '').trim();
    if (!orderId || !expressNo) return wx.showToast({ title: '请输入快递单号', icon: 'none' });
    wx.showLoading({ title: '提交中', mask: true });
    try {
      const res = await call('admin', { action: 'orders_setExpressNo', token: session.token, id: orderId, expressNo });
      if (!res || !res.ok) throw new Error(res?.message || '提交失败');
      wx.showToast({ title: '已保存', icon: 'success' });
      this.onCloseExpressModal();
      await this.reload();
    } catch (e) {
      wx.showToast({ title: e?.message || '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onUpdateStatus(e) {
    const { id, status } = e.currentTarget.dataset;
    if (!id || !status) return;
    const session = requireLogin();
    if (!session) return;
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await call('admin', { action: 'orders_updateStatus', token: session.token, id, status });
      if (!res || !res.ok) throw new Error(res?.message || '操作失败');
      wx.showToast({ title: '已更新', icon: 'success' });
      await this.reload();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onApplyRefund(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const session = requireLogin();
    if (!session) return;
    const order = (this.data.list || []).find((x) => x?._id === id);
    const doneAt = order?.doneAt || 0;
    const over3Days = order?.status === 'done' && doneAt > 0 && (Date.now() - doneAt) > 3 * 24 * 60 * 60 * 1000;
    const ok = await new Promise((resolve) => wx.showModal({
      title: '申请售后',
      content: over3Days ? '该订单已完成超过3天，仍要申请售后吗？' : '确认对该订单发起售后申请？',
      confirmText: over3Days ? '继续申请' : '确认',
      cancelText: '取消',
      success: (r) => resolve(!!r.confirm),
    }));
    if (!ok) return;
    wx.showLoading({ title: '提交中', mask: true });
    try {
      const res = await call('admin', { action: 'orders_applyRefund', token: session.token, id, reason: '商家发起', remark: '' });
      if (!res || !res.ok) throw new Error(res?.message || '提交失败');
      wx.showToast({ title: '已提交售后', icon: 'success' });
      this.reload();
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onPrint(e) {
    const s = requireLogin();
    if (!s) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showLoading({ title: '打印中', mask: true });
    try {
      const r = await call('cloudPrint', { action: 'printOrder', token: s.token, orderId: id });
      if (r && r.ok) return wx.showToast({ title: '已发送', icon: 'success' });
      wx.showModal({ title: '打印失败', content: r?.message || '云打印失败', showCancel: false });
    } catch (err) {
      if (err?.code !== 'AUTH_EXPIRED') {
        wx.showModal({ title: '打印失败', content: err?.message || '云打印失败', showCancel: false });
      }
    } finally {
      wx.hideLoading();
    }
  },

  goRefundHandle(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/packages/admin/pages/orders/refund-handle/index?id=${id}` });
  },

  noop() {},
};
