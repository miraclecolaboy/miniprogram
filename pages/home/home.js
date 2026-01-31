// pages/home/home.js
const { callUser } = require('../../utils/cloud');
const { getTempUrlMap } = require('../../utils/cloudFile'); // [新增] 引入工具
const { ORDER_MODE: KEY_ORDER_MODE } = require('../../utils/storageKeys');

Page({
  data: {
    showUI: true, // 控制动画重置
    storeName: '加载中...',
    kuaidiOn: true,
    loading: true,
    banners: [], // [新增] 轮播图 URL 列表

    // 会员权益数据
    memberStats: {
      levelName: '普通会员',
      balance: '0.00',
      points: 0,
      coupons: 0
    }
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    // 每次显示页面时，先隐藏再显示，强制触发 CSS 动画
    this.setData({ showUI: false }, () => {
      setTimeout(() => {
        this.setData({ showUI: true });
      }, 50); // 50ms 延迟足以让渲染引擎重置
    });

    this.loadMemberStats();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  async initPage() {
    await Promise.all([this.loadShopInfo(), this.loadMemberStats()]);
    this.setData({ loading: false });
  },

  async loadShopInfo() {
    try {
      const res = await callUser('getShopConfig', {});
      const data = res?.result?.data || {};
      
      // [新增] 处理轮播图：ID 转 URL
      const bannerIds = Array.isArray(data.banners) ? data.banners : [];
      let banners = [];
      if (bannerIds.length > 0) {
        const urlMap = await getTempUrlMap(bannerIds);
        banners = bannerIds.map(id => urlMap[id]).filter(Boolean);
      }

      this.setData({ 
        storeName: data.storeName || '',
        kuaidiOn: data.kuaidiOn !== false,
        banners // 设置转换后的图片链接
      });
    } catch (e) { console.error(e); }
  },

  async loadMemberStats() {
    try {
      const res = await callUser('getMe');
      const me = res?.result?.data;
      if (me) {
        this.setData({
          memberStats: { 
            levelName: me.levelName || '普通会员', 
            balance: (typeof me.balance === 'number' ? me.balance : 0).toFixed(2), 
            points: me.points || 0, 
            coupons: Array.isArray(me.coupons) ? me.coupons.length : 0 
          }
        });
      }
    } catch (e) { console.error(e); }
  },

  onNavTap(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode) return;
    wx.vibrateShort({ type: 'light' });
    
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
  }
});