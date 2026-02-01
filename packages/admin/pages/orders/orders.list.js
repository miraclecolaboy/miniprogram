// packages/admin/pages/orders/orders.list.js

const { requireLogin } = require('../../utils/auth');
const { call } = require('../../utils/cloud');

module.exports = {
  async onShow() {
    if (requireLogin()) {
      await this.reload();
    }
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    this.loadMore();
  },

  onTabTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeTab) return;
    this.setData({ activeTab: key }, () => this.reload());
  },

  async reload() {
    this.setData({ pageNum: 1, noMore: false, list: [] });
    await this.fetchList(true);
  },

  async loadMore() {
    if (this.data.loading || this.data.noMore) return;
    await this.fetchList(false);
  },

  async fetchList(reset) {
    const session = requireLogin();
    if (!session) return;

    const { activeTab, pageSize } = this.data;
    const pageNum = reset ? 1 : this.data.pageNum;

    this.setData({ loading: true });

    try {
      const res = await call('admin', {
        action: 'orders_list',
        token: session.token,
        tab: activeTab,
        pageNum: pageNum,
        pageSize: pageSize,
      });

      const newOrders = (res && res.list) ? res.list : [];
      const decoratedOrders = newOrders.map((o) => this.decorateOrder(o));

      const currentOrders = reset ? [] : (this.data.list || []);
      const finalList = currentOrders.concat(decoratedOrders);

      this.setData({
        list: finalList,
        noMore: newOrders.length < pageSize,
        pageNum: pageNum + 1,
      });
    } catch (e) {
      console.warn(`[orders] fetchList for tab ${activeTab} failed`, e);
      if (!reset) this.setData({ noMore: true });
    } finally {
      this.setData({ loading: false });
    }
  },
};

