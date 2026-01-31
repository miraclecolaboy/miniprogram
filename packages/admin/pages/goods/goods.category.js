// packages/admin/pages/goods/goods.category.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { toInt } = require('./goods.helpers');

module.exports = {
  openCategoryForm() {
    this.setData({
      showCategoryForm: true,
      categorySaving: false,
      categoryForm: { name: '', sort: '0' },
    });
  },

  closeCategoryForm() {
    this.setData({ showCategoryForm: false });
  },

  onCategoryInput(e) {
    this.setData({ [`categoryForm.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  async saveCategory() {
    const { name, sort } = this.data.categoryForm;
    if (!safeStr(name)) return wx.showToast({ title: '请输入分组名称', icon: 'none' });

    this.setData({ categorySaving: true });
    try {
      await call('admin', {
        action: 'categories_add',
        token: getSession().token,
        name: safeStr(name),
        sort: toInt(sort, 0),
      });

      wx.showToast({ title: '已添加', icon: 'success' });
      this.closeCategoryForm();
      await this.fetchCategories();
    } catch (e) {
      if (e?.code === 'AUTH_EXPIRED') return;
      wx.showToast({ title: e.message || '添加失败', icon: 'none' });
    } finally {
      this.setData({ categorySaving: false });
    }
  },
};

