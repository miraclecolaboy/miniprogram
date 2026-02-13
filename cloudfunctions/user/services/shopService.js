// cloudfunctions/user/services/shopService.js
const cloud = require('wx-server-sdk');
const {
  COL_SHOP_CONFIG,
  COL_CATEGORIES,
  COL_PRODUCTS,
  COL_USERS
} = require('../config/constants');
const {
  now,
  isCollectionNotExists,
  toNum,
  toInt,
  getTempUrlMap,
  gen6Code
} = require('../utils/common');
const { ensureMemberLevelDefaults } = require('./memberLevelDefaults');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function hasValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function pickInt(obj, keys, d = NaN) {
  const src = obj && typeof obj === 'object' ? obj : {};
  const arr = Array.isArray(keys) ? keys : [];
  for (const key of arr) {
    if (!hasValue(src[key])) continue;
    const n = toInt(src[key], NaN);
    if (Number.isFinite(n)) return n;
  }
  return d;
}

function pickPoints(gift) {
  const points = toNum(gift && gift.points, NaN);
  if (Number.isFinite(points)) return Math.max(0, Math.floor(points));
  const costPoints = toNum(gift && gift.costPoints, NaN);
  if (Number.isFinite(costPoints)) return Math.max(0, Math.floor(costPoints));
  return 0;
}

function getGiftInventory(gift) {
  const redeemedQuantity = Math.max(0, pickInt(gift, ['redeemedQuantity', 'soldQuantity', 'usedQuantity', 'exchangeCount'], 0));

  const stockField = gift && gift.stock;
  if (typeof stockField === 'object' && stockField) {
    const stockLeft = pickInt(stockField, ['left', 'leftQuantity', 'available', 'current']);
    const stockTotal = pickInt(stockField, ['total', 'totalQuantity', 'max']);
    const stockUsed = Math.max(0, pickInt(stockField, ['used', 'sold', 'redeemed'], 0));

    if (Number.isFinite(stockLeft)) {
      const leftQuantity = Math.max(0, stockLeft);
      const totalQuantity = Number.isFinite(stockTotal)
        ? Math.max(0, stockTotal)
        : leftQuantity + redeemedQuantity;
      return { totalQuantity, redeemedQuantity, leftQuantity, stockMode: true };
    }

    if (Number.isFinite(stockTotal)) {
      const totalQuantity = Math.max(0, stockTotal);
      const leftByStockUsed = Math.max(0, totalQuantity - Math.min(totalQuantity, stockUsed));
      const leftQuantity = redeemedQuantity > 0
        ? Math.max(0, totalQuantity - Math.min(totalQuantity, redeemedQuantity))
        : leftByStockUsed;
      return { totalQuantity, redeemedQuantity, leftQuantity, stockMode: true };
    }
  }

  const stockNum = toInt(stockField, NaN);
  if (Number.isFinite(stockNum)) {
    const leftQuantity = Math.max(0, stockNum);
    const totalQuantity = leftQuantity + redeemedQuantity;
    return { totalQuantity, redeemedQuantity, leftQuantity, stockMode: true };
  }

  const leftFromMain = pickInt(gift, ['leftQuantity', 'leftStock', 'available', 'stockLeft']);
  if (Number.isFinite(leftFromMain)) {
    const leftQuantity = Math.max(0, leftFromMain);
    const totalQuantity = leftQuantity + redeemedQuantity;
    return { totalQuantity, redeemedQuantity, leftQuantity, stockMode: true };
  }

  return { totalQuantity: 0, redeemedQuantity, leftQuantity: -1, stockMode: false };
}

function normalizeRedeemCode(item) {
  const code = String(item && item.code || '').trim();
  if (!/^\d{6}$/.test(code)) return null;

  return {
    code,
    giftName: String(item && item.giftName || '绉垎鍏戞崲').trim() || '绉垎鍏戞崲',
    costPoints: Math.max(0, Math.floor(toNum(item && item.costPoints, 0))),
    createdAt: Math.max(0, toInt(item && item.createdAt, 0)),
  };
}

function listUserRedeemCodes(userDoc) {
  const raw = Array.isArray(userDoc && userDoc.redeemCodes) ? userDoc.redeemCodes : [];
  return raw
    .filter((item) => {
      const consumedAt = Math.max(0, toInt(item && item.consumedAt, 0));
      return item && item.consumed !== true && consumedAt <= 0;
    })
    .map(normalizeRedeemCode)
    .filter(Boolean);
}

