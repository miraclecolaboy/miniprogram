// pages/mine/member/member.js
const { ensureLogin, refreshUserToStorage } = require('../../../utils/auth');
const { callUser } = require('../../../utils/cloud');

const {
  MEMBER_LEVEL: KEY_MEMBER_LEVEL,
  TOTAL_RECHARGE: KEY_TOTAL_RECHARGE,
} = require('../../../utils/storageKeys');

// 等级阈值配置
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
    totalRecharge: 0,
    progressStyle: 'width: 0%;', // 预设样式避免渲染闪烁
    nextLevelText: '',
  },

  onLoad() {
    // 优先加载本地缓存，提升首屏速度
    const memberLevel = Number(wx.getStorageSync(KEY_MEMBER_LEVEL) || 0);
    const totalRecharge = Number(wx.getStorageSync(KEY_TOTAL_RECHARGE) || 0);
    this.setMemberState(memberLevel, totalRecharge);
  },

  async onShow() {
    try {
      const u = await ensureLogin();
      if (!u) return;

      // 获取最新用户信息
      const res = await callUser('getMe', {});
      const me = res?.result?.data;
      if (!me) return;

      // 更新本地缓存
      refreshUserToStorage(me).catch(() => {});

      const memberLevel = Number(me.memberLevel || 0);
      const totalRecharge = Number(me.totalRecharge || 0);
      this.setMemberState(memberLevel, totalRecharge);
    } catch (e) {
      console.error('[member] onShow error', e);
    }
  },

  /**
   * 核心状态计算函数
   * 集中处理进度条、文案和等级逻辑
   */
  setMemberState(memberLevel, totalRecharge) {
    const lv = Number(memberLevel || 0);
    const total = Number(totalRecharge || 0);
    
    let progress = 0;
    let nextLevelText = '尊享会员 顶级权益生效中';

    // 查找下一个未达到的等级目标
    const nextTarget = LEVELS.find(l => l.threshold > total);

    if (nextTarget) {
      // 计算升级进度 (0-100)
      if (nextTarget.threshold > 0) {
        progress = (total / nextTarget.threshold) * 100;
      }
      progress = Math.min(Math.max(progress, 0), 100);
      
      const diff = nextTarget.threshold - total;
      nextLevelText = `再充值 ${fmtYuan(diff)}元 升级至 Lv.${nextTarget.level} 尊享会员`;
    } else {
      // 已达最高等级
      progress = 100;
      nextLevelText = '尊享会员 顶级权益生效中';
    }

    // 直接生成样式字符串，防止 WXML 解析 {{progress}}% 报错
    const progressStyle = `width: ${progress.toFixed(1)}%;`;

    this.setData({
      memberLevel: lv,
      totalRecharge: total,
      progressStyle,
      nextLevelText
    });
  },

  onTapRecharge() {
    wx.navigateTo({ url: '/pages/mine/recharge/recharge' });
  },
});