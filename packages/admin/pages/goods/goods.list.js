
const { requireLogin, getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { modesToText } = require('./goods.helpers');

let keywordTimer = null;

module.exports = {
  onShow() {
    if (requireLogin()) this.loadCategoriesAndList(true);
  },

  onPullDownRefresh() {
    this.loadCategoriesAndList(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.loading && this.data.hasMore) this.fetchList(false);
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || '' });
    clearTimeout(keywordTimer);
    keywordTimer = setTimeout(() => this.fetchList(true), 350);
  },

  onFilterCategoryChange(e) {
    this.setData({ filterCategoryIndex: Number(e.detail.value || 0) }, () => this.fetchList(true));
  },

  async loadCategoriesAndList(reset) {
    await this.fetchCategories();
    await this.fetchList(reset);
  },

  async fetchCategories() {
    try {
      const prevFilterId = this.data.categories[this.data.filterCategoryIndex]?._id;
      const prevFormId = this.data.categories[this.data.formCategoryIndex]?._id;
      const res = await call('admin', { action: 'categories_list', token: getSession().token });
      if (!res?.ok) return;

      const cats = (res.list || []).filter((c) => c && (c.status == null || c.status === 1));
      const categories = [{ _id: 'all', name: '全部分类' }, ...cats];

      let filterCategoryIndex = categories.findIndex((c) => c._id === prevFilterId);
      if (filterCategoryIndex < 0) filterCategoryIndex = 0;

      let formCategoryIndex = categories.findIndex((c) => c._id === prevFormId);
      if (formCategoryIndex < 0) formCategoryIndex = categories.length > 1 ? 1 : 0;

      const patch = { categories, filterCategoryIndex, formCategoryIndex };
      if (this.data.showForm) {
        patch['form.categoryId'] = categories[formCategoryIndex]?._id || '';
      }
      this.setData(patch);
    } catch (e) {
      if (e?.code === 'AUTH_EXPIRED') return;
      console.error('[goods] fetchCategories error', e);
    }
  },

  async fetchList(reset) {
    const session = getSession();
    if (!session?.token || this.data.loading) return;

    const pageNum = reset ? 1 : this.data.pageNum;
    const { pageSize, keyword, categories, filterCategoryIndex } = this.data;
    const cat = categories[filterCategoryIndex];
    const categoryId = (cat?._id !== 'all') ? String(cat?._id || '') : '';

    this.setData({ loading: true });

    try {
      const res = await call('admin', {
        action: 'products_list',
        token: session.token,
        keyword,
        categoryId,
        pageNum,
        pageSize,
      });

      if (!res?.ok) {
        wx.showToast({ title: res?.message || '加载失败', icon: 'none' });
        return;
      }

      const incoming = (res.list || []).map((it) => ({
        ...it,
        modesText: modesToText(it.modes),
      }));

      const hasMore = incoming.length === pageSize;
      const nextList = reset ? incoming : [...this.data.list, ...incoming];
      this.setData({ list: nextList, hasMore, pageNum: hasMore ? pageNum + 1 : pageNum });
    } catch (e) {
      if (e?.code === 'AUTH_EXPIRED') return;
      console.error('[goods] fetchList error', e);
      wx.showToast({ title: '加载异常', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
};
