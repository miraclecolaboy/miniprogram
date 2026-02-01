// packages/admin/pages/shop/shop.notice.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');

module.exports = {
  onNoticeInput(e) {
    this.setData({ notice: safeStr(e.detail.value), noticeChanged: true });
  },

  async onSaveNotice() {
    const session = getSession();
    if (!session?.token) return;
    if (!this.data.noticeChanged) return;
    const r = await call('admin', {
      action: 'shop_setNotice',
      token: session.token,
      notice: safeStr(this.data.notice),
    }, { loadingTitle: '保存中' }).catch(() => null);
    if (!r?.ok) return wx.showToast({ title: r?.message || '保存失败', icon: 'none' });
    this.setData({ noticeChanged: false });
    wx.showToast({ title: '已保存', icon: 'success' });
  },
};

