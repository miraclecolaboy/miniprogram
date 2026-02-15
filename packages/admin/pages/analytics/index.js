const { requireLogin } = require('../../utils/auth');
const { call } = require('../../utils/cloud');

const TAB_OPTIONS = [
  { key: 'recharge', label: '充值用户' },
  { key: 'order', label: '订单数据' },
];

const ORDER_TIME_OPTIONS = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'last7', label: '近7天' },
  { key: 'last30', label: '近30天' },
  { key: 'custom', label: '自选时间' },
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(ts) {
  const d = new Date(Number(ts || 0));
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateTime(ts) {
  const d = new Date(Number(ts || 0));
  if (!Number.isFinite(d.getTime())) return '';
  return `${formatDate(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatNumber(value, digits = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return digits > 0 ? `0.${'0'.repeat(digits)}` : '0';
  return n.toFixed(digits);
}

function todayText() {
  return formatDate(Date.now());
}

Page({
  data: {
    tabOptions: TAB_OPTIONS,
    activeTab: 'recharge',

    orderTimeOptions: ORDER_TIME_OPTIONS,
    orderTimeType: 'today',
    customStartDate: '',
    customEndDate: '',
    orderDateText: '',

    loading: false,
    errorText: '',
    hasData: false,

    orderCards: [],
    customerCards: [],
    rechargeUsers: [],
    rechargeSummaryText: '',
    rechargeSearchKeyword: '',
    tips: [],

    balancePopupVisible: false,
    balancePopupLoading: false,
    balancePopupTitle: '',
    balancePopupMeta: '',
    balanceLogs: [],
  },

  onLoad() {
    const today = todayText();
    this.setData({
      customStartDate: today,
      customEndDate: today,
    });
    this._allRechargeUsers = [];
  },

  async onShow() {
    if (requireLogin()) {
      await this.reload();
    }
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  onTabTap(e) {
    const key = String(e.currentTarget.dataset.key || '');
    if (!key || key === this.data.activeTab) return;
    this.setData({ activeTab: key });
  },

  onOrderTimeTap(e) {
    const key = String(e.currentTarget.dataset.key || '');
    const valid = this.data.orderTimeOptions.some((item) => item.key === key);
    if (!valid) return;
    if (key === this.data.orderTimeType || this.data.loading) return;

    this.setData({ orderTimeType: key }, () => {
      if (key !== 'custom') {
        this.reload();
      }
    });
  },

  onCustomStartChange(e) {
    const value = String(e.detail.value || '');
    if (!value) return;
    this.setData({ customStartDate: value });
  },

  onCustomEndChange(e) {
    const value = String(e.detail.value || '');
    if (!value) return;
    this.setData({ customEndDate: value });
  },

  onApplyCustomRange() {
    if (this.data.loading) return;

    let start = String(this.data.customStartDate || '').trim();
    let end = String(this.data.customEndDate || '').trim();
    if (!start || !end) {
      wx.showToast({ title: '请选择开始和结束日期', icon: 'none' });
      return;
    }

    if (start > end) {
      const temp = start;
      start = end;
      end = temp;
    }

    this.setData({
      orderTimeType: 'custom',
      customStartDate: start,
      customEndDate: end,
    }, () => {
      this.reload();
    });
  },

  onReloadTap() {
    if (this.data.loading) return;
    this.reload();
  },

  onRechargeSearchInput(e) {
    const value = String(e.detail.value || '');
    this.setData({ rechargeSearchKeyword: value }, () => {
      this._applyRechargeFilter();
    });
  },

  async reload() {
    const session = requireLogin();
    if (!session) return;

    this.setData({ loading: true, errorText: '' });

    try {
      const res = await call('admin', {
        action: 'analytics_overview',
        token: session.token,
        orderTimeType: this.data.orderTimeType,
        customStartDate: this.data.customStartDate,
        customEndDate: this.data.customEndDate,
      });

      if (!res || !res.ok || !res.data) {
        throw new Error((res && res.message) || '统计数据加载失败');
      }

      this._applyData(res.data);
    } catch (e) {
      console.error('[analytics] reload failed', e);
      this.setData({
        errorText: (e && e.message) || '统计数据加载失败',
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  _applyData(data) {
    const order = data.order || {};
    const customer = data.customer || {};
    const recharge = data.recharge || {};
    const meta = data.meta || {};

    const orderCards = [
      { label: '支付订单', value: formatNumber(order.paidOrders, 0) },
      { label: '净成交额', value: `¥${formatNumber(order.netRevenue, 2)}` },
      { label: '客单价', value: `¥${formatNumber(order.avgOrderValue, 2)}` },
      { label: '退款额', value: `¥${formatNumber(order.refundedAmount, 2)}` },
    ];

    const memberLevelCounts = customer.memberLevelCounts || {};
    const lv1Count = Number(memberLevelCounts.lv1 || 0);
    const lv2Count = Number(memberLevelCounts.lv2 || 0);
    const lv3Count = Number(memberLevelCounts.lv3 || 0);
    const lv4Count = Number(memberLevelCounts.lv4 || 0);
    const customerCards = [
      { label: '顾客总数', value: formatNumber(customer.totalCustomers, 0) },
      { label: '下单顾客', value: formatNumber(customer.orderingCustomers, 0) },
      { label: 'Lv1会员', value: formatNumber(lv1Count, 0) },
      { label: 'Lv2会员', value: formatNumber(lv2Count, 0) },
      { label: 'Lv3会员', value: formatNumber(lv3Count, 0) },
      { label: 'Lv4会员', value: formatNumber(lv4Count, 0) },
    ];

    const tips = [];
    if (meta.truncatedRangeOrders) {
      tips.push(`订单样本超过 ${meta.maxScanDocs || 10000} 条，订单数据按可扫描样本计算。`);
    }
    if (meta.truncatedAllOrders) {
      tips.push(`历史订单超过 ${meta.maxScanDocs || 10000} 条，下单顾客按可扫描样本计算。`);
    }
    if (meta.truncatedUsers) {
      tips.push(`顾客量超过 ${meta.maxScanDocs || 10000} 条，店铺数据按可扫描样本计算。`);
    }
    if (meta.truncatedRecharges) {
      tips.push(`充值记录超过 ${meta.maxScanDocs || 10000} 条，充值用户统计按可扫描样本计算。`);
    }

    this._allRechargeUsers = this._formatRechargeUsers(recharge.users);

    this.setData({
      hasData: true,
      orderTimeType: String(order.timeType || this.data.orderTimeType),
      orderDateText: order.startDate && order.endDate ? `${order.startDate} ~ ${order.endDate}` : '',
      orderCards,
      customerCards,
      rechargeSummaryText: `共 ${formatNumber(recharge.totalRechargeUsers, 0)} 人，累计充值 ¥${formatNumber(recharge.totalRechargeAmount, 2)}`,
      tips,
    }, () => {
      this._applyRechargeFilter();
    });
  },

  _formatRechargeUsers(list) {
    const arr = Array.isArray(list) ? list : [];
    return arr.map((item) => ({
      memberLevel: Math.max(0, Number(item?.memberLevel || 0)),
      openid: String(item?.openid || ''),
      userName: String(item?.userName || '未知用户'),
      phone: String(item?.phone || '-'),
      totalRechargeText: `¥${formatNumber(item?.totalRecharge, 2)}`,
      balanceText: `¥${formatNumber(item?.balance, 2)}`,
      memberLevelText: `lv.${Math.max(0, Number(item?.memberLevel || 0))}会员`,
    }));
  },

  _applyRechargeFilter() {
    const keyword = String(this.data.rechargeSearchKeyword || '').trim().toLowerCase();
    const list = Array.isArray(this._allRechargeUsers) ? this._allRechargeUsers : [];
    if (!keyword) {
      this.setData({ rechargeUsers: list });
      return;
    }

    const filtered = list.filter((item) => {
      const name = String(item?.userName || '').toLowerCase();
      const phone = String(item?.phone || '').toLowerCase();
      return name.includes(keyword) || phone.includes(keyword);
    });

    this.setData({ rechargeUsers: filtered });
  },

  async onBalanceQueryTap(e) {
    const openid = String(e.currentTarget.dataset.openid || '');
    const name = String(e.currentTarget.dataset.name || '顾客');
    if (!openid) return;

    const session = requireLogin();
    if (!session) return;

    this.setData({
      balancePopupVisible: true,
      balancePopupLoading: true,
      balancePopupTitle: `${name} · 余额流水`,
      balancePopupMeta: '',
      balanceLogs: [],
    });

    try {
      const res = await call('admin', {
        action: 'analytics_balance_logs',
        token: session.token,
        openid,
        limit: 100,
      });

      if (!res || !res.ok || !res.data) {
        throw new Error((res && res.message) || '余额流水加载失败');
      }

      const data = res.data;
      const user = data.user || {};
      const logs = Array.isArray(data.logs) ? data.logs : [];
      const memberLevel = Math.max(0, Number(user.memberLevel || 0));

      this.setData({
        balancePopupMeta: `lv.${memberLevel}会员 · 当前余额 ¥${formatNumber(user.balance, 2)}`,
        balanceLogs: logs.map((item) => {
          const delta = Number(item?.delta || 0);
          const absText = formatNumber(Math.abs(delta), 2);
          return {
            id: String(item?.id || ''),
            scene: String(item?.scene || '-'),
            remark: String(item?.remark || ''),
            timeText: formatDateTime(item?.createdAt),
            deltaText: delta >= 0 ? `+¥${absText}` : `-¥${absText}`,
            deltaClass: delta >= 0 ? 'plus' : 'minus',
          };
        }),
      });
    } catch (err) {
      console.error('[analytics] load balance logs failed', err);
      wx.showToast({
        title: (err && err.message) || '余额流水加载失败',
        icon: 'none',
      });
      this.setData({ balancePopupVisible: false });
    } finally {
      this.setData({ balancePopupLoading: false });
    }
  },

  onBalancePopupClose() {
    this.setData({
      balancePopupVisible: false,
      balancePopupLoading: false,
      balancePopupTitle: '',
      balancePopupMeta: '',
      balanceLogs: [],
    });
  },

  onPopupTouchMove() {},

  onPopupInnerTap() {},
});
