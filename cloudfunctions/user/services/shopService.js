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
  getTempUrlMap,
  gen6Code
} = require('../utils/common');
const { ensureMemberLevelDefaults } = require('./memberLevelDefaults');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

async function getShopConfig() {
  const DEFAULT_CFG = { 
    storeName: '', 
    storeAddress: '',
    storeLat: 0, 
    storeLng: 0, 
    notice: '', 
    kuaidiOn: true, 
    waimaiMaxKm: 10, 
    minOrderZiti: 0, 
    minOrderWaimai: 88, 
    minOrderKuaidi: 100, 
    waimaiDeliveryFee: 8, 
    kuaidiDeliveryFee: 10, 
    updatedAt: now(),
    banners: [] // 默认空轮播图
  };

  try {
    // 确保默认会员等级和优惠券存在 (幂等操作)
    await ensureMemberLevelDefaults(db, now()).catch(() => {});

    const got = await db.collection(COL_SHOP_CONFIG).doc('main').get().catch(() => null);
    const cfg = got?.data || {};
    const out = { ...DEFAULT_CFG, ...cfg };
    
    // 数值字段安全转换
    ['waimaiMaxKm', 'waimaiDeliveryFee', 'kuaidiDeliveryFee', 'minOrderZiti', 'minOrderWaimai', 'minOrderKuaidi', 'storeLat', 'storeLng'].forEach(k => {
      const n = Number(out[k]);
      out[k] = Number.isFinite(n) ? n : DEFAULT_CFG[k];
    });

    out.kuaidiOn = out.kuaidiOn !== false;
    
    // [新增] 确保 banners 是数组，供前端首页使用
    out.banners = Array.isArray(out.banners) ? out.banners : [];

    delete out.subMchId; // 隐藏敏感信息
    return { data: out };
  } catch (e) {
    if (isCollectionNotExists(e)) return { data: DEFAULT_CFG };
    return { error: 'server_error', message: e.message || '' };
  }
}

async function listCategories() {
  try {
    const r = await db.collection(COL_CATEGORIES).orderBy('sort', 'asc').limit(200).get();
    return { data: (r.data || []).map(x => ({ id: x._id, name: x.name, sort: Number(x.sort || 0) })) };
  } catch (e) { return { data: [] }; }
}

async function listProducts() {
    try {
      const r = await db.collection(COL_PRODUCTS).where({ status: 1 }).field({ _id: 1, name: 1, desc: 1, detail: 1, imgs: 1, thumbFileID: 1, categoryId: 1, price: 1, modes: 1, hasSpecs: 1, specs: 1, skuList: 1, sort: 1 }).limit(1000).get();
      let list = (r.data || []);
      list.sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const thumbFileIds = list.map(p => p.thumbFileID).filter(Boolean);
      const urlMap = await getTempUrlMap([...new Set(thumbFileIds)]);
      const mappedList = list.map(p => ({
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
        skuList: (Array.isArray(p.skuList) ? p.skuList : []).map(sku => ({
          skuKey: String(sku?.skuKey || sku?._id || '').trim(),
          specText: String(sku?.specText || '').trim(),
          price: Number(sku?.price || 0),
        })).filter(s => !!s.skuKey),
      }));
      return { data: mappedList };
    } catch (e) { console.error('[shopService.listProducts] error:', e); return { data: [] }; }
}

async function listPoints(openid) {
    try {
      const r = await db.collection(COL_SHOP_CONFIG).where({ type: 'redeem_code', openid }).orderBy('createdAt', 'desc').limit(50).get();
      return { data: (r.data || []).map(x => ({ code: x.code, giftName: x.giftName, costPoints: Math.floor(toNum(x.costPoints, 0)), createdAt: x.createdAt })) };
    } catch (e) { return { data: [] }; }
}

async function listGifts() {
    try {
      const r = await db.collection(COL_SHOP_CONFIG).where({ type: 'points_gift' }).limit(200).get();
      const raw = (r.data || []).filter(g => g.enabled !== false && Number(g.points) > 0);
      raw.sort((a, b) => (Number(a.sort || 999) - Number(b.sort || 999)) || (b.updatedAt - a.updatedAt));
      const fileIds = raw.map(g => g.thumbFileId).filter(Boolean);
      const urlMap = await getTempUrlMap(fileIds);
      const list = raw.map(g => ({ id: g._id, name: g.name, points: Math.floor(toNum(g.points, 0)), desc: g.desc, imageUrl: urlMap[g.thumbFileId] || '' }));
      return { data: list };
    } catch (e) { return { data: [] }; }
}

async function redeemGift(giftId, openid) {
    const nowTs = now();
    for (let i = 0; i < 5; i++) {
      const code = gen6Code();
      const docId = `redeem_${code}`;
      try {
        return await db.runTransaction(async (t) => {
          if (!giftId) throw { error: 'invalid_gift' };
          const giftRef = t.collection(COL_SHOP_CONFIG).doc(giftId);
          const g = (await giftRef.get()).data;
          if (!g || g.type !== 'points_gift' || g.enabled === false) throw { error: 'gift_offline' };
          const cost = Math.floor(toNum(g.points, 0));
          if (cost <= 0) throw { error: 'gift_offline' };
          const userRef = t.collection(COL_USERS).doc(openid);
          const u = (await userRef.get()).data;
          if (!u) throw { error: 'user_not_found' };
          const curPoints = toNum(u.points, 0);
          if (curPoints < cost) throw { error: 'not_enough_points' };
          const recRef = t.collection(COL_SHOP_CONFIG).doc(docId);
          const exists = await recRef.get().catch(() => null);
          if (exists && exists.data) throw new Error('CODE_EXISTS');
          const nextPoints = Math.max(0, curPoints - cost);
          await userRef.update({ data: { points: nextPoints, updatedAt: nowTs } });
          await recRef.set({ data: { type: 'redeem_code', code, openid, giftId, giftName: g.name || '积分兑换', costPoints: cost, createdAt: nowTs } });
          return { data: { points: nextPoints, code } };
        });
      } catch (e) {
        if (e.message === 'CODE_EXISTS') continue;
        if (e.error) return e; 
        console.error('redeemGift error', e);
        return { error: 'server_error', message: e.message || '' };
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
      .filter(c => c.claimable !== false) // hide member-upgrade gift coupons by default
      .filter(c => toNum(c.claimedQuantity, 0) < toNum(c.totalQuantity, 0))
      .map(c => ({
        _id: c._id,
        title: c.title,
        minSpend: c.minSpend,
        discount: c.discount,
        isAvailable: true 
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