async function isRedeemCodeExistsInUsers(code) {
  const codeText = String(code || '').trim();
  if (!/^\d{6}$/.test(codeText)) return false;

  try {
    const quick = await db.collection(COL_USERS)
      .where({ redeemCodes: _.elemMatch({ code: codeText }) })
      .field({ _id: true })
      .limit(1)
      .get();
    if (Array.isArray(quick && quick.data) && quick.data.length) return true;
  } catch (_) {
    // Fallback to scan for environments where elemMatch is unavailable.
  }

  let skip = 0;
  const pageSize = 100;
  const maxScan = 10000;
  while (skip < maxScan) {
    const page = await db.collection(COL_USERS)
      .field({ redeemCodes: true })
      .skip(skip)
      .limit(pageSize)
      .get()
      .catch(() => null);

    const batch = Array.isArray(page && page.data) ? page.data : [];
    if (!batch.length) break;

    for (const user of batch) {
      const codes = Array.isArray(user && user.redeemCodes) ? user.redeemCodes : [];
      const hit = codes.some((item) => {
        const itemCode = String(item && item.code || '').trim();
        const consumedAt = Math.max(0, toInt(item && item.consumedAt, 0));
        return itemCode === codeText && item && item.consumed !== true && consumedAt <= 0;
      });
      if (hit) return true;
    }

    if (batch.length < pageSize) break;
    skip += batch.length;
  }

  return false;
}

async function getShopConfig() {
  const DEFAULT_CFG = {
    storeName: '',
    storeAddress: '',
    storeLat: 0,
    storeLng: 0,
    notice: '',
    waimaiOn: true,
    kuaidiOn: true,
    waimaiMaxKm: 10,
    minOrderZiti: 0,
    minOrderWaimai: 88,
    minOrderKuaidi: 100,
    waimaiDeliveryFee: 8,
    kuaidiDeliveryFee: 10,
    updatedAt: now(),
    banners: [],
  };

  try {
    await ensureMemberLevelDefaults(db, now()).catch(() => {});

    const got = await db.collection(COL_SHOP_CONFIG).doc('main').get().catch(() => null);
    const cfg = (got && got.data) ? got.data : {};
    const out = { ...DEFAULT_CFG, ...cfg };

    ['waimaiMaxKm', 'waimaiDeliveryFee', 'kuaidiDeliveryFee', 'minOrderZiti', 'minOrderWaimai', 'minOrderKuaidi', 'storeLat', 'storeLng'].forEach((k) => {
      const n = Number(out[k]);
      out[k] = Number.isFinite(n) ? n : DEFAULT_CFG[k];
    });

    out.waimaiOn = out.waimaiOn !== false;
    out.kuaidiOn = out.kuaidiOn !== false;
    out.banners = Array.isArray(out.banners) ? out.banners : [];

    delete out.subMchId;
    return { data: out };
  } catch (e) {
    if (isCollectionNotExists(e)) return { data: DEFAULT_CFG };
    return { error: 'server_error', message: e.message || '' };
  }
}

async function listCategories() {
  try {
    const r = await db.collection(COL_CATEGORIES).orderBy('sort', 'asc').limit(200).get();
    return { data: (r.data || []).map((x) => ({ id: x._id, name: x.name, sort: Number(x.sort || 0) })) };
  } catch (e) {
    console.error('[shopService.listGifts] error', e);
    return { data: [] };
  }
}

async function listProducts() {
  try {
    const r = await db.collection(COL_PRODUCTS)
      .where({ status: 1 })
      .field({ _id: 1, name: 1, desc: 1, detail: 1, imgs: 1, thumbFileID: 1, categoryId: 1, price: 1, modes: 1, hasSpecs: 1, specs: 1, skuList: 1, sort: 1 })
      .limit(1000)
      .get();

    const list = (r.data || []);
    list.sort((a, b) => (a.sort || 0) - (b.sort || 0));

    const thumbFileIds = list.map((p) => p.thumbFileID).filter(Boolean);
    const urlMap = await getTempUrlMap([...new Set(thumbFileIds)]);

    const mappedList = list.map((p) => ({
      _id: p._id,
      name: p.name || '',
      desc: p.desc || '',
      detail: p.detail || '',
      img: urlMap[p.thumbFileID] || '',
      thumbUrl: urlMap[p.thumbFileID] || '',
      imgs: (Array.isArray(p.imgs) && p.imgs.length ? p.imgs : []),
      categoryId: p.categoryId || '',
      price: Number(p.price || 0),
      modes: Array.isArray(p.modes) && p.modes.length ? p.modes : ['ziti', 'waimai', 'kuaidi'],
      hasSpecs: !!p.hasSpecs,
      specs: Array.isArray(p.specs) ? p.specs : [],
      sort: Number(p.sort || 0),
      skuList: (Array.isArray(p.skuList) ? p.skuList : [])
        .map((sku) => ({
          skuKey: String((sku && (sku.skuKey || sku._id)) || '').trim(),
          specText: String((sku && sku.specText) || '').trim(),
          price: Number((sku && sku.price) || 0),
        }))
        .filter((s) => !!s.skuKey),
    }));

    return { data: mappedList };
  } catch (e) {
    console.error('[shopService.listProducts] error:', e);
    return { data: [] };
  }
}

async function listPoints(openid) {
  try {
    const userRes = await db.collection(COL_USERS).doc(openid).get().catch(() => null);
    const userCodes = listUserRedeemCodes(userRes && userRes.data)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 50);
    return { data: userCodes };
  } catch (e) {
    return { data: [] };
  }
}

