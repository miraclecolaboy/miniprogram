const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COL_ORDERS = 'orders';
const COL_USERS = 'users';
const COL_RECHARGES = 'recharges';

const RUN_CONFIRM_TEXT = 'RUN_LEGACY_MIGRATION';
const ORDER_STATUS_PAID_LIKE = new Set(['paid', 'making', 'preparing', 'processing', 'ready', 'delivering', 'done']);
const CLIENT_VISIBLE_STATUS = new Set(['pending_payment', 'processing', 'ready', 'delivering', 'done', 'cancelled', 'closed']);

function toStr(v) {
  return String(v == null ? '' : v).trim();
}

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function clampInt(v, min, max, def) {
  const n = toInt(v, def);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function toBool(v, def = false) {
  if (typeof v === 'boolean') return v;
  const s = toStr(v).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return def;
}

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function stable(v) {
  return JSON.stringify(v || null);
}

function round2(v) {
  return Number(toNum(v, 0).toFixed(2));
}

function calcLevelByTotalRecharge(totalRechargeYuan) {
  const t = toNum(totalRechargeYuan, 0);
  if (t >= 1000) return 4;
  if (t >= 500) return 3;
  if (t >= 300) return 2;
  if (t >= 100) return 1;
  return 0;
}

function pickFiniteNum(...candidates) {
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function isLikelyOpenid(v) {
  const s = toStr(v);
  if (!s) return false;
  if (s.includes(' ')) return false;
  return /^o[a-zA-Z0-9_-]{15,}$/.test(s);
}

function isMeaningfulId(v) {
  const s = toStr(v).toLowerCase();
  if (!s) return false;
  if (s === 'undefined' || s === 'null' || s === 'none' || s === '0' || s === 'nan') return false;
  return true;
}

function pickOpenid(...candidates) {
  const vals = candidates.map((x) => toStr(x)).filter((x) => isMeaningfulId(x));
  const good = vals.find((x) => isLikelyOpenid(x));
  if (good) return good;
  return vals[0] || '';
}

function statusToNew(rawStatus, paymentStatus, paidAt) {
  const s = toStr(rawStatus).toLowerCase();
  const paidLike = toStr(paymentStatus).toLowerCase() === 'paid' || toNum(paidAt, 0) > 0;
  if (s === 'created' || s === 'unpaid' || s === 'wait_pay' || s === 'pending_pay') {
    return paidLike ? 'processing' : 'pending_payment';
  }
  if (s === 'pending') return paidLike ? 'processing' : 'pending_payment';
  if (s === 'paid' || s === 'making' || s === 'preparing') return 'processing';
  if (!s) {
    if (paidLike) return 'processing';
    return 'pending_payment';
  }
  if (!CLIENT_VISIBLE_STATUS.has(s)) {
    return paidLike ? 'processing' : 'pending_payment';
  }
  return s;
}

function shouldArchiveCancelledOrder(doc) {
  const status = toStr(doc && doc.status).toLowerCase();
  if (status !== 'cancelled' && status !== 'canceled') return false;

  const paidAt = toNum(doc && doc.paidAt, 0);
  const paymentStatus = toStr(doc && doc.payment && doc.payment.status).toLowerCase()
    || toStr(doc && doc.pay && doc.pay.status).toLowerCase();
  const paidLike = paidAt > 0 || paymentStatus === 'paid';
  if (paidLike) return false;

  return true;
}

function normalizeRefund(refund) {
  if (!isObj(refund)) return null;
  const out = { ...refund };
  const st = toStr(out.status).toLowerCase();
  if (st === 'pending') out.status = 'applied';
  if (!toNum(out.appliedAt, 0) && toNum(out.applyAt, 0) > 0) out.appliedAt = toNum(out.applyAt, 0);
  return out;
}

function buildOrderAmount(doc) {
  const cur = isObj(doc.amount) ? doc.amount : {};
  const goods = round2(
    Number.isFinite(Number(cur.goods))
      ? cur.goods
      : (Number.isFinite(Number(doc.totalPrice)) ? doc.totalPrice : cur.total)
  );
  const delivery = round2(
    Number.isFinite(Number(cur.delivery))
      ? cur.delivery
      : (Number.isFinite(Number(doc.deliveryFee)) ? doc.deliveryFee : 0)
  );
  const vipDiscount = round2(
    Number.isFinite(Number(cur.vipDiscount))
      ? cur.vipDiscount
      : (Number.isFinite(Number(cur.discount)) ? cur.discount : doc.vipDiscount)
  );
  const couponDiscount = round2(
    Number.isFinite(Number(cur.couponDiscount))
      ? cur.couponDiscount
      : (Number.isFinite(Number(doc.couponDiscount)) ? doc.couponDiscount : 0)
  );
  const totalFromField = Number.isFinite(Number(cur.total))
    ? Number(cur.total)
    : (Number.isFinite(Number(doc.payAmount)) ? Number(doc.payAmount) : NaN);
  const total = round2(
    Number.isFinite(totalFromField)
      ? totalFromField
      : Math.max(0, goods + delivery - vipDiscount - couponDiscount)
  );

  return {
    goods,
    delivery,
    discount: vipDiscount,
    vipDiscount,
    couponDiscount,
    total,
  };
}

function buildOrderPayment(doc, nextAmount, nextStatus) {
  const current = isObj(doc.payment) ? doc.payment : {};
  const legacy = isObj(doc.pay) ? doc.pay : {};

  let method = toStr(current.method || legacy.method || legacy.type || doc.payMethod).toLowerCase();
  if (method === 'wxpay' || method === 'wechatpay') method = 'wechat';
  if (!method) {
    if (toNum(nextAmount.total, 0) <= 0) method = 'free';
    else if (toStr(legacy.type).toLowerCase() === 'balance' || toStr(doc.payMethod).toLowerCase() === 'balance') method = 'balance';
    else method = 'wechat';
  }

  let status = toStr(current.status || legacy.status).toLowerCase();
  if (status === 'created') status = 'pending';
  if (status === 'success') status = 'paid';
  if (!status) status = ORDER_STATUS_PAID_LIKE.has(nextStatus) || toNum(doc.paidAt, 0) > 0 ? 'paid' : 'pending';

  const paidAt = toNum(current.paidAt, 0) || toNum(legacy.paidAt, 0) || toNum(doc.paidAt, 0);
  const outTradeNo = toStr(current.outTradeNo || legacy.outTradeNo);
  const totalFee = toInt(current.totalFee, 0) || toInt(legacy.totalFee, 0);
  const transactionId = toStr(current.transactionId || legacy.transactionId);

  const out = {
    ...current,
    method,
    status,
    paidAt,
  };
  if (outTradeNo) out.outTradeNo = outTradeNo;
  if (totalFee > 0) out.totalFee = totalFee;
  if (transactionId) out.transactionId = transactionId;
  return out;
}

function buildOrderShipping(doc) {
  if (isObj(doc.shippingInfo)) return doc.shippingInfo;
  if (isObj(doc.address)) return doc.address;
  if (toStr(doc.address)) return { address: toStr(doc.address) };
  return null;
}

function buildOrderPickup(doc) {
  const old = isObj(doc.pickupInfo) ? doc.pickupInfo : {};
  const phone = toStr(old.phone || doc.reservePhone || doc.receiverPhone || doc.contactPhone);
  const code = toStr(old.code || doc.pickupCode);
  const time = old.time != null && old.time !== '' ? old.time : (doc.pickupTime || '');
  return { ...old, code, time, phone };
}

function buildOrderPatch(doc, nowTs) {
  const patch = {};
  const openid = pickOpenid(
    doc.openid,
    doc._openid,
    doc.openId,
    doc.userOpenid,
    doc.buyerOpenid,
    doc.customerOpenid
  );
  if (openid && openid !== toStr(doc.openid)) patch.openid = openid;

  const nextAmount = buildOrderAmount(doc);
  if (stable(nextAmount) !== stable(doc.amount)) patch.amount = nextAmount;

  const nextStatus = statusToNew(
    doc.status,
    (doc.payment && doc.payment.status) || (doc.pay && doc.pay.status),
    doc.paidAt
  );
  let finalStatus = nextStatus;
  if (shouldArchiveCancelledOrder(doc)) {
    finalStatus = 'closed';
    if (toStr(doc.statusText) !== '已关闭') patch.statusText = '已关闭';
  }
  if (finalStatus && finalStatus !== toStr(doc.status).toLowerCase()) patch.status = finalStatus;

  const nextPayment = buildOrderPayment(doc, nextAmount, finalStatus);
  if (stable(nextPayment) !== stable(doc.payment)) patch.payment = nextPayment;

  const nextShipping = buildOrderShipping(doc);
  if (nextShipping && stable(nextShipping) !== stable(doc.shippingInfo)) patch.shippingInfo = nextShipping;

  const nextPickup = buildOrderPickup(doc);
  if (stable(nextPickup) !== stable(doc.pickupInfo)) patch.pickupInfo = nextPickup;

  const phone = toStr(nextPickup.phone || doc.reservePhone || doc.receiverPhone || doc.contactPhone);
  if (phone && phone !== toStr(doc.reservePhone)) patch.reservePhone = phone;
  if (phone && phone !== toStr(doc.receiverPhone)) patch.receiverPhone = phone;

  if (toStr(doc.mode) === 'ziti' && !toStr(doc.storeSubMode)) patch.storeSubMode = 'ziti';

  const nextRefund = normalizeRefund(doc.refund);
  if (nextRefund && stable(nextRefund) !== stable(doc.refund)) patch.refund = nextRefund;

  if (Object.keys(patch).length && !toNum(doc.updatedAt, 0)) patch.updatedAt = nowTs;
  return patch;
}

function normalizeAddressList(addresses, defaultAddressId) {
  if (!Array.isArray(addresses)) return { addresses: [], defaultAddressId: '' };
  const next = addresses
    .filter((x) => x && typeof x === 'object')
    .map((x) => {
      const id = toStr(x.id || x._id);
      const region = toStr(x.region);
      const detail = toStr(x.detail);
      const address = toStr(x.address) || (region && detail ? `${region} ${detail}` : (region || detail));
      const lat = Number(x.lat ?? x.latitude ?? x.location?.lat ?? x.location?.latitude);
      const lng = Number(x.lng ?? x.longitude ?? x.location?.lng ?? x.location?.longitude);
      const out = {
        ...x,
        id,
        name: toStr(x.name),
        phone: toStr(x.phone),
        region,
        detail,
        address,
      };
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        out.lat = lat;
        out.lng = lng;
      }
      return out;
    })
    .filter((x) => !!x.id);

  let defId = toStr(defaultAddressId);
  if (!defId && next.length) {
    defId = toStr((next.find((x) => !!x.isDefault) || next[0]).id);
  }
  return { addresses: next, defaultAddressId: defId };
}

function buildUserPatch(doc, nowTs) {
  const patch = {};
  const openid = pickOpenid(
    doc.openid,
    doc._openid,
    doc.openId,
    doc.userOpenid,
    doc.buyerOpenid,
    doc._id
  );
  if (openid && openid !== toStr(doc.openid)) patch.openid = openid;

  const addr = normalizeAddressList(doc.addresses, doc.defaultAddressId);
  if (stable(addr.addresses) !== stable(doc.addresses)) patch.addresses = addr.addresses;
  if (addr.defaultAddressId !== toStr(doc.defaultAddressId)) patch.defaultAddressId = addr.defaultAddressId;

  if (!isObj(doc.orderStats)) patch.orderStats = { count: 0, lastOrderAt: 0, lastOrderId: '' };
  if (!Array.isArray(doc.coupons)) patch.coupons = [];
  if (!Array.isArray(doc.redeemCodes)) patch.redeemCodes = [];

  const minRechargeByLevel = { 0: 0, 1: 100, 2: 300, 3: 500, 4: 1000 };
  let level = Number.isFinite(Number(doc.memberLevel)) ? toInt(doc.memberLevel, 0) : NaN;
  let totalRecharge = pickFiniteNum(
    doc.totalRecharge,
    doc.totalRechargeAmount,
    doc.rechargeTotal,
    doc.total_recharge
  );

  if (!Number.isFinite(level)) {
    if (Number.isFinite(totalRecharge)) level = calcLevelByTotalRecharge(totalRecharge);
    else level = toNum(doc.memberExpireAt, 0) > nowTs ? 4 : 0;
    patch.memberLevel = level;
  }

  const levelClamped = Math.max(0, Math.min(4, toInt(level, 0)));
  const minRecharge = minRechargeByLevel[levelClamped] || 0;
  if (!Number.isFinite(totalRecharge)) totalRecharge = minRecharge;
  else if (totalRecharge < minRecharge) totalRecharge = minRecharge;
  const normalizedTotalRecharge = round2(totalRecharge);

  if (!Number.isFinite(Number(doc.totalRecharge)) || round2(doc.totalRecharge) !== normalizedTotalRecharge) {
    patch.totalRecharge = normalizedTotalRecharge;
  }
  if (!Number.isFinite(Number(doc.totalRechargeAmount)) || round2(doc.totalRechargeAmount) !== normalizedTotalRecharge) {
    patch.totalRechargeAmount = normalizedTotalRecharge;
  }

  if (!Number.isFinite(Number(doc.balance))) patch.balance = 0;
  if (!Number.isFinite(Number(doc.points))) patch.points = 0;

  if (Object.keys(patch).length && !toNum(doc.updatedAt, 0)) patch.updatedAt = nowTs;
  if (!toNum(doc.createdAt, 0)) patch.createdAt = nowTs;
  return patch;
}

function buildRechargePatch(doc, nowTs) {
  const patch = {};
  const openid = pickOpenid(
    doc.openid,
    doc._openid,
    doc.openId,
    doc.userOpenid,
    doc.buyerOpenid
  );
  if (openid && openid !== toStr(doc.openid)) patch.openid = openid;

  const status = toStr(doc.status).toLowerCase();
  if (status === 'success') patch.status = 'paid';

  const outTradeNo = toStr(doc.outTradeNo || doc.bizId);
  if (outTradeNo && outTradeNo !== toStr(doc.outTradeNo)) patch.outTradeNo = outTradeNo;

  const amount = Number.isFinite(Number(doc.amount)) ? Number(doc.amount) : Number(doc.amountExpected);
  if (Number.isFinite(amount) && Number(doc.amount) !== Number(amount.toFixed(2))) {
    patch.amount = Number(amount.toFixed(2));
  }

  if (toStr((patch.status || status)) === 'paid') {
    if (!toNum(doc.paidAt, 0)) patch.paidAt = toNum(doc.updatedAt, 0) || toNum(doc.createdAt, 0) || nowTs;
    if (!toStr(doc.statusText)) patch.statusText = '已到账';
  }

  if (Object.keys(patch).length && !toNum(doc.updatedAt, 0)) patch.updatedAt = nowTs;
  return patch;
}

async function processCollection({
  collectionName,
  offset,
  pageSize,
  maxScan,
  sampleSize,
  write,
  patchBuilder,
  nowTs,
}) {
  let scanned = 0;
  let changed = 0;
  let written = 0;
  let failed = 0;
  const samples = [];
  const errors = [];
  let done = false;

  while (scanned < maxScan) {
    const size = Math.min(pageSize, maxScan - scanned);
    const res = await db.collection(collectionName).skip(offset + scanned).limit(size).get();
    const list = Array.isArray(res && res.data) ? res.data : [];
    if (!list.length) {
      done = true;
      break;
    }

    for (const doc of list) {
      const patch = patchBuilder(doc, nowTs);
      const keys = Object.keys(patch || {});
      if (!keys.length) continue;
      changed += 1;

      if (samples.length < sampleSize) {
        samples.push({ id: toStr(doc._id), keys });
      }

      if (write) {
        try {
          await db.collection(collectionName).doc(doc._id).update({ data: patch });
          written += 1;
        } catch (e) {
          failed += 1;
          if (errors.length < 10) {
            errors.push({
              id: toStr(doc._id),
              message: toStr(e && (e.errMsg || e.message || e)),
            });
          }
        }
      }
    }

    scanned += list.length;
    if (list.length < size) {
      done = true;
      break;
    }
  }

  const nextOffset = offset + scanned;
  return {
    collection: collectionName,
    offsetIn: offset,
    offsetOut: nextOffset,
    scanned,
    changed,
    written,
    failed,
    done,
    hasMore: !done,
    samples,
    errors,
  };
}

exports.main = async (event) => {
  const startedAt = Date.now();
  const action = toStr(event && event.action).toLowerCase() || 'preview';
  const write = action === 'run' || action === 'execute';

  if (write && toStr(event && event.confirm) !== RUN_CONFIRM_TEXT) {
    return {
      ok: false,
      error: 'confirm_required',
      message: `Set confirm=${RUN_CONFIRM_TEXT} to execute writes.`,
    };
  }

  const pageSize = clampInt(event && event.pageSize, 20, 100, 100);
  const scanAll = toBool(event && event.scanAll, true);
  const maxScan = scanAll
    ? Number.MAX_SAFE_INTEGER
    : clampInt(event && event.maxScanPerCollection, pageSize, 200000, 20000);
  const sampleSize = clampInt(event && event.sampleSize, 0, 20, 5);
  const offsets = isObj(event && event.offsets) ? event.offsets : {};

  const targetMap = {
    orders: { collectionName: COL_ORDERS, patchBuilder: buildOrderPatch },
    users: { collectionName: COL_USERS, patchBuilder: buildUserPatch },
    recharges: { collectionName: COL_RECHARGES, patchBuilder: buildRechargePatch },
  };

  const requestedTargets = Array.isArray(event && event.targets) && event.targets.length
    ? event.targets.map((x) => toStr(x).toLowerCase()).filter((x) => !!targetMap[x])
    : ['orders', 'users', 'recharges'];

  const targets = Array.from(new Set(requestedTargets));
  if (!targets.length) {
    return { ok: false, error: 'bad_targets', message: 'targets must contain orders/users/recharges' };
  }

  const nowTs = Date.now();
  const collections = {};
  const nextOffsets = {};
  let hasMore = false;
  let failedWrites = 0;

  for (const key of targets) {
    const cfg = targetMap[key];
    const offset = Math.max(0, toInt(offsets[key], 0));
    const out = await processCollection({
      collectionName: cfg.collectionName,
      offset,
      pageSize,
      maxScan,
      sampleSize,
      write,
      patchBuilder: cfg.patchBuilder,
      nowTs,
    });

    collections[key] = out;
    nextOffsets[key] = out.offsetOut;
    if (out.hasMore) hasMore = true;
    failedWrites += out.failed;
  }

  const endedAt = Date.now();
  return {
    ok: failedWrites === 0,
    action: write ? 'run' : 'preview',
    writeEnabled: write,
    hasMore,
    scanAll,
    nextOffsets,
    pageSize,
    maxScanPerCollection: maxScan,
    collections,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
  };
};
