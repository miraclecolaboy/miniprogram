
const { requireLogin } = require('../../../utils/auth');
const { call } = require('../../../utils/cloud');
const { pickKey, shouldQueryRefund } = require('./refund-handle.helpers');

module.exports = {
  onLoad(options) {
    wx.setNavigationBarTitle({ title: '售后处理' });

    const key = pickKey(options);
    if (!key) {
      wx.showToast({ title: '缺少订单参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 300);
      return;
    }

    this._refundQueryKeys = Object.create(null);
    this._remarkTouched = false;
    this.setData({ key }, () => this.loadOrder(true));
  },

  onShow() {
    const s = requireLogin();
    if (!s) return;
    if (this.data.key) this.loadOrder(false);
  },

  onPullDownRefresh() {
    this.loadOrder(false).finally(() => wx.stopPullDownRefresh());
  },

  onRemarkInput(e) {
    this._remarkTouched = true;
    this.setData({ remark: String(e.detail?.value || '') });
  },

  async loadOrder(showLoading) {
    if (this._fetching) return;
    this._fetching = true;

    const session = requireLogin();
    if (!session) {
      this._fetching = false;
      return;
    }

    const key = this.data.key;
    if (!key) {
      this._fetching = false;
      return;
    }

    if (showLoading) wx.showLoading({ title: '加载中' });
    this.setData({ loading: true });

    try {
      const res = await call('admin', { action: 'orders_get', key, token: session.token });
      if (!res || !res.ok) throw new Error(res?.message || '订单不存在或加载失败');

      let o = res.data || null;

      if (o && shouldQueryRefund(o)) {
        const outRefundNo = String(o?.refund?.outRefundNo || '').trim();
        const qk = `${o._id}_${outRefundNo}`;
        if (!this._refundQueryKeys[qk]) {
          this._refundQueryKeys[qk] = 1;
          try {
            await call('admin', { action: 'orders_refundQuery', id: o._id, token: session.token });
            const res2 = await call('admin', { action: 'orders_get', key: o._id, token: session.token });
            if (res2 && res2.ok && res2.data) o = res2.data;
          } catch (_) {}
        }
      }

      const decorated = o ? this.decorateOrder(o) : null;
      if (decorated && !this._remarkTouched && !String(this.data.remark || '').trim()) {
        const handleRemark = String(decorated.refundHandleRemarkText || '').trim();
        if (handleRemark) this.setData({ remark: handleRemark });
      }
      this.setData({ order: decorated });
    } catch (e) {
      console.error('[refund-handle] loadOrder error', e);
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      this.setData({ order: null });
    } finally {
      this.setData({ loading: false });
      if (showLoading) wx.hideLoading();
      this._fetching = false;
    }
  },

  async handle(decision) {
    const order = this.data.order;
    if (!order || !order._id) return;

    const session = requireLogin();
    if (!session) return;

    const title = decision === 'approve' ? '同意售后' : '拒绝售后';
    const content = decision === 'approve'
      ? '确认同意本次售后？系统将原路退款。'
      : '确认拒绝本次售后？';

    const { confirm } = await new Promise((resolve) => {
      wx.showModal({ title, content, confirmText: '确定', cancelText: '取消', success: resolve });
    });
    if (!confirm) return;

    wx.showLoading({ title: '处理中', mask: true });
    try {
      const remark = String(this.data.remark || '').trim();
      const res = await call('admin', {
        action: 'orders_refundHandle',
        token: session.token,
        id: order._id,
        decision,
        remark,
      });

      if (!res || !res.ok) throw new Error(res?.message || '操作失败');
      wx.showToast({ title: res.message || '已处理', icon: 'success' });
      await this.loadOrder(false);
    } catch (e) {
      console.error('[refund-handle] handle error', e);
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onApprove() { this.handle('approve'); },
  onReject() { this.handle('reject'); },
};

