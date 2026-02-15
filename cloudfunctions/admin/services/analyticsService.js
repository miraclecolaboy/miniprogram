const cloud = require('wx-server-sdk');
const { COL_ORDERS, COL_CUSTOMERS, COL_RECHARGES } = require('../config/constants');
const { now, toNum } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_SCAN_DOCS = 10000;
const DEFAULT_ORDER_TIME_TYPE = 'today';
const ORDER_TIME_TYPES = new Set(['today', 'yesterday', 'last7', 'last30', 'custom']);
const DEFAULT_BALANCE_LOG_LIMIT = 100;
const MAX_BALANCE_LOG_LIMIT = 200;

function hasOwnKeys(obj) {
  return !!(obj && typeof obj === 'object' && Object.keys(obj).length > 0);
}

function safeStr(value) {
  return String(value == null ? '' : value).trim();
}

function round2(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dayStart(ts) {
  const d = new Date(Number(ts || 0));
  if (!Number.isFinite(d.getTime())) return 0;
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dateText(ts) {
  const d = new Date(Number(ts || 0));
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateText(input) {
  const text = safeStr(input);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return 0;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const d = new Date(year, month - 1, date);
  if (!Number.isFinite(d.getTime())) return 0;

  if (
    d.getFullYear() !== year ||
    (d.getMonth() + 1) !== month ||
    d.getDate() !== date
  ) {
    return 0;
  }

  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function normalizeMemberLevel(level) {
  const lv = Math.floor(Number(level || 0));
  if (!Number.isFinite(lv)) return 0;
  return Math.max(0, Math.min(4, lv));
}

function memberLevelLabel(level) {
  if (level <= 0) return '普通会员';
  return `Lv${level}会员`;
}

function isPaidOrder(order) {
  return safeStr(order?.payment?.status).toLowerCase() === 'paid';
}

function isRefundSuccess(order) {
  const status = safeStr(order?.refund?.status).toLowerCase();
  return status === 'success' || status === 'refunded';
}

function isBalanceOrder(order) {
  return safeStr(order?.payment?.method).toLowerCase() === 'balance';
}

function resolveOrderTimeWindow(input = {}) {
  const nowTs = now();
  const todayStart = dayStart(nowTs);
  const tomorrowStart = todayStart + DAY_MS;
  const yesterdayStart = todayStart - DAY_MS;
  const last7Start = todayStart - 6 * DAY_MS;
  const last30Start = todayStart - 29 * DAY_MS;

  const requestedType = safeStr(
    input.orderTimeType || input.timeType || input.rangeType
  ).toLowerCase();
  const type = ORDER_TIME_TYPES.has(requestedType)
    ? requestedType
    : DEFAULT_ORDER_TIME_TYPE;

  let startAt = todayStart;
  let endAt = tomorrowStart;
  let label = '今天';

  if (type === 'yesterday') {
    startAt = yesterdayStart;
    endAt = todayStart;
    label = '昨天';
  } else if (type === 'last7') {
    startAt = last7Start;
    endAt = tomorrowStart;
    label = '近7天';
  } else if (type === 'last30') {
    startAt = last30Start;
    endAt = tomorrowStart;
    label = '近30天';
  } else if (type === 'custom') {
    const customStart = parseDateText(input.customStartDate || input.startDate);
    const customEnd = parseDateText(input.customEndDate || input.endDate);

    if (customStart > 0 && customEnd > 0) {
      const from = Math.min(customStart, customEnd);
      const to = Math.max(customStart, customEnd);
      startAt = from;
      endAt = to + DAY_MS;
      label = '自选时间';
    } else {
      startAt = todayStart;
      endAt = tomorrowStart;
      label = '今天';
    }
  }

  const startDate = dateText(startAt);
  const endDate = dateText(Math.max(startAt, endAt - DAY_MS));

  return {
    type,
    label,
    startAt,
    endAt,
    startDate,
    endDate,
  };
}

function pickUserName(user) {
  const candidates = [
    user?.nickName,
    user?.nickname,
    user?.name,
    user?.userName,
    user?.username,
  ];
  for (const value of candidates) {
    const text = safeStr(value);
    if (text) return text;
  }
  return '未知用户';
}

function pickUserPhone(user) {
  const direct = [
    user?.phone,
    user?.mobile,
    user?.tel,
    user?.reservePhone,
  ];
  for (const value of direct) {
    const text = safeStr(value);
    if (text) return text;
  }

  const addresses = Array.isArray(user?.addresses) ? user.addresses : [];
  for (const addr of addresses) {
    const phone = safeStr(addr?.phone);
    if (phone) return phone;
  }

  return '';
}

function normalizeBalanceLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_BALANCE_LOG_LIMIT;
  return Math.max(1, Math.min(MAX_BALANCE_LOG_LIMIT, Math.floor(n)));
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

async function getOverview(input = {}) {
  const orderWindow = resolveOrderTimeWindow(input);

  const [rangeOrdersResult, allOrdersResult, usersResult, rechargesResult] = await Promise.all([
    scanCollection(COL_ORDERS, {
      where: { createdAt: _.gte(orderWindow.startAt) },
      field: {
        _id: true,
        createdAt: true,
        amount: true,
        payment: true,
        refund: true,
      },
    }),
    scanCollection(COL_ORDERS, {
      field: {
        _id: true,
        openid: true,
        payment: true,
      },
    }),
    scanCollection(COL_CUSTOMERS, {
      field: {
        _id: true,
        openid: true,
        nickName: true,
        nickname: true,
        name: true,
        userName: true,
        username: true,
        phone: true,
        mobile: true,
        tel: true,
        reservePhone: true,
        addresses: true,
        balance: true,
        totalRecharge: true,
        totalRechargeAmount: true,
        memberLevel: true,
      },
    }),
    scanCollection(COL_RECHARGES, {
      field: {
        _id: true,
        openid: true,
        status: true,
        amount: true,
      },
    }),
  ]);

  let paidOrders = 0;
  let grossRevenue = 0;
  let refundedAmount = 0;

  for (const order of rangeOrdersResult.list) {
    const createdAt = Number(order?.createdAt || 0);
    if (!Number.isFinite(createdAt)) continue;
    if (createdAt < orderWindow.startAt || createdAt >= orderWindow.endAt) continue;
    if (!isPaidOrder(order)) continue;

    paidOrders += 1;
    grossRevenue += toNum(order?.amount?.total, 0);
    if (isRefundSuccess(order)) {
      refundedAmount += toNum(order?.amount?.total, 0);
    }
  }

  const netRevenue = round2(grossRevenue - refundedAmount);
  const avgOrderValue = paidOrders > 0 ? round2(netRevenue / paidOrders) : 0;

  const memberLevelCounts = {
    lv1: 0,
    lv2: 0,
    lv3: 0,
    lv4: 0,
  };
  for (const user of usersResult.list) {
    const level = normalizeMemberLevel(user?.memberLevel);
    if (level === 1) memberLevelCounts.lv1 += 1;
    if (level === 2) memberLevelCounts.lv2 += 1;
    if (level === 3) memberLevelCounts.lv3 += 1;
    if (level === 4) memberLevelCounts.lv4 += 1;
  }

  const paidOrderUserSet = new Set();
  for (const order of allOrdersResult.list) {
    if (!isPaidOrder(order)) continue;
    const openid = safeStr(order?.openid);
    if (!openid) continue;
    paidOrderUserSet.add(openid);
  }

  const paidRechargeByOpenid = new Map();
  for (const recharge of rechargesResult.list) {
    if (safeStr(recharge?.status).toLowerCase() !== 'paid') continue;
    const openid = safeStr(recharge?.openid);
    if (!openid) continue;
    const amount = Math.max(0, toNum(recharge?.amount, 0));
    if (amount <= 0) continue;
    const oldAmount = paidRechargeByOpenid.get(openid) || 0;
    paidRechargeByOpenid.set(openid, oldAmount + amount);
  }

  const rechargeUsers = [];
  for (const user of usersResult.list) {
    const openid = safeStr(user?.openid || user?._id);
    if (!openid) continue;

    const totalRechargeFromUser = Math.max(
      0,
      toNum(user?.totalRecharge, toNum(user?.totalRechargeAmount, 0))
    );
    const totalRechargeFromLogs = Math.max(0, toNum(paidRechargeByOpenid.get(openid), 0));
    const totalRecharge = round2(Math.max(totalRechargeFromUser, totalRechargeFromLogs));

    if (totalRecharge <= 0) continue;

    const level = normalizeMemberLevel(user?.memberLevel);
    rechargeUsers.push({
      openid,
      userName: pickUserName(user),
      phone: pickUserPhone(user),
      totalRecharge,
      balance: round2(Math.max(0, toNum(user?.balance, 0))),
      memberLevel: level,
      memberLevelLabel: memberLevelLabel(level),
    });
  }

  rechargeUsers.sort((a, b) => {
    if (b.totalRecharge !== a.totalRecharge) return b.totalRecharge - a.totalRecharge;
    return b.balance - a.balance;
  });

  const totalCustomers = usersResult.list.length;

  return {
    ok: true,
    data: {
      order: {
        timeType: orderWindow.type,
        timeLabel: orderWindow.label,
        startAt: orderWindow.startAt,
        endAt: orderWindow.endAt,
        startDate: orderWindow.startDate,
        endDate: orderWindow.endDate,
        paidOrders,
        netRevenue,
        avgOrderValue,
        refundedAmount: round2(refundedAmount),
      },
      customer: {
        totalCustomers,
        orderingCustomers: paidOrderUserSet.size,
        memberLevelCounts,
      },
      recharge: {
        users: rechargeUsers,
        totalRechargeUsers: rechargeUsers.length,
        totalRechargeAmount: round2(
          rechargeUsers.reduce((sum, item) => sum + toNum(item.totalRecharge, 0), 0)
        ),
      },
      meta: {
        generatedAt: now(),
        maxScanDocs: MAX_SCAN_DOCS,
        truncatedRangeOrders: rangeOrdersResult.truncated,
        truncatedAllOrders: allOrdersResult.truncated,
        truncatedUsers: usersResult.truncated,
        truncatedRecharges: rechargesResult.truncated,
      },
    },
  };
}

async function getBalanceLogs(openidInput, limitInput) {
  const openid = safeStr(openidInput);
  if (!openid) {
    return { ok: false, message: '缺少用户标识' };
  }

  const limit = normalizeBalanceLimit(limitInput);

  const [userRes, ordersResult, rechargesResult] = await Promise.all([
    db.collection(COL_CUSTOMERS).doc(openid).field({
      _id: true,
      openid: true,
      nickName: true,
      nickname: true,
      name: true,
      userName: true,
      username: true,
      phone: true,
      mobile: true,
      tel: true,
      reservePhone: true,
      addresses: true,
      balance: true,
      memberLevel: true,
    }).get().catch(() => null),
    scanCollection(COL_ORDERS, {
      where: { openid },
      field: {
        _id: true,
        orderNo: true,
        createdAt: true,
        amount: true,
        payment: true,
        refund: true,
      },
    }),
    scanCollection(COL_RECHARGES, {
      where: { openid },
      field: {
        _id: true,
        outTradeNo: true,
        status: true,
        amount: true,
        createdAt: true,
        paidAt: true,
      },
    }),
  ]);

  const user = userRes?.data;
  if (!user) {
    return { ok: false, message: '用户不存在' };
  }

  const logs = [];

  for (const recharge of rechargesResult.list) {
    if (safeStr(recharge?.status).toLowerCase() !== 'paid') continue;
    const amount = round2(Math.max(0, toNum(recharge?.amount, 0)));
    if (amount <= 0) continue;

    const refNo = safeStr(recharge?.outTradeNo || recharge?._id);
    logs.push({
      id: `recharge_${safeStr(recharge?._id) || logs.length + 1}`,
      scene: '余额充值',
      delta: amount,
      createdAt: Number(recharge?.paidAt || recharge?.createdAt || 0),
      remark: refNo ? `充值单号 ${refNo}` : '余额充值',
    });
  }

  for (const order of ordersResult.list) {
    if (!isPaidOrder(order)) continue;
    if (!isBalanceOrder(order)) continue;

    const orderNo = safeStr(order?.orderNo);
    const amount = round2(Math.max(0, toNum(order?.amount?.total, 0)));

    if (amount > 0) {
      logs.push({
        id: `balance_pay_${safeStr(order?._id) || orderNo || logs.length + 1}`,
        scene: '余额支付',
        delta: -amount,
        createdAt: Number(order?.payment?.paidAt || order?.createdAt || 0),
        remark: orderNo ? `订单号 ${orderNo}` : '余额支付',
      });
    }

    if (isRefundSuccess(order) && amount > 0) {
      logs.push({
        id: `balance_refund_${safeStr(order?._id) || orderNo || logs.length + 1}`,
        scene: '订单退款',
        delta: amount,
        createdAt: Number(order?.refund?.refundedAt || order?.refund?.handleAt || order?.createdAt || 0),
        remark: orderNo ? `订单号 ${orderNo}` : '退款到余额',
      });
    }
  }

  logs.sort((a, b) => {
    const t1 = Number(a?.createdAt || 0);
    const t2 = Number(b?.createdAt || 0);
    if (t2 !== t1) return t2 - t1;
    return b.delta - a.delta;
  });

  const level = normalizeMemberLevel(user?.memberLevel);

  return {
    ok: true,
    data: {
      user: {
        openid,
        userName: pickUserName(user),
        phone: pickUserPhone(user),
        memberLevel: level,
        memberLevelLabel: memberLevelLabel(level),
        balance: round2(Math.max(0, toNum(user?.balance, 0))),
      },
      logs: logs.slice(0, limit),
      total: logs.length,
      limit,
      meta: {
        maxScanDocs: MAX_SCAN_DOCS,
        truncatedOrders: ordersResult.truncated,
        truncatedRecharges: rechargesResult.truncated,
      },
    },
  };
}

module.exports = {
  getOverview,
  getBalanceLogs,
};
