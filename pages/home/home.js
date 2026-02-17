const { callUser } = require('../../utils/cloud');
const { getTempUrlMap } = require('../../utils/cloudFile');
const { ORDER_MODE: KEY_ORDER_MODE } = require('../../utils/storageKeys');
const { getShopConfigCache, setShopConfigCache } = require('../../utils/shopConfigCache');

const CACHED_SHOP_CFG = getShopConfigCache() || {};

Page({
  data: {
    showUI: true,
    storeName: CACHED_SHOP_CFG.storeName || '',
    waimaiOn: CACHED_SHOP_CFG.waimaiOn !== false,
    kuaidiOn: CACHED_SHOP_CFG.kuaidiOn !== false,
    loading: true,
    banners: [],

    memberStats: {
      memberLevel: 0,
      memberName: '普通会员',
      balance: '0.00',
      points: 0,
      coupons: 0
    }
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    this.setData({ showUI: false }, () => {
      setTimeout(() => {
        this.setData({ showUI: true });
      }, 50);
    });

    this.loadMemberStats();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  async initPage() {
    const [shopPatch, memberPatch] = await Promise.all([
      this.loadShopInfo({ returnPatch: true }),
      this.loadMemberStats({ returnPatch: true }),
    ]);

    this.setData({ ...(shopPatch || {}), ...(memberPatch || {}), loading: false });
  },

  async loadShopInfo(opts = {}) {
    const returnPatch = !!opts.returnPatch;
    try {
      const res = await callUser('getShopConfig', {});
      const data = res?.result?.data || {};

      setShopConfigCache(data);
      
      const bannerIds = Array.isArray(data.banners) ? data.banners : [];
      let banners = [];
      if (bannerIds.length > 0) {
        const urlMap = await getTempUrlMap(bannerIds);
        banners = bannerIds.map(id => urlMap[id]).filter(Boolean);
      }

      const patch = { 
        storeName: data.storeName || '',
        waimaiOn: data.waimaiOn !== false,
        kuaidiOn: data.kuaidiOn !== false,
        banners
      };

      if (returnPatch) return patch;
      this.setData(patch);
    } catch (e) { console.error(e); }
    return returnPatch ? null : undefined;
  },

  async loadMemberStats(opts = {}) {
    const returnPatch = !!opts.returnPatch;
    try {
      const res = await callUser('getMe');
      const me = res?.result?.data;
      if (me) {
        const memberLevelNum = Number(me.memberLevel || 0);
        const memberLevel = Number.isFinite(memberLevelNum) ? memberLevelNum : 0;
        const patch = {
          memberStats: {
            memberLevel,
            memberName: memberLevel >= 4 ? '尊享会员' : '普通会员',
            balance: (typeof me.balance === 'number' ? me.balance : 0).toFixed(2), 
            points: me.points || 0, 
            coupons: Array.isArray(me.coupons) ? me.coupons.length : 0 
          },
        };

        if (returnPatch) return patch;
        this.setData(patch);
      }
    } catch (e) { console.error(e); }
    return returnPatch ? null : undefined;
  },

  onNavTap(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode) return;
    wx.vibrateShort({ type: 'light' });
    
    if (mode === 'waimai' && !this.data.waimaiOn) {
      return wx.showToast({ title: '外卖业务暂未开放', icon: 'none' });
    }
    if (mode === 'kuaidi' && !this.data.kuaidiOn) {
      return wx.showToast({ title: '快递业务暂未开放', icon: 'none' });
    }
    
    wx.setStorageSync(KEY_ORDER_MODE, mode);
    wx.switchTab({ url: '/pages/order/order' });
  },

  goAsset(e) {
    const type = e.currentTarget.dataset.type;
    wx.vibrateShort({ type: 'light' });
    
    const routes = {
      'balance': '/pages/mine/recharge/recharge',
      'points': '/pages/mine/points/points',
      'coupon': '/pages/mine/coupon/index',
      'member': '/pages/mine/member/member'
    };
    
    if (routes[type]) wx.navigateTo({ url: routes[type] });
  },

  onShareAppMessage() {
    return { title: this.data.storeName, path: '/pages/home/home' };
  },

  onShareTimeline() {
    return {
      title: this.data.storeName || '',
      query: '',
    };
  }
});