async function listGifts() {
  try {
    const byType = await db.collection(COL_SHOP_CONFIG).where({ type: 'points_gift' }).limit(300).get().catch(() => null);
    let docs = Array.isArray(byType && byType.data) ? byType.data : [];
    if (!docs.length) {
      const all = await db.collection(COL_SHOP_CONFIG).limit(500).get().catch(() => null);
      docs = Array.isArray(all && all.data) ? all.data : [];
    }

    const raw = docs.filter((g) => {
      if (!g) return false;
      const type = String(g.type || '').trim();
      if (type && type !== 'points_gift') return false;

      const points = pickPoints(g);
      return points > 0;
    });

    raw.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

    const fileIds = raw.map((g) => g.thumbFileId).filter(Boolean);
    const urlMap = await getTempUrlMap(fileIds);

    const list = raw.map((g) => {
      const inventory = getGiftInventory(g);
      return {
        id: g._id,
        name: String(g.name || g.title || ''),
        points: pickPoints(g),
        desc: String(g.desc || g.description || ''),
        stock: inventory.leftQuantity,
        totalQuantity: inventory.totalQuantity,
        leftQuantity: inventory.leftQuantity,
        imageUrl: urlMap[g.thumbFileId] || String(g.imageUrl || g.thumbUrl || ''),
      };
    });

    return { data: list };
  } catch (e) {
    return { data: [] };
  }
}

async function redeemGift(giftId, openid) {
  const nowTs = now();

  for (let i = 0; i < 5; i++) {
    const code = gen6Code();

    const existsInUsers = await isRedeemCodeExistsInUsers(code).catch(() => false);
    if (existsInUsers) continue;

    try {
      return await db.runTransaction(async (t) => {
        if (!giftId) throw { error: 'invalid_gift' };

        const giftRef = t.collection(COL_SHOP_CONFIG).doc(giftId);
        const giftDoc = await giftRef.get().catch(() => null);
        const g = giftDoc && giftDoc.data;
        if (!g || g.type !== 'points_gift') throw { error: 'gift_offline' };

        const cost = Math.floor(toNum(g.points, 0));
        if (cost <= 0) throw { error: 'gift_offline' };

        const inventory = getGiftInventory(g);
        if (inventory.leftQuantity === 0) throw { error: 'gift_sold_out' };

        const userRef = t.collection(COL_USERS).doc(openid);
        const userDoc = await userRef.get().catch(() => null);
        const u = userDoc && userDoc.data;
        if (!u) throw { error: 'user_not_found' };

        const curPoints = toNum(u.points, 0);
        if (curPoints < cost) throw { error: 'not_enough_points' };

        const userRedeemCodes = Array.isArray(u.redeemCodes) ? u.redeemCodes : [];
        const codeDuplicated = userRedeemCodes.some((item) => {
          const itemCode = String(item && item.code || '').trim();
          const consumedAt = Math.max(0, toInt(item && item.consumedAt, 0));
          return itemCode === code && item && item.consumed !== true && consumedAt <= 0;
        });
        if (codeDuplicated) throw new Error('CODE_EXISTS');

        const nextPoints = Math.max(0, curPoints - cost);
        const redeemRecord = {
          code,
          giftId,
          giftName: g.name || '绉垎鍏戞崲',
          costPoints: cost,
          createdAt: nowTs,
        };

        const userPatch = { points: nextPoints, updatedAt: nowTs };
        if (Array.isArray(u.redeemCodes)) userPatch.redeemCodes = _.push([redeemRecord]);
        else userPatch.redeemCodes = [redeemRecord];
        await userRef.update({ data: userPatch });

        const giftPatch = { redeemedQuantity: _.inc(1), updatedAt: nowTs };
        if (inventory.stockMode) giftPatch.stock = _.inc(-1);
        await giftRef.update({ data: giftPatch });

        return { data: { points: nextPoints, code } };
      });
    } catch (e) {
      if (e && e.message === 'CODE_EXISTS') continue;
      if (e && e.error) return e;
      console.error('redeemGift error', e);
      return { error: 'server_error', message: (e && e.message) || '' };
    }
  }

  return { error: 'system_busy' };
}

async function listAvailableCoupons() {
  try {
    const r = await db.collection(COL_SHOP_CONFIG).where({
      type: 'coupon_template',
      status: 'active'
    }).orderBy('createdAt', 'desc').get();

    const list = (r.data || [])
      .filter((c) => c.claimable !== false)
      .filter((c) => toNum(c.claimedQuantity, 0) < toNum(c.totalQuantity, 0))
      .map((c) => ({
        _id: c._id,
        title: c.title,
        minSpend: c.minSpend,
        discount: c.discount,
        isAvailable: true,
      }));

    return { data: list };
  } catch (e) {
    return { data: [] };
  }
}

module.exports = {
  getShopConfig,
  listCategories,
  listProducts,
  listPoints,
  listGifts,
  redeemGift,
  listAvailableCoupons,
};
