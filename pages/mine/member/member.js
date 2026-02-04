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

const BASE_LEVEL_CARDS = [
  {
    level: 0,
    title: '普通会员',
    threshold: 0,
    thresholdText: '0',
    brief: '充值升级解锁更多权益',
    benefits: ['可充值升级 Lv1-Lv4', '升级可领取对应礼包（每个等级仅一次）'],
  },
  {
    level: 1,
    title: 'Lv1 会员',
    threshold: 100,
    thresholdText: '100',
    brief: '升级送券礼包（仅一次）',
    benefits: ['累计充值满 100 元升级', '赠送无门槛券：2 张 5 元'],
  },
  {
    level: 2,
    title: 'Lv2 会员',
    threshold: 300,
    thresholdText: '300',
    brief: '升级送券礼包（仅一次）',
    benefits: ['累计充值满 300 元升级', '赠送无门槛券：3 张 5 元 + 1 张 10 元'],
  },
  {
    level: 3,
    title: 'Lv3 会员',
    threshold: 500,
    thresholdText: '500',
    brief: '升级送券礼包（仅一次）',
    benefits: ['累计充值满 500 元升级', '赠送无门槛券：5 张 5 元 + 1 张 20 元'],
  },
  {
    level: 4,
    title: 'Lv4 VIP',
    threshold: 1000,
    thresholdText: '1000',
    brief: '全场下单享 9.5 折',
    benefits: ['累计充值满 1000 元升级', '永久 9.5 折（下单自动抵扣）', '赠送无门槛券：5 张 10 元 + 2 张 20 元'],
  },
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

function getExpState(memberLevel, totalRecharge) {
  const lv = Number(memberLevel || 0);
  const total = Number(totalRecharge || 0);
  if (!Number.isFinite(total)) {
    return { expPercent: 0, expText: '经验 0 / 0', expSub: '' };
  }

  if (lv >= 4) {
    return {
      expPercent: 100,
      expText: `累计充值 ${fmtYuan(total)} 元`,
      expSub: '已达最高等级',
    };
  }

  const next = LEVELS[lv] || LEVELS[LEVELS.length - 1];
  const nextThreshold = Number(next.threshold || 0);
  const prevThreshold = lv <= 0 ? 0 : Number(LEVELS[lv - 1]?.threshold || 0);
  const segment = Math.max(1, nextThreshold - prevThreshold);
  const progress = Math.min(1, Math.max(0, (total - prevThreshold) / segment));
  const percent = Math.round(progress * 100);
  const diff = Math.max(0, nextThreshold - total);
  return {
    expPercent: percent,
    expText: `累计充值 ${fmtYuan(total)} / ${fmtYuan(nextThreshold)} 元`,
    expSub: `距离 Lv${next.level} 还差 ${fmtYuan(diff)} 元`,
  };
}

function levelToIndex(level) {
  const lv = Number(level || 0);
  if (!Number.isFinite(lv)) return 0;
  return Math.max(0, Math.min(4, Math.round(lv)));
}

function buildLevelCards(memberLevel, totalRecharge) {
  const lv = Number(memberLevel || 0);
  const total = Number(totalRecharge || 0);

  return BASE_LEVEL_CARDS.map((card) => {
    if (card.level === 0) {
      const hint = lv > 0 ? `当前 Lv${lv}` : '去充值升级';
      return { ...card, hint };
    }

    if (lv >= card.level) {
      const hint = lv === card.level ? '当前等级' : '已解锁';
      return { ...card, hint };
    }

    const diff = Math.max(0, Number(card.threshold || 0) - total);
    return { ...card, hint: `还差 ￥${fmtYuan(diff)}` };
  });
}

Page({
  data: {
    memberLevel: 0,
    totalRecharge: 0,
    memberActive: false,
    memberTag: '',
    nextHint: '',
    vipCardHeight: 140, // fallback

    levelCards: [],
    currentIndex: 0,
    currentCard: BASE_LEVEL_CARDS[0],

    expPercent: 0,
    expText: '',
    expSub: '',
  },

  onLoad() {
    this._hasUserSwiped = false;

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
    const expState = getExpState(lv, total);
    const levelCards = buildLevelCards(lv, total);
    const currentIndex = this._hasUserSwiped ? Number(this.data.currentIndex || 0) : levelToIndex(lv);

    const nextData = {
      memberLevel: lv,
      totalRecharge: total,
      memberActive: active,
      memberTag: tag,
      nextHint,
      ...expState,
      levelCards,
    };

    nextData.currentIndex = currentIndex;
    nextData.currentCard = levelCards[currentIndex] || levelCards[0] || BASE_LEVEL_CARDS[0];

    this.setData(nextData);
  },

  initVipCardHeight() {
    try {
      const systemInfo = wx.getSystemInfoSync();

      const rpx = systemInfo.windowWidth / 750;
      const pagePaddingPx = rpx * 48; // 24rpx*2
      const swiperSideMarginPx = rpx * (56 + 56); // previous-margin + next-margin
      const contentWidth = systemInfo.windowWidth - pagePaddingPx;
      const cardWidth = contentWidth - swiperSideMarginPx;

      this.setData({ vipCardHeight: cardWidth / 2 });
    } catch (_) {
      this.setData({ vipCardHeight: 140 });
    }
  },

  onSwiperChange(e) {
    const currentIndex = Number(e?.detail?.current || 0);
    this._hasUserSwiped = true;
    this.setData({
      currentIndex,
      currentCard: this.data.levelCards[currentIndex] || BASE_LEVEL_CARDS[0],
    });
  },

  onTapCard(e) {
    const idx = Number(e?.currentTarget?.dataset?.index || 0);
    const card = this.data.levelCards[idx] || BASE_LEVEL_CARDS[0];

    if (card.level > this.data.memberLevel) {
      this.onTapRecharge();
      return;
    }

    if (card.level > 0) {
      wx.showToast({ title: card.level === this.data.memberLevel ? `${card.title}（当前）` : `${card.title} 已解锁`, icon: 'none' });
    }
  },

  onTapRecharge() {
    wx.navigateTo({ url: '/pages/mine/recharge/recharge' });
  },
});
