const { ensureLogin, isLoginOK, refreshUserToStorage } = require('../../../utils/auth');
const { callUser } = require('../../../utils/cloud');
const { safeStr, toNum } = require('../../../utils/common');
const { groupUserCoupons } = require('../../../utils/coupon');

Page({
  data: {
    activeTab: 'available', // available, mine
    availableCoupons: [],
    myCoupons: {
      unused: [],
      used: [], // 暂不处理“已使用/已过期”
      expired: []
    },
    loading: false,
    claimingIds: {},
    refresherTriggered: false
  },

  onLoad() {
    this.refreshData();
  },

  onShow() {
    // onShow 时也刷新，以便从结算页回来能看到券被使用
    this.refreshData();
  },

  onPullDownRefresh() {
    this.onRefresherRefresh();
  },

  onRefresherRefresh() {
    if (this.data.refresherTriggered) return;
    this.setData({ refresherTriggered: true });
    this.refreshData().finally(() => {
      this.setData({ refresherTriggered: false });
      try { wx.stopPullDownRefresh(); } catch (_) {}
    });
  },

  async refreshData(options = {}) {
    const { silent = false } = options;
    if (!isLoginOK()) {
      try {
        await ensureLogin();
      } catch (e) {
        wx.showToast({ title: '请先登录', icon: 'none' });
        return;
      }
    }
    
    if (!silent) this.setData({ loading: true });
    try {
      const tasks = [
        callUser('listAvailableCoupons'),
        callUser('getMe')
      ];
      const [resAvailable, resMe] = await Promise.all(tasks);

      const availableCoupons = resAvailable?.result?.data || [];
      const me = resMe?.result?.data;
      const userCoupons = me?.coupons || [];

      const myCouponsCategorized = { unused: [], used: [], expired: [] };
      const userCouponIds = new Set(userCoupons.map(c => c.couponId));

      myCouponsCategorized.unused = groupUserCoupons(userCoupons);

      const finalAvailable = availableCoupons.filter(c => !userCouponIds.has(c._id));

      const nextClaimingIds = {};
      (finalAvailable || []).forEach(c => {
        if (this.data.claimingIds[c._id]) nextClaimingIds[c._id] = true;
      });

      this.setData({
        availableCoupons: finalAvailable,
        myCoupons: myCouponsCategorized,
        claimingIds: nextClaimingIds
      });

      if (me) refreshUserToStorage(me).catch(() => {});

    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      if (!silent) this.setData({ loading: false });
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab !== this.data.activeTab) {
      this.setData({ activeTab: tab });
    }
  },

  async onClaim(e) {
    const couponId = e.currentTarget.dataset.id;
    if (!couponId) return;
    if (this.data.claimingIds[couponId]) return;

    if (!isLoginOK()) {
      try {
        await ensureLogin();
      } catch (err) {
        wx.showToast({ title: '\u8bf7\u5148\u767b\u5f55', icon: 'none' });
        return;
      }
    }

    const alreadyClaimed = (this.data.myCoupons?.unused || []).some(c => c.couponId === couponId);
    if (alreadyClaimed) {
      wx.showToast({ title: '\u5df2\u9886\u53d6\u8fc7\u4e86', icon: 'none' });
      return;
    }

    try {
      this.setData({ [`claimingIds.${couponId}`]: true });
      wx.showLoading({ title: '领取中...', mask: true });
      const res = await callUser('claimCoupon', { couponId });
      
      if (res.result && res.result.ok) {
        wx.showToast({ title: '领取成功', icon: 'success' });
        this.optimisticUpdateAfterClaim(couponId, res.result.data);
        this.refreshData({ silent: true }).catch(() => {});
      } else {
        throw new Error(res.result.error || '领取失败');
      }
    } catch (e) {
      const msg = e.message || '\u9886\u53d6\u5931\u8d25';
      wx.showToast({ title: msg, icon: 'none' });
      if (msg.includes('\u5df2\u9886') || msg.includes('\u9886\u5b8c') || msg.includes('\u4e0b\u67b6')) {
        this.refreshData({ silent: true }).catch(() => {});
      }
    } finally {
      wx.hideLoading();
      this.setData({ [`claimingIds.${couponId}`]: false });
    }
  },

  optimisticUpdateAfterClaim(claimedCouponId, newUserCoupon) {
    const { availableCoupons, myCoupons } = this.data;
    const newAvailable = availableCoupons.filter(c => c._id !== claimedCouponId);
    if (!newUserCoupon || !newUserCoupon.userCouponId) {
      this.setData({ availableCoupons: newAvailable });
      return;
    }

    const couponId = safeStr(newUserCoupon.couponId).trim();
    const title = safeStr(newUserCoupon.title).trim();
    const minSpend = toNum(newUserCoupon.minSpend, 0);
    const discount = toNum(newUserCoupon.discount, 0);
    const groupKey = `${couponId}|${minSpend}|${discount}|${title}`;

    const nextUnused = (myCoupons.unused || []).map(x => ({ ...x }));
    const idx = nextUnused.findIndex(x => x.groupKey === groupKey);
    if (idx >= 0) {
      nextUnused[idx].count = toNum(nextUnused[idx].count, 1) + 1;
      nextUnused[idx].lastClaimedAt = Math.max(toNum(nextUnused[idx].lastClaimedAt, 0), toNum(newUserCoupon.claimedAt, 0));
    } else {
      nextUnused.unshift({
        groupKey,
        couponId,
        title,
        minSpend,
        discount,
        count: 1,
        lastClaimedAt: toNum(newUserCoupon.claimedAt, 0),
      });
    }

    this.setData({
      availableCoupons: newAvailable,
      'myCoupons.unused': nextUnused,
    });
  },

  goOrder() {
    wx.switchTab({
      url: '/pages/order/order',
    });
  }
});
