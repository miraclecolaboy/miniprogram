
const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr, toNum } = require('../../../../utils/common');
const { toInt } = require('./shop.helpers');

module.exports = {
  async loadCoupons() {
    const session = getSession();
    if (!session?.token) return;
    try {
      const res = await call('admin', { action: 'coupons_list', token: session.token });
      if (res?.ok) this.setData({ coupons: res.list || [] });
    } catch (e) {
      console.error('[shop] loadCoupons failed', e);
    }
  },

  openEditCoupon(e) {
    const id = e.currentTarget.dataset.id;
    const coupon = (this.data.coupons || []).find((c) => c._id === id);
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
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
  },

  cancelCouponEdit() {
    this.setData({
      editingCouponId: '',
      editingCouponTitle: '',
      couponForm: { title: '', minSpend: '', discount: '', totalQuantity: '' },
    });
  },

  onCouponFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`couponForm.${field}`]: e.detail.value });
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
        data,
      }, { loadingTitle: '保存中' });

      if (!res?.ok) throw new Error(res?.message || '保存失败');

      wx.showToast({ title: '已保存', icon: 'success' });
      this.cancelCouponEdit();
      await this.loadCoupons();
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ couponSaving: false });
    }
  },

  async deleteCoupon(e) {
    const id = safeStr(e.currentTarget.dataset.id);
    if (!id) return;

    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '删除优惠券',
        content: '删除后不可恢复，用户将无法再领取。',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    try {
      const res = await call('admin', {
        action: 'coupons_delete',
        token: getSession().token,
        id,
      }, { loadingTitle: '删除中' });

      if (!res?.ok) throw new Error(res?.message || '删除失败');
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.loadCoupons();
    } catch (e) {
      wx.showToast({ title: e.message || '删除失败', icon: 'none' });
    }
  },

  noop() {},
};
