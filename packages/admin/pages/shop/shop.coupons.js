// packages/admin/pages/shop/shop.coupons.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr, toNum } = require('../../../../utils/common');
const { toInt } = require('./shop.helpers');

module.exports = {
  // ===== 优惠券管理 =====
  async loadCoupons() {
    const session = getSession();
    if (!session?.token) return;
    try {
      const res = await call('admin', { action: 'coupons_list', token: session.token });
      if (res && res.ok) {
        this.setData({ coupons: res.list || [] });
      }
    } catch (e) {
      console.error('[shop] loadCoupons failed', e);
    }
  },

  // 点击“编辑”按钮
  openEditCoupon(e) {
    const id = e.currentTarget.dataset.id;
    const coupon = this.data.coupons.find((c) => c._id === id);
    if (!coupon) return;

    this.setData({
      editingCouponId: id,
      editingCouponTitle: coupon.title,
      couponForm: {
        title: coupon.title,
        minSpend: String(coupon.minSpend),
        discount: String(coupon.discount),
        totalQuantity: String(coupon.totalQuantity),
      },
    });
    // 滚动到页面顶部，方便编辑
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
  },

  // 点击“取消编辑”
  cancelCouponEdit() {
    this.setData({
      editingCouponId: '',
      editingCouponTitle: '',
      couponForm: { title: '', minSpend: '', discount: '', totalQuantity: '' },
    });
  },

  onCouponFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`couponForm.${field}`]: e.detail.value,
    });
  },

  async saveCouponForm() {
    if (this.data.couponSaving) return;

    const { couponForm, editingCouponId } = this.data;
    const data = {
      id: editingCouponId || '',
      title: safeStr(couponForm.title),
      minSpend: toNum(couponForm.minSpend),
      discount: toNum(couponForm.discount),
      totalQuantity: toInt(couponForm.totalQuantity),
    };

    if (!data.title) return wx.showToast({ title: '请输入优惠券标题', icon: 'none' });
    if (data.minSpend < 0) return wx.showToast({ title: '最低消费金额不合法', icon: 'none' });
    if (data.discount <= 0) return wx.showToast({ title: '减免金额必须大于0', icon: 'none' });
    if (data.minSpend > 0 && data.discount > data.minSpend) return wx.showToast({ title: '减免金额不能大于最低消费', icon: 'none' });
    if (data.totalQuantity <= 0) return wx.showToast({ title: '总数量必须大于0', icon: 'none' });

    this.setData({ couponSaving: true });

    try {
      const res = await call('admin', {
        action: 'coupons_upsert',
        token: getSession().token,
        data: data,
      }, { loadingTitle: '保存中' });

      if (!res.ok) throw new Error(res.message || '保存失败');

      wx.showToast({ title: '已保存', icon: 'success' });
      this.cancelCouponEdit(); // 保存成功后清空表单
      await this.loadCoupons();
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ couponSaving: false });
    }
  },

  async toggleCouponStatus(e) {
    const { id, status } = e.currentTarget.dataset;
    const newStatus = status !== 'active';
    const confirmText = newStatus ? '上架' : '下架';

    const { confirm } = await new Promise((resolve) => wx.showModal({
      title: `确认${confirmText}？`,
      content: newStatus ? '上架后用户即可领取。' : '下架后用户将无法领取。',
      success: resolve,
    }));

    if (!confirm) return;

    try {
      await call('admin', {
        action: 'coupons_toggle_status',
        token: getSession().token,
        id,
        status: newStatus,
      }, { loadingTitle: '处理中' });

      wx.showToast({ title: `已${confirmText}`, icon: 'success' });
      await this.loadCoupons();
    } catch (e) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    }
  },

  noop() {},
};

