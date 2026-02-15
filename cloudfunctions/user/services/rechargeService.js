// cloudfunctions/user/services/rechargeService.js
const cloud = require('wx-server-sdk');
const {
  COL_USERS,
  COL_SHOP_CONFIG,
  COL_RECHARGES,
  WX_PAY_CALLBACK_FN,
  FORCE_ENV_ID,
} = require('../config/constants');
const { now, toNum } = require('../utils/common');
const { ensureMemberLevelDefaults, getDefaultMemberLevels } = require('./memberLevelDefaults');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function toInt(v, d = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function safeStr(v) {
  return String(v == null ? '' : v).trim();
}

function yuanToFen(amountYuan) {
  const n = Number(amountYuan || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function genRechargeNo() {
  // R + yyyyMMddHHmmss + 4 random digits
  const d = new Date();
  const rnd = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `R${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}${rnd}`;
}

function defaultMemberLevels() {
  return getDefaultMemberLevels();
}

function normalizeMemberLevels(raw) {
  const def = defaultMemberLevels();
  const arr = Array.isArray(raw) ? raw : [];
  const byLevel = new Map();
  arr.forEach((it) => {
    const level = toInt(it && it.level, 0);
    if (level < 1 || level > 4) return;
    const threshold = toNum(it && it.threshold, def[level - 1].threshold);
    const coupons = Array.isArray(it && it.coupons) ? it.coupons : [];
    byLevel.set(level, { level, threshold, coupons });
  });
  return def.map((d) => byLevel.get(d.level) || d);
}

function calcMemberLevel(totalRechargeYuan, levels) {
  const total = toNum(totalRechargeYuan, 0);
  const cfg = normalizeMemberLevels(levels);
  let level = 0;
  cfg.forEach((x) => {
    if (total >= toNum(x.threshold, 0)) level = Math.max(level, toInt(x.level, 0));
  });
  return Math.max(0, Math.min(4, level));
}

function buildGrantPlan(levelsCfg, fromLevel, toLevel) {
  const cfg = normalizeMemberLevels(levelsCfg);
  const list = [];
  for (let lv = fromLevel + 1; lv <= toLevel; lv++) {
    const rule = cfg.find((x) => toInt(x.level, 0) === lv);
    const coupons = Array.isArray(rule && rule.coupons) ? rule.coupons : [];
    coupons.forEach((c) => {
      const couponId = safeStr(c && (c.couponId || c._id || c.id));
      const count = Math.max(0, toInt(c && c.count, 0));
      if (!couponId || count <= 0) return;
      list.push({ couponId, count, level: lv });
    });
  }
  return list;
}

async function _getPayConfig() {
  const got = await db.collection(COL_SHOP_CONFIG).doc('main').get().catch(() => null);
  const cfg = got?.data || {};
  const subMchId = safeStr(cfg.subMchId);
  if (!subMchId) throw new Error('请先在商家端配置微信支付子商户号(subMchId)');
  return { subMchId };
}

async function createRechargeOrder(event, openid) {
  // Seed default member coupons/levels (idempotent; keep manual edits).
  await ensureMemberLevelDefaults(db, now()).catch(() => {});

  const amount = toNum(event && event.amount, 0);
  const body = safeStr(event && event.body) || '余额充值';
  const totalFee = yuanToFen(amount);
  if (!totalFee) return { error: 'invalid_amount' };

  const outTradeNo = genRechargeNo();
  const nowTs = now();

  // 1) Create recharge record first (idempotent anchor for later callbacks).
  const doc = {
    openid,
    outTradeNo,
    amount: Number((totalFee / 100).toFixed(2)),
    totalFee,
    body,
    scene: 'recharge',
    status: 'pending',
    statusText: '待支付',
    createdAt: nowTs,
    updatedAt: nowTs,
  };
  const addRes = await db.collection(COL_RECHARGES).add({ data: doc });
  const rechargeId = addRes && addRes._id ? String(addRes._id) : '';
  if (!rechargeId) return { error: 'create_failed' };

  // 2) Create WeChat Pay order.
  try {
    const { subMchId } = await _getPayConfig();
    const payRes = await cloud.cloudPay.unifiedOrder({
      body,
      outTradeNo,
      totalFee,
      tradeType: 'JSAPI',
      openid,
      spbillCreateIp: '127.0.0.1',
      subMchId,
      functionName: WX_PAY_CALLBACK_FN,
      envId: FORCE_ENV_ID || cloud.getWXContext().ENV,
    });

    await db.collection(COL_RECHARGES).doc(rechargeId).update({
      data: {
        payStatus: 'pending',
        updatedAt: now(),
      }
    }).catch(() => {});

    return { ok: true, data: { rechargeId, payment: payRes.payment } };
  } catch (e) {
    // Create pay failed -> delete pending record to avoid clutter.
    await db.collection(COL_RECHARGES).doc(rechargeId).remove().catch(() => {});
    return { error: 'wxpay_failed', message: e.message || '' };
  }
}

async function _grantLevelCouponsTx(tx, userDoc, userRef, levelsCfg, fromLevel, toLevel) {
  const plan = buildGrantPlan(levelsCfg, fromLevel, toLevel);
  if (!plan.length) return { newCoupons: [], warnings: [] };

  const nowTs = now();
  const warnings = [];
  const newCoupons = [];

  // Merge duplicates (same couponId may appear across levels or within a level).
  const needMap = new Map();
  plan.forEach((p) => {
    const key = p.couponId;
    const prev = needMap.get(key) || { couponId: key, count: 0, levels: [] };
    prev.count += p.count;
    prev.levels.push(p.level);
    needMap.set(key, prev);
  });

  for (const need of needMap.values()) {
    const couponId = need.couponId;
    const count = Math.max(0, toInt(need.count, 0));
    if (!couponId || count <= 0) continue;

    const couponRef = tx.collection(COL_SHOP_CONFIG).doc(couponId);
    const couponDoc = await couponRef.get().catch(() => null);
    const coupon = couponDoc && couponDoc.data;
    if (!coupon || coupon.type !== 'coupon_template' || coupon.status !== 'active') {
      warnings.push(`coupon_unavailable:${couponId}`);
      continue;
    }

    const totalQty = toInt(coupon.totalQuantity, 0);
    const claimedQty = toInt(coupon.claimedQuantity, 0);
    const available = Math.max(0, totalQty - claimedQty);
    const grantCount = Math.min(count, available);
    if (grantCount <= 0) {
      warnings.push(`coupon_out_of_stock:${couponId}`);
      continue;
    }

    const title = safeStr(coupon.title);
    const minSpend = toNum(coupon.minSpend, 0);
    const discount = toNum(coupon.discount, 0);

    for (let i = 0; i < grantCount; i++) {
      newCoupons.push({
        userCouponId: `${couponId}_${nowTs}_${Math.floor(Math.random() * 1000000)}`,
        couponId: couponId,
        title,
        minSpend,
        discount,
        claimedAt: nowTs,
        source: 'member_level',
      });
    }

    await couponRef.update({
      data: {
        claimedQuantity: claimedQty + grantCount,
        updatedAt: nowTs,
      }
    });
  }

  if (newCoupons.length) {
    const couponsPatch = Array.isArray(userDoc && userDoc.coupons)
      ? { coupons: _.push(newCoupons) }
      : { coupons: newCoupons };

    await userRef.update({
      data: {
        ...couponsPatch,
        updatedAt: nowTs,
      }
    });
  }

  return { newCoupons, warnings };
}

async function _applyRechargeSuccessByOutTradeNo(outTradeNo) {
  // Ensure default coupons exist before granting.
  await ensureMemberLevelDefaults(db, now()).catch(() => {});

  const rec = await db.collection(COL_RECHARGES).where({ outTradeNo }).limit(1).get();
  const recharge = (rec && rec.data && rec.data[0]) || null;
  if (!recharge) return { ok: false, error: 'not_found' };
  if (recharge.status === 'paid') return { ok: true, data: { rechargeId: recharge._id } };

  const rechargeId = String(recharge._id || '');
  const amount = toNum(recharge.amount, 0);
  if (!rechargeId || amount <= 0) return { ok: false, error: 'bad_recharge_doc' };

  const nowTs = now();

  return await db.runTransaction(async (tx) => {
    const rechargeRef = tx.collection(COL_RECHARGES).doc(rechargeId);
    const gotR = await rechargeRef.get().catch(() => null);
    const r = gotR && gotR.data;
    if (!r) return { ok: false, error: 'not_found' };
    if (r.status === 'paid') return { ok: true, data: { rechargeId } };

    const openid = safeStr(r.openid);
    if (!openid) return { ok: false, error: 'bad_openid' };

    const userRef = tx.collection(COL_USERS).doc(openid);
    const gotU = await userRef.get().catch(() => null);
    const u = gotU && gotU.data;
    if (!u) return { ok: false, error: 'user_not_found' };

    const curBalance = toNum(u.balance, 0);
    const curTotalRecharge = toNum(u.totalRecharge, 0);
    const curLevel = toInt(u.memberLevel, 0);

    const nextBalance = Number((curBalance + amount).toFixed(2));
    const nextTotalRecharge = Number((curTotalRecharge + amount).toFixed(2));

    const shopCfgDoc = await tx.collection(COL_SHOP_CONFIG).doc('main').get().catch(() => null);
    const shopCfg = shopCfgDoc && shopCfgDoc.data ? shopCfgDoc.data : {};
    const levelsCfg = shopCfg && shopCfg.memberLevels;

    const nextLevel = calcMemberLevel(nextTotalRecharge, levelsCfg);

    // Update user main fields first; coupons are granted with an additional update when needed.
    await userRef.update({
      data: {
        balance: nextBalance,
        totalRecharge: nextTotalRecharge,
        memberLevel: nextLevel,
        updatedAt: nowTs,
      }
    });

    const grantResult = await _grantLevelCouponsTx(tx, u, userRef, levelsCfg, curLevel, nextLevel);

    await rechargeRef.update({
      data: {
        status: 'paid',
        statusText: '已到账',
        paidAt: nowTs,
        updatedAt: nowTs,
        memberLevelFrom: curLevel,
        memberLevelTo: nextLevel,
        grantWarnings: grantResult.warnings,
      }
    });

    return {
      ok: true,
      data: {
        rechargeId,
        amount,
        balance: nextBalance,
        totalRecharge: nextTotalRecharge,
        memberLevel: nextLevel,
        grantedCoupons: grantResult.newCoupons.length,
      }
    };
  });
}

async function confirmRechargePaid(rechargeId, openid) {
  const id = safeStr(rechargeId);
  if (!id) return { error: 'invalid_id' };

  const got = await db.collection(COL_RECHARGES).doc(id).get().catch(() => null);
  const r = got && got.data;
  if (!r) return { error: 'not_found' };
  if (safeStr(r.openid) && safeStr(r.openid) !== safeStr(openid)) return { error: 'no_permission' };
  if (r.status === 'paid') return { data: { ok: true } };

  // Fallback: actively query and settle (covers missing/delayed payment callback).
  const outTradeNo = safeStr(r.outTradeNo);
  if (!outTradeNo) return { error: 'not_paid' };

  // Some environments may not expose queryOrder; we keep this optional.
  if (cloud.cloudPay && typeof cloud.cloudPay.queryOrder === 'function') {
    try {
      const { subMchId } = await _getPayConfig();
      const q = await cloud.cloudPay.queryOrder({
        outTradeNo,
        subMchId,
      });
      const tradeState = safeStr(q && (q.tradeState || q.trade_state));
      if (tradeState === 'SUCCESS') {
        const settle = await _applyRechargeSuccessByOutTradeNo(outTradeNo);
        if (settle && settle.ok) return { data: { ok: true } };
      }
    } catch (_) {
      // ignore, fall back to polling
    }
  }

  return { error: 'not_paid' };
}

async function listRecharges(openid, event = {}) {
  const scene = safeStr(event.scene);
  const limit = Math.min(200, Math.max(1, toInt(event.limit, 50)));
  // Only show settled logs by default.
  const where = { openid: safeStr(openid), status: 'paid' };
  if (scene) where.scene = scene;
  if (event && event.includeAll) delete where.status;

  try {
    const r = await db.collection(COL_RECHARGES).where(where).orderBy('createdAt', 'desc').limit(limit).get();
    return { data: r.data || [] };
  } catch (_) {
    return { data: [] };
  }
}

async function cancelRechargeOrder(rechargeId, openid) {
  const id = safeStr(rechargeId);
  if (!id) return { error: 'invalid_id' };

  try {
    const ref = db.collection(COL_RECHARGES).doc(id);
    const got = await ref.get().catch(() => null);
    const r = got && got.data;
    if (!r) return { error: 'not_found' };
    if (safeStr(r.openid) && safeStr(r.openid) !== safeStr(openid)) return { error: 'no_permission' };
    if (r.status === 'paid') return { data: { ok: true, skipped: true } };

    await ref.update({
      data: {
        status: 'cancelled',
        statusText: '已取消',
        updatedAt: now(),
      }
    }).catch(() => {});

    return { data: { ok: true } };
  } catch (e) {
    return { error: 'server_error', message: e.message || '' };
  }
}

async function sysHandlePaySuccess(payEvent) {
  const outTradeNo = safeStr(payEvent && (payEvent.outTradeNo || payEvent.out_trade_no));
  if (!outTradeNo) return { errcode: 0, errmsg: 'OK' };

  try {
    const settle = await _applyRechargeSuccessByOutTradeNo(outTradeNo);
    if (settle && settle.ok) return { errcode: 0, errmsg: 'OK' };
    return { errcode: 0, errmsg: 'OK' };
  } catch (e) {
    console.error('[recharge] sysHandlePaySuccess error', e);
    return { errcode: 0, errmsg: 'OK' };
  }
}

module.exports = {
  createRechargeOrder,
  confirmRechargePaid,
  listRecharges,
  cancelRechargeOrder,
  sysHandlePaySuccess,
};
