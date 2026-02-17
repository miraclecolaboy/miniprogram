const { ensureLogin, refreshUserToStorage } = require('../../../utils/auth');
const { callUser } = require('../../../utils/cloud');

const {
  MEMBER_LEVEL: KEY_MEMBER_LEVEL,
  TOTAL_RECHARGE: KEY_TOTAL_RECHARGE,
} = require('../../../utils/storageKeys');

const LEVELS = [
  { level: 1, threshold: 100 },
  { level: 2, threshold: 300 },
  { level: 3, threshold: 500 },
  { level: 4, threshold: 1000 },
];

function fmtYuan(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toFixed(0) : '0';
}

Page({
  data: {
    memberLevel: 0,
    memberTitle: '',
    totalRecharge: 0,
    progressStyle: 'width: 0%;',
    nextLevelText: '',
  },

  onLoad() {
    const memberLevel = Number(wx.getStorageSync(KEY_MEMBER_LEVEL) || 0);
    const totalRecharge = Number(wx.getStorageSync(KEY_TOTAL_RECHARGE) || 0);
    this.setMemberState(memberLevel, totalRecharge);
  },

  async onShow() {
    try {
      const u = await ensureLogin();
      if (!u) return;

      const res = await callUser('getMe', {});
      const me = res?.result?.data;
      if (!me) return;

      refreshUserToStorage(me).catch(() => {});

      const memberLevel = Number(me.memberLevel || 0);
      const totalRecharge = Number(me.totalRecharge || 0);
      this.setMemberState(memberLevel, totalRecharge);
    } catch (e) {
      console.error('[member] onShow error', e);
    }
  },

  setMemberState(memberLevel, totalRecharge) {
    const lv = Number(memberLevel || 0);
    const total = Number(totalRecharge || 0);
    const memberTitle = lv >= 4 ? 'Lv.4尊享会员' : `Lv.${Math.max(0, lv)}会员`;
      
    let progress = 0;
    let nextLevelText = lv >= 4 ? `${memberTitle} 95折权益生效中` : '';

    const nextTarget = LEVELS.find(l => l.threshold > total);

    if (nextTarget) {
      if (nextTarget.threshold > 0) {
        progress = (total / nextTarget.threshold) * 100;
      }
      progress = Math.min(Math.max(progress, 0), 100);
      
      const diff = nextTarget.threshold - total;
      const targetTitle = nextTarget.level >= 4 ? 'Lv.4尊享会员' : `Lv.${nextTarget.level}会员`;
      nextLevelText = `再充${fmtYuan(diff)}元 升级至${targetTitle}`;
    } else {
      progress = 100;
      nextLevelText = `${memberTitle} 95折权益生效中`;
    }

    const progressStyle = `width: ${progress.toFixed(1)}%;`;

    this.setData({
      memberLevel: lv,
      memberTitle,
      totalRecharge: total,
      progressStyle,
      nextLevelText
    });
  },

  onTapRecharge() {
    wx.navigateTo({ url: '/pages/mine/recharge/recharge' });
  },
});
