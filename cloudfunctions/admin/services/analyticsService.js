const cloud = require('wx-server-sdk');
const { COL_ORDERS, COL_CUSTOMERS, COL_PRODUCTS } = require('../config/constants');
const { now, toNum } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
const SUPPORTED_RANGE_DAYS = new Set([0, 7, 30, 90]);
const PAGE_SIZE = 100;
const MAX_SCAN_DOCS = 10000;

function normalizeRangeDays(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_RANGE_DAYS;
  const days = Math.max(0, Math.floor(num));
  return SUPPORTED_RANGE_DAYS.has(days) ? days : DEFAULT_RANGE_DAYS;
}

function hasOwnKeys(obj) {
  return !!(obj && typeof obj === 'object' && Object.keys(obj).length > 0);
}

function round2(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dayKey(ts) {
  const d = new Date(Number(ts || 0));
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function normalizeMemberLevel(level) {
  const lv = Math.floor(Number(level || 0));
  if (!Number.isFinite(lv)) return 0;
  return Math.max(0, Math.min(4, lv));
}

function memberLevelLabel(level) {
  if (level <= 0) return '普通用户';
  if (level >= 4) return 'Lv4 尊享会员';
  return `Lv${level} 会员`;
}

function emptyModeStats(mode, label) {
  return {
    mode,
    label,
    count: 0,
    paidCount: 0,
    amount: 0,
  };
}

function modeLabel(mode) {
  if (mode === 'ziti') return '到店/自提';
  if (mode === 'waimai') return '外卖配送';
  if (mode === 'kuaidi') return '快递配送';
  return '其他';
}

async function scanCollection(collectionName, { where, field, maxDocs = MAX_SCAN_DOCS } = {}) {
  const list = [];
  let skip = 0;
  let truncated = false;

  while (skip < maxDocs) {
    let query = db.collection(collectionName);
    if (hasOwnKeys(where)) query = query.where(where);
    if (hasOwnKeys(field)) query = query.field(field);

    const limit = Math.min(PAGE_SIZE, maxDocs - skip);
    const res = await query.skip(skip).limit(limit).get();
    const batch = Array.isArray(res?.data) ? res.data : [];

    if (!batch.length) break;

    list.push(...batch);
    skip += batch.length;

    if (batch.length < limit) break;
  }

  if (skip >= maxDocs) truncated = true;

  return { list, truncated };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeOrderMode(rawMode) {
  const mode = String(rawMode || '').trim();
  if (mode === 'ziti' || mode === 'waimai' || mode === 'kuaidi') return mode;
  return 'other';
}

async function getOverview(rangeDaysInput) {
  const rangeDays = normalizeRangeDays(rangeDaysInput);
  const endAt = now();
  const startAt = rangeDays > 0 ? (endAt - rangeDays * DAY_MS) : 0;

  const newCustomerWindowDays = rangeDays > 0 ? rangeDays : 30;
  const newCustomerStartAt = endAt - newCustomerWindowDays * DAY_MS;

  const orderWhere = rangeDays > 0
    ? { createdAt: _.gte(startAt) }
    : {};

  const [ordersResult, usersResult, productsResult] = await Promise.all([
    scanCollection(COL_ORDERS, {
      where: orderWhere,
      field: {
        _id: true,
        _openid: true,
        openid: true,
        createdAt: true,
        status: true,
        mode: true,
        amount: true,
        payment: true,
        refund: true,
        items: true,
      },
    }),
    scanCollection(COL_CUSTOMERS, {
      field: {
        _id: true,
        createdAt: true,
        memberLevel: true,
      },
    }),
    scanCollection(COL_PRODUCTS, {
      field: {
        _id: true,
        name: true,
        status: true,
      },
    })
  ]);

  const orders = ordersResult.list;
  const users = usersResult.list;
  const products = productsResult.list;

  const modeStatsMap = new Map([
    ['ziti', emptyModeStats('ziti', modeLabel('ziti'))],
    ['waimai', emptyModeStats('waimai', modeLabel('waimai'))],
    ['kuaidi', emptyModeStats('kuaidi', modeLabel('kuaidi'))],
    ['other', emptyModeStats('other', modeLabel('other'))],
  ]);

  const dailyMap = new Map();
  const productSalesMap = new Map();
  const paidCustomerOrderCount = new Map();

  const orderSummary = {
    totalOrders: 0,
    paidOrders: 0,
    doneOrders: 0,
    pendingPaymentOrders: 0,
    refundOrders: 0,
    refundedSuccessOrders: 0,
    grossRevenue: 0,
    refundedAmount: 0,
  };

  for (const order of orders) {
    orderSummary.totalOrders += 1;

    const mode = normalizeOrderMode(order?.mode);
    const modeStats = modeStatsMap.get(mode) || modeStatsMap.get('other');
    modeStats.count += 1;

    const status = String(order?.status || '').trim();
    if (status === 'done') orderSummary.doneOrders += 1;
    if (status === 'pending_payment') orderSummary.pendingPaymentOrders += 1;

    const hasRefund = !!order?.refund;
    if (hasRefund) orderSummary.refundOrders += 1;

    const refundStatus = String(order?.refund?.status || '').toLowerCase();
    const refundSuccess = refundStatus === 'success' || refundStatus === 'refunded';
    if (refundSuccess) {
      orderSummary.refundedSuccessOrders += 1;
    }

    const totalAmount = toNum(order?.amount?.total, 0);
    const isPaid = String(order?.payment?.status || '').toLowerCase() === 'paid';

    const key = dayKey(order?.createdAt || 0);
    if (key) {
      const dayData = dailyMap.get(key) || { date: key, orderCount: 0, paidCount: 0, amount: 0 };
      dayData.orderCount += 1;
      if (isPaid) {
        dayData.paidCount += 1;
        dayData.amount += totalAmount;
      }
      dailyMap.set(key, dayData);
    }

    if (!isPaid) continue;

    orderSummary.paidOrders += 1;
    orderSummary.grossRevenue += totalAmount;
    modeStats.paidCount += 1;
    modeStats.amount += totalAmount;

    const orderOpenid = String(order?._openid || order?.openid || '').trim();
    if (orderOpenid) {
      const oldCount = paidCustomerOrderCount.get(orderOpenid) || 0;
      paidCustomerOrderCount.set(orderOpenid, oldCount + 1);
    }

    if (refundSuccess) {
      orderSummary.refundedAmount += totalAmount;
    }

    const seenInThisOrder = new Set();
    for (const item of toArray(order?.items)) {
      const quantity = Math.max(0, Number(item?.count || 0));
      if (!quantity) continue;

      const productId = String(item?.productId || '').trim();
      const keyId = productId || `name:${String(item?.productName || '').trim()}`;
      const productName = String(item?.productName || '').trim() || '未知商品';
      const itemAmount = quantity * toNum(item?.price, 0);

      const existing = productSalesMap.get(keyId) || {
        key: keyId,
        productId,
        name: productName,
        quantity: 0,
        amount: 0,
        orderCount: 0,
      };

      existing.quantity += quantity;
      existing.amount += itemAmount;

      if (!seenInThisOrder.has(keyId)) {
        existing.orderCount += 1;
        seenInThisOrder.add(keyId);
      }

      productSalesMap.set(keyId, existing);
    }
  }

  const productNameMap = new Map();
  let onShelfProducts = 0;
  for (const product of products) {
    const id = String(product?._id || '').trim();
    const name = String(product?.name || '').trim();
    if (id) productNameMap.set(id, name);
    if (Number(product?.status || 0) === 1) onShelfProducts += 1;
  }

  const soldProducts = Array.from(productSalesMap.values()).map((item) => {
    const fallbackName = item.productId ? productNameMap.get(item.productId) : '';
    return {
      productId: item.productId,
      name: item.name || fallbackName || '未知商品',
      quantity: Number(item.quantity || 0),
      amount: round2(item.amount),
      orderCount: Number(item.orderCount || 0),
    };
  });

  soldProducts.sort((a, b) => {
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    if (b.amount !== a.amount) return b.amount - a.amount;
    return b.orderCount - a.orderCount;
  });

  const totalSoldQuantity = soldProducts.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalSoldAmount = soldProducts.reduce((sum, item) => sum + toNum(item.amount, 0), 0);

  const memberLevelCounter = [0, 0, 0, 0, 0];
  let newCustomers = 0;
  let vipCustomers = 0;

  for (const user of users) {
    const lv = normalizeMemberLevel(user?.memberLevel);
    memberLevelCounter[lv] += 1;
    if (lv >= 4) vipCustomers += 1;

    const createdAt = Number(user?.createdAt || 0);
    if (createdAt > 0 && createdAt >= newCustomerStartAt) {
      newCustomers += 1;
    }
  }

  const orderingCustomers = paidCustomerOrderCount.size;
  let repeatCustomers = 0;
  for (const count of paidCustomerOrderCount.values()) {
    if (count >= 2) repeatCustomers += 1;
  }

  const trendWindowDays = rangeDays > 0 ? rangeDays : 30;
  const trend = [];
  for (let i = trendWindowDays - 1; i >= 0; i -= 1) {
    const ts = endAt - i * DAY_MS;
    const key = dayKey(ts);
    const dayData = dailyMap.get(key) || { date: key, orderCount: 0, paidCount: 0, amount: 0 };

    trend.push({
      date: key,
      orderCount: Number(dayData.orderCount || 0),
      paidCount: Number(dayData.paidCount || 0),
      amount: round2(dayData.amount),
    });
  }

  const totalOrders = orderSummary.totalOrders;
  const modeStats = ['ziti', 'waimai', 'kuaidi', 'other'].map((key) => {
    const mode = modeStatsMap.get(key) || emptyModeStats(key, modeLabel(key));
    return {
      mode: mode.mode,
      label: mode.label,
      count: mode.count,
      paidCount: mode.paidCount,
      amount: round2(mode.amount),
      shareRatio: totalOrders > 0 ? mode.count / totalOrders : 0,
    };
  }).filter((item) => item.mode !== 'other' || item.count > 0);

  const memberStats = memberLevelCounter.map((count, level) => ({
    level,
    label: memberLevelLabel(level),
    count,
  }));

  const grossRevenue = round2(orderSummary.grossRevenue);
  const refundedAmount = round2(orderSummary.refundedAmount);
  const netRevenue = round2(grossRevenue - refundedAmount);

  return {
    ok: true,
    data: {
      rangeDays,
      startAt,
      endAt,
      order: {
        totalOrders,
        paidOrders: orderSummary.paidOrders,
        doneOrders: orderSummary.doneOrders,
        pendingPaymentOrders: orderSummary.pendingPaymentOrders,
        refundOrders: orderSummary.refundOrders,
        refundedSuccessOrders: orderSummary.refundedSuccessOrders,
        grossRevenue,
        refundedAmount,
        netRevenue,
        avgOrderValue: orderSummary.paidOrders > 0
          ? round2(grossRevenue / orderSummary.paidOrders)
          : 0,
        modeStats,
        trend,
        trendWindowDays,
      },
      customer: {
        totalCustomers: users.length,
        newCustomers,
        newCustomerWindowDays,
        orderingCustomers,
        repeatCustomers,
        vipCustomers,
        memberStats,
      },
      product: {
        totalProducts: products.length,
        onShelfProducts,
        activeProducts: soldProducts.length,
        totalSoldQuantity,
        totalSoldAmount: round2(totalSoldAmount),
        topProducts: soldProducts.slice(0, 10),
      },
      meta: {
        generatedAt: endAt,
        orderSampleSize: orders.length,
        userSampleSize: users.length,
        productSampleSize: products.length,
        maxScanDocs: MAX_SCAN_DOCS,
        truncatedOrders: ordersResult.truncated,
        truncatedUsers: usersResult.truncated,
        truncatedProducts: productsResult.truncated,
      }
    }
  };
}

module.exports = {
  getOverview,
};
