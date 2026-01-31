// pages/mine/member/member.js
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
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toFixed(2);
}

function getMemberTag(memberLevel, totalRecharge) {
  const lv = Number(memberLevel || 0);
  if (lv >= 4) return 'Lv4 - 永久95折';
  if (lv > 0) return `Lv${lv} - 累计充值${fmtYuan(totalRecharge)}元`;
  return '';
}

function getNextHint(totalRecharge) {
  const total = Number(totalRecharge || 0);
  if (!Number.isFinite(total)) return '';
  for (const it of LEVELS) {
    if (total < it.threshold) {
      const diff = it.threshold - total;
      return `距离 Lv${it.level} 还差 ${fmtYuan(diff)} 元`;
    }
  }
  return '';
}

Page({
  data: {
    memberLevel: 0,
    totalRecharge: 0,
    memberActive: false,
    memberTag: '',
    nextHint: '',
    vipCardHeight: 140, // fallback
  },

  onLoad() {
    // Render cached state first for faster first paint.
    const memberLevel = Number(wx.getStorageSync(KEY_MEMBER_LEVEL) || 0);
    const totalRecharge = Number(wx.getStorageSync(KEY_TOTAL_RECHARGE) || 0);
    this.setMemberState(memberLevel, totalRecharge);

    this.initVipCardHeight();
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
    const active = lv > 0;
    const tag = getMemberTag(lv, total);
    const nextHint = lv >= 4 ? '' : getNextHint(total);

    this.setData({
      memberLevel: lv,
      totalRecharge: total,
      memberActive: active,
      memberTag: tag,
      nextHint,
    });
  },

  initVipCardHeight() {
    try {
      const systemInfo = wx.getSystemInfoSync();

      // page padding (24rpx*2) + card margin (40rpx*2) = 128rpx
      const totalHorizontalGap = (systemInfo.windowWidth / 750) * 128;
      const cardWidth = systemInfo.windowWidth - totalHorizontalGap;

      this.setData({ vipCardHeight: cardWidth / 2 });
    } catch (_) {
      this.setData({ vipCardHeight: 140 });
    }
  },

  onTapMember() {
    if (!this.data.memberActive) {
      this.onTapRecharge();
      return;
    }
    wx.showToast({ title: `当前等级 Lv${this.data.memberLevel}`, icon: 'none' });
  },

  onTapRecharge() {
    wx.navigateTo({ url: '/pages/mine/recharge/recharge' });
  },
});
