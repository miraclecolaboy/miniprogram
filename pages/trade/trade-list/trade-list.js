const { ensureLogin } = require('../../../utils/auth');
const { callUser } = require('../../../utils/cloud');
const { TRADE_TAB: KEY_TRADE_TAB } = require('../../../utils/storageKeys');

const PAGE_SIZE = 10;

Page({
  data: {
    activeTab: 'doing',
    orders: { doing: [], done: [], refund: [] },
    page: { doing: 1, done: 1, refund: 1 },
    hasMore: { doing: true, done: true, refund: true },
    loading: { doing: false, done: false, refund: false },
  },

  onShow() {
    const targetTab = wx.getStorageSync(KEY_TRADE_TAB);
    if (targetTab && ['doing', 'done', 'refund'].includes(targetTab)) {
      wx.removeStorageSync(KEY_TRADE_TAB);
      if (targetTab !== this.data.activeTab) {
        return this.setData({ activeTab: targetTab }, () => this.refreshList());
      }
    }

    this.refreshList();
  },

  onPullDownRefresh() {
    this.refreshList().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadMore();
  },
  
  async refreshList() {
    try {
      await ensureLogin();
      const tab = this.data.activeTab;
      this.setData({
        [`page.${tab}`]: 1,
        [`hasMore.${tab}`]: true,
      });
      await this.fetchOrders(tab, true);
    } catch (e) {
    }
  },

  async loadMore() {
    const tab = this.data.activeTab;
    if (this.data.loading[tab] || !this.data.hasMore[tab]) return;
    await this.fetchOrders(tab, false);
  },

  async fetchOrders(tab, isRefresh = false) {
    this.setData({ [`loading.${tab}`]: true });

    try {
      const pageNum = isRefresh ? 1 : this.data.page[tab];
      const res = await callUser('listMyOrders', { tab, pageNum, pageSize: PAGE_SIZE });
      const newOrders = res?.result?.data || [];
      const currentOrders = isRefresh ? [] : (this.data.orders[tab] || []);

      this.setData({
        [`orders.${tab}`]: [...currentOrders, ...newOrders],
        [`page.${tab}`]: pageNum + 1,
        [`hasMore.${tab}`]: newOrders.length === PAGE_SIZE,
      });
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ [`loading.${tab}`]: false });
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab }, () => {
      if ((this.data.orders[tab] || []).length === 0 && this.data.hasMore[tab]) {
        this.refreshList();
      }
    });
  },

  goDetail(e) {
    const orderId = e.currentTarget.dataset.id;
    if (!orderId) return;
    
    const allOrders = [...this.data.orders.doing, ...this.data.orders.done, ...this.data.orders.refund];
    const order = allOrders.find(o => o._id === orderId);

    if (order && order.refund) {
      wx.navigateTo({ url: `/pages/trade/trade-refund-detail/trade-refund-detail?orderId=${orderId}` });
      return;
    }

    wx.navigateTo({
      url: `/pages/trade/trade-detail/trade-detail`,
      success: (res) => {
        res.eventChannel.emit('initOrder', { order });
      }
    });
  },
});
