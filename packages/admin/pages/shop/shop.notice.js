
const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');

module.exports = {
  onNoticeInput(e) {
    const notice = safeStr(e.detail.value).slice(0, 20);
    this.setData({ notice, noticeChanged: true });
  },

  async onSaveNotice() {
    const session = getSession();
    if (!session?.token) return;
    if (!this.data.noticeChanged) return;

    const notice = safeStr(this.data.notice);
    if (notice.length > 20) return wx.showToast({ title: '公告最多20字', icon: 'none' });

    const r = await call('admin', {
      action: 'shop_setNotice',
      token: session.token,
      notice,
    }, { loadingTitle: '保存中' }).catch(() => null);

    if (!r?.ok) return wx.showToast({ title: r?.message || '保存失败', icon: 'none' });
    this.setData({ noticeChanged: false });
    wx.showToast({ title: '已保存', icon: 'success' });
  },
};
