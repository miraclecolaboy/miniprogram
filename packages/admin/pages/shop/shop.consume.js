// packages/admin/pages/shop/shop.consume.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');

module.exports = {
  // ===== 核销（6位码，核销后即消失）=====
  onConsumeCodeInput(e) {
    this.setData({ consumeCode: safeStr(e.detail.value), consumeTip: '' });
  },

  async onConsume() {
    const session = getSession();
    if (!session?.token) return;

    const code = safeStr(this.data.consumeCode);
    if (!/^\d{6}$/.test(code)) {
      this.setData({ consumeTip: '核销码必须是6位数字' });
      return wx.showToast({ title: '请输入6位核销码', icon: 'none' });
    }

    const r = await call('admin', { action: 'points_consumeCode', token: session.token, code }, { loadingTitle: '核销中' }).catch(() => null);

    if (!r?.ok) {
      const msg = r?.message || '核销失败';
      this.setData({ consumeTip: msg });
      return wx.showToast({ title: msg, icon: 'none' });
    }

    this.setData({ consumeCode: '', consumeTip: '核销成功' });

    wx.showModal({
      title: '核销成功',
      content: `礼品：${r.data?.giftName || ''}\n消耗积分：${r.data?.costPoints || ''}`,
      showCancel: false,
    });
  },
};

