
const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { toInt } = require('./goods.helpers');

module.exports = {
  openCategoryForm() {
    this.setData({
      showCategoryForm: true,
      categorySaving: false,
      categoryDeletingId: '',
      categoryForm: { name: '', sort: '0' },
    });
  },

  closeCategoryForm() {
    this.setData({ showCategoryForm: false, categoryDeletingId: '' });
  },

  onCategoryInput(e) {
    this.setData({ [`categoryForm.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  async saveCategory() {
    const { name, sort } = this.data.categoryForm;
    if (!safeStr(name)) return wx.showToast({ title: '请输入分组名称', icon: 'none' });

    this.setData({ categorySaving: true });
    try {
      const r = await call('admin', {
        action: 'categories_add',
        token: getSession().token,
        name: safeStr(name),
        sort: toInt(sort, 0),
      });
      if (!r?.ok) throw new Error(r?.message || '新增失败');

      wx.showToast({ title: '已新增', icon: 'success' });
      await this.fetchCategories();
      await this.fetchList(true);
      this.setData({ categoryForm: { name: '', sort: '0' } });
    } catch (e) {
      if (e?.code === 'AUTH_EXPIRED') return;
      wx.showToast({ title: e.message || '新增失败', icon: 'none' });
    } finally {
      this.setData({ categorySaving: false });
    }
  },

  async removeCategory(e) {
    const id = safeStr(e?.currentTarget?.dataset?.id);
    const name = safeStr(e?.currentTarget?.dataset?.name) || '该分组';
    if (!id || id === 'all') return;
    if (this.data.categoryDeletingId === id || this.data.categorySaving) return;

    const confirmRes = await new Promise((resolve) => wx.showModal({
      title: '确认删除分组',
      content: `删除后无法恢复，是否删除“${name}”？`,
      confirmText: '删除',
      confirmColor: '#fa5151',
      success: resolve,
      fail: () => resolve({ confirm: false }),
    }));
    if (!confirmRes.confirm) return;

    this.setData({ categoryDeletingId: id });
    try {
      const r = await call('admin', {
        action: 'categories_remove',
        token: getSession().token,
        id,
      });
      if (!r?.ok) throw new Error(r?.message || '删除失败');

      wx.showToast({ title: '已删除', icon: 'success' });
      await this.fetchCategories();
      await this.fetchList(true);
    } catch (e) {
      if (e?.code === 'AUTH_EXPIRED') return;
      wx.showToast({ title: e.message || '删除失败', icon: 'none' });
    } finally {
      this.setData({ categoryDeletingId: '' });
    }
  },
};
