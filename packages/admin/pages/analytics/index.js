const { requireLogin } = require('../../utils/auth');
const { call } = require('../../utils/cloud');

const RANGE_OPTIONS = [
  { label: '近7天', value: 7 },
  { label: '近30天', value: 30 },
  { label: '近90天', value: 90 },
  { label: '全部', value: 0 },
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateTime(ts) {
  const d = new Date(Number(ts || 0));
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatNumber(value, digits = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return digits > 0 ? `0.${'0'.repeat(digits)}` : '0';
  return n.toFixed(digits);
}

function toPercent(ratio) {
  const n = Number(ratio || 0);
  if (!Number.isFinite(n) || n <= 0) return '0%';
  return `${(n * 100).toFixed(1)}%`;
}

Page({
  data: {
    rangeOptions: RANGE_OPTIONS,
    rangeDays: 30,
    loading: false,
    errorText: '',
    hasData: false,
    generatedAtText: '',
    orderCards: [],
    customerCards: [],
    productCards: [],
    modeStats: [],
    memberStats: [],
    topProducts: [],
    trend: [],
    tips: [],
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

  onRangeTap(e) {
    const value = Number(e.currentTarget.dataset.value);
    if (Number.isNaN(value)) return;
    if (value === this.data.rangeDays || this.data.loading) return;

    this.setData({ rangeDays: value }, () => {
      this.reload();
    });
  },

  onReloadTap() {
    if (this.data.loading) return;
    this.reload();
  },

  async reload() {
    const session = requireLogin();
    if (!session) return;

    this.setData({ loading: true, errorText: '' });

    try {
      const res = await call('admin', {
        action: 'analytics_overview',
        token: session.token,
        rangeDays: this.data.rangeDays,
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
    const product = data.product || {};
    const meta = data.meta || {};

    const vipRatio = Number(customer.totalCustomers || 0) > 0
      ? Number(customer.vipCustomers || 0) / Number(customer.totalCustomers || 1)
      : 0;

    const orderCards = [
      { label: '订单总数', value: formatNumber(order.totalOrders, 0) },
      { label: '支付订单', value: formatNumber(order.paidOrders, 0) },
      { label: '客单价', value: `¥${formatNumber(order.avgOrderValue, 2)}` },
      { label: '成交额', value: `¥${formatNumber(order.grossRevenue, 2)}` },
      { label: '退款额', value: `¥${formatNumber(order.refundedAmount, 2)}` },
      { label: '净成交额', value: `¥${formatNumber(order.netRevenue, 2)}` },
    ];

    const customerCards = [
      { label: '顾客总数', value: formatNumber(customer.totalCustomers, 0) },
      { label: '本期下单顾客', value: formatNumber(customer.orderingCustomers, 0) },
      { label: '复购顾客', value: formatNumber(customer.repeatCustomers, 0) },
      { label: `新增顾客(${customer.newCustomerWindowDays || 30}天)`, value: formatNumber(customer.newCustomers, 0) },
      { label: 'Lv4会员数', value: formatNumber(customer.vipCustomers, 0) },
      { label: '会员占比', value: toPercent(vipRatio) },
    ];

    const productCards = [
      { label: '商品总数', value: formatNumber(product.totalProducts, 0) },
      { label: '上架商品', value: formatNumber(product.onShelfProducts, 0) },
      { label: '动销商品', value: formatNumber(product.activeProducts, 0) },
      { label: '售出件数', value: formatNumber(product.totalSoldQuantity, 0) },
      { label: '商品销售额', value: `¥${formatNumber(product.totalSoldAmount, 2)}` },
      { label: '售后订单数', value: formatNumber(order.refundOrders, 0) },
    ];

    const tips = [];
    if (meta.truncatedOrders) tips.push(`订单量超过 ${meta.maxScanDocs || 10000} 条，统计按可扫描样本计算。`);
    if (meta.truncatedUsers) tips.push(`顾客量超过 ${meta.maxScanDocs || 10000} 条，会员统计按可扫描样本计算。`);
    if (meta.truncatedProducts) tips.push(`商品量超过 ${meta.maxScanDocs || 10000} 条，商品统计按可扫描样本计算。`);

    this.setData({
      hasData: true,
      generatedAtText: formatDateTime(meta.generatedAt),
      orderCards,
      customerCards,
      productCards,
      modeStats: this._formatModeStats(order.modeStats, order.totalOrders),
      memberStats: this._formatMemberStats(customer.memberStats, customer.totalCustomers),
      topProducts: this._formatTopProducts(product.topProducts),
      trend: this._formatTrend(order.trend),
      tips,
    });
  },

  _formatModeStats(list, totalOrders) {
    const arr = Array.isArray(list) ? list : [];
    const total = Number(totalOrders || 0);

    return arr.map((item) => {
      const count = Number(item && item.count || 0);
      const paidCount = Number(item && item.paidCount || 0);
      const shareRatio = item && typeof item.shareRatio === 'number'
        ? item.shareRatio
        : (total > 0 ? count / total : 0);

      return {
        label: (item && item.label) || '-',
        count,
        paidCount,
        amountText: `¥${formatNumber(item && item.amount, 2)}`,
        shareText: toPercent(shareRatio),
      };
    });
  },

  _formatMemberStats(list, totalCustomers) {
    const arr = Array.isArray(list) ? list : [];
    const total = Number(totalCustomers || 0);

    const maxCount = arr.reduce((max, item) => Math.max(max, Number(item && item.count || 0)), 0);

    return arr.map((item) => {
      const count = Number(item && item.count || 0);
      const rawWidth = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
      return {
        label: (item && item.label) || '-',
        count,
        ratioText: toPercent(total > 0 ? count / total : 0),
        widthPct: count > 0 ? Math.max(rawWidth, 8) : 0,
      };
    });
  },

  _formatTopProducts(list) {
    const arr = Array.isArray(list) ? list : [];

    return arr.map((item, index) => ({
      rank: index + 1,
      name: (item && item.name) || '未知商品',
      quantityText: formatNumber(item && item.quantity, 0),
      amountText: `¥${formatNumber(item && item.amount, 2)}`,
      orderCount: formatNumber(item && item.orderCount, 0),
    }));
  },

  _formatTrend(list) {
    const arr = Array.isArray(list) ? list : [];
    return arr.map((item) => ({
      date: (item && item.date) || '-',
      orderCount: formatNumber(item && item.orderCount, 0),
      paidCount: formatNumber(item && item.paidCount, 0),
      amountText: `¥${formatNumber(item && item.amount, 2)}`,
    }));
  }
});
