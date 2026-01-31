const cloud = require('wx-server-sdk');
const { COL_SHOP_CONFIG } = require('../config/constants');
const {
  now,
  safeStr,
  toNum,
  toInt,
  isCollectionNotExists
} = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// [新增] 内部辅助：安全删除云文件
async function deleteFileSafe(fileIDs) {
  const ids = (Array.isArray(fileIDs) ? fileIDs : [fileIDs]).filter(id => typeof id === 'string' && id.startsWith('cloud://'));
  if (!ids.length) return;
  try {
    await cloud.deleteFile({ fileList: ids });
  } catch (e) {
    console.error('[deleteFileSafe] error', e);
  }
}

// --- 积分礼品管理 ---
async function listGifts() {
  try {
    const r = await db.collection(COL_SHOP_CONFIG)
      .where({ type: 'points_gift' })
      .limit(300)
      .get();

    const list = (r.data || [])
      .map(g => ({
        id: g._id,
        name: safeStr(g.name),
        points: Math.floor(toNum(g.points, 0)),
        desc: safeStr(g.desc),
        thumbFileId: safeStr(g.thumbFileId),
        enabled: g.enabled !== false,
        stock: Math.floor(toNum(g.stock, 0)),
        sort: Math.floor(toNum(g.sort, 9999)),
        updatedAt: Number(g.updatedAt || 0),
      }))
      .filter(x => x.name && x.points > 0)
      .sort((a, b) =>
        (a.enabled === b.enabled ? 0 : (a.enabled ? -1 : 1)) ||
        (a.sort - b.sort) ||
        (b.updatedAt - a.updatedAt)
      );

    return { ok: true, list };
  } catch (e) {
    if (isCollectionNotExists(e)) return { ok: true, list: [] };
    throw e;
  }
}

async function upsertGift(data, username) {
  const id = safeStr(data.id);
  const name = safeStr(data.name);
  const desc = safeStr(data.desc);
  const points = Math.floor(toNum(data.points, 0));
  const thumbFileId = safeStr(data.thumbFileId);
  
  const stockRaw = data.stock;
  if (stockRaw === undefined || stockRaw === null || stockRaw === '')
    return { ok: false, message: '请填写库存（>=0）' };
  const stock = Math.floor(toNum(stockRaw, -1));
  
  if (!Number.isFinite(stock) || stock < 0) return { ok: false, message: '库存不合法' };
  if (!name) return { ok: false, message: '商品名字不能为空' };
  if (!points || points <= 0) return { ok: false, message: '所需积分不合法' };
  if (desc.length > 200) return { ok: false, message: '描述最多200字' };

  const tNow = now();

  if (id) {
    const ref = db.collection(COL_SHOP_CONFIG).doc(id);
    const got = await ref.get().catch(() => null);
    if (!got || !got.data || got.data.type !== 'points_gift') return { ok: false, message: '商品不存在' };
    
    // 如果替换了图片，需要删除旧图（前端已做，但后端兜底是个好习惯，此处暂略保持前端一致性）

    await ref.update({
      data: {
        name, desc, points, stock,
        ...(thumbFileId ? { thumbFileId } : {}),
        enabled: true,
        updatedAt: tNow,
        updatedBy: username,
      }
    });
    return { ok: true, id };
  }

  const doc = {
    type: 'points_gift',
    enabled: true,
    name, desc, points, stock,
    thumbFileId: thumbFileId || '',
    sort: 0,
    createdAt: tNow,
    updatedAt: tNow,
    createdBy: username,
    updatedBy: username,
  };
  const addRes = await db.collection(COL_SHOP_CONFIG).add({ data: doc });
  return { ok: true, id: addRes._id };
}

// [修改] 完善删除逻辑：先删文件，再删记录
async function disableGift(id) {
  if (!id) return { ok: false, message: '缺少ID' };
  
  try {
    const doc = await db.collection(COL_SHOP_CONFIG).doc(id).get().then(res => res.data).catch(() => null);
    if (doc) {
      // 1. 如果有图片，先删除云文件
      if (doc.thumbFileId) {
        await deleteFileSafe(doc.thumbFileId);
      }
      // 2. 物理删除记录
      await db.collection(COL_SHOP_CONFIG).doc(id).remove();
    }
  } catch (e) {
    console.error('disableGift error', e);
  }
  return { ok: true };
}

// --- 积分核销 ---
async function consumeCode(code) {
  if (!code) return { ok: false, message: '请输入核销码' };
  if (!/^\d{6}$/.test(code)) return { ok: false, message: '核销码必须是6位数字' };

  const docId = `redeem_${code}`;
  try {
    return await db.runTransaction(async (t) => {
      const recRef = t.collection(COL_SHOP_CONFIG).doc(docId);
      const rr = await recRef.get().catch(() => null);
      const rec = rr && rr.data;
      if (!rec || rec.type !== 'redeem_code') return { ok: false, message: '核销码不存在' };

      const giftName = safeStr(rec.giftName);
      const costPoints = Math.floor(toNum(rec.costPoints, 0));

      await recRef.remove(); // 核销即删

      return {
        ok: true,
        data: {
          code,
          giftName,
          costPoints,
          usedAt: now(),
        }
      };
    });
  } catch (e) {
    console.error('consumeCode error', e);
    return { ok: false, message: '核销失败' };
  }
}

// --- 店铺配置 ---
async function getConfig() {
  const docId = 'main';
  const got = await db.collection(COL_SHOP_CONFIG).doc(docId).get().catch(() => null);
  const cfg = (got && got.data) ? got.data : null;

  return {
    ok: true,
    data: {
      storeName: safeStr(cfg && cfg.storeName),
      subMchId: safeStr(cfg && cfg.subMchId),
      storeLat: toNum(cfg && cfg.storeLat, 0),
      storeLng: toNum(cfg && cfg.storeLng, 0),
      
      notice: safeStr(cfg && cfg.notice),
      pointsNotice: safeStr(cfg && cfg.pointsNotice),
      
      banners: Array.isArray(cfg && cfg.banners) ? cfg.banners : [],

      waimaiMaxKm: toNum(cfg && cfg.waimaiMaxKm, 10),
      waimaiDeliveryFee: toNum(cfg && cfg.waimaiDeliveryFee, 8),
      kuaidiOn: cfg ? (cfg.kuaidiOn !== false) : true,
      kuaidiDeliveryFee: toNum(cfg && cfg.kuaidiDeliveryFee, 10),
      minOrderWaimai: toNum(cfg && cfg.minOrderWaimai, 88),
      minOrderKuaidi: toNum(cfg && cfg.minOrderKuaidi, 88),
      
      phone: safeStr(cfg && cfg.phone),
      serviceHours: safeStr(cfg && cfg.serviceHours),
      kefuQrUrl: safeStr(cfg && cfg.kefuQrUrl),
      
      cloudPrinterSn: safeStr(cfg && cfg.cloudPrinterSn),
      cloudPrinterUser: safeStr(cfg && cfg.cloudPrinterUser),
      cloudPrinterKey: safeStr(cfg && cfg.cloudPrinterKey),
      cloudPrinterTimes: toNum(cfg && cfg.cloudPrinterTimes, 1),
    }
  };
}

async function setNotice(notice) {
  if (!notice) return { ok: false, message: '公告不能为空' };
  const docId = 'main';
  const ref = db.collection(COL_SHOP_CONFIG).doc(docId);
  const patch = { notice: safeStr(notice), updatedAt: now() };

  const got = await ref.get().catch(() => null);
  if (got && got.data) {
    await ref.update({ data: patch });
  } else {
    await ref.set({ data: patch });
  }
  return { ok: true };
}

async function setConfig(data) {
  const patch = { updatedAt: now() };
  
  if (data.banners && Array.isArray(data.banners)) {
    patch.banners = data.banners.map(safeStr).filter(Boolean);
  }

  if (data.notice !== undefined) patch.notice = safeStr(data.notice);
  if (data.pointsNotice !== undefined) patch.pointsNotice = safeStr(data.pointsNotice);
  
  if (data.storeName !== undefined) patch.storeName = safeStr(data.storeName);
  if (data.subMchId !== undefined) patch.subMchId = safeStr(data.subMchId);
  if (data.storeLat !== undefined) patch.storeLat = toNum(data.storeLat, 0);
  if (data.storeLng !== undefined) patch.storeLng = toNum(data.storeLng, 0);

  if (data.kuaidiOn !== undefined) patch.kuaidiOn = String(data.kuaidiOn) === 'false' ? false : !!data.kuaidiOn;

  ['waimaiMaxKm', 'waimaiDeliveryFee', 'kuaidiDeliveryFee', 'minOrderWaimai', 'minOrderKuaidi'].forEach(k => {
    if (data[k] !== undefined) patch[k] = toNum(data[k], 0);
  });
  
  ['phone', 'serviceHours', 'kefuQrUrl'].forEach(k => {
    if (data[k] !== undefined) patch[k] = safeStr(data[k]);
  });

  if (data.cloudPrinterSn !== undefined) patch.cloudPrinterSn = safeStr(data.cloudPrinterSn);
  if (data.cloudPrinterUser !== undefined) patch.cloudPrinterUser = safeStr(data.cloudPrinterUser);
  if (data.cloudPrinterKey !== undefined) patch.cloudPrinterKey = safeStr(data.cloudPrinterKey);
  if (data.cloudPrinterTimes !== undefined) patch.cloudPrinterTimes = toNum(data.cloudPrinterTimes, 1);

  const docId = 'main';
  const ref = db.collection(COL_SHOP_CONFIG).doc(docId);
  const got = await ref.get().catch(() => null);
  
  if (got && got.data) await ref.update({ data: patch });
  else await ref.set({ data: patch });
  
  return { ok: true };
}

// --- 优惠券模板管理 ---

async function listCoupons() {
  try {
    const r = await db.collection(COL_SHOP_CONFIG)
      .where({ type: 'coupon_template' })
      .orderBy('createdAt', 'desc')
      .limit(300)
      .get();
    
    const list = (r.data || []).filter(c => c && c.claimable !== false);
    return { ok: true, list };
  } catch (e) {
    if (isCollectionNotExists(e)) return { ok: true, list: [] };
    throw e;
  }
}

async function upsertCoupon(data, username) {
  const { id, title, minSpend, discount, totalQuantity } = data;

  if (!safeStr(title)) return { ok: false, message: '标题不能为空' };
  const nMinSpend = toNum(minSpend, 0);
  const nDiscount = toNum(discount, 0);
  const nTotalQuantity = toInt(totalQuantity, 0);

  if (nMinSpend < 0 || nDiscount <= 0 || nTotalQuantity <= 0) {
    return { ok: false, message: '金额或数量不合法' };
  }
  if (nMinSpend > 0 && nDiscount > nMinSpend) {
    return { ok: false, message: '减免金额不能大于最低消费' };
  }

  const tNow = now();

  if (id) {
    const ref = db.collection(COL_SHOP_CONFIG).doc(id);
    const got = await ref.get().catch(() => null);
    if (!got || !got.data || got.data.type !== 'coupon_template') {
      return { ok: false, message: '优惠券不存在或类型错误' };
    }
    if (got.data.claimable === false) {
      return { ok: false, message: '会员模板优惠券不可编辑' };
    }

    const patchData = {
      title: safeStr(title),
      minSpend: nMinSpend,
      discount: nDiscount,
      totalQuantity: nTotalQuantity,
      updatedAt: tNow,
      updatedBy: username,
    };
    await ref.update({ data: patchData });
    return { ok: true, id };

  } else {
    const fullDoc = {
      type: 'coupon_template',
      title: safeStr(title),
      minSpend: nMinSpend,
      discount: nDiscount,
      totalQuantity: nTotalQuantity,
      claimedQuantity: 0,
      status: 'active',
      createdAt: tNow,
      updatedAt: tNow,
      createdBy: username,
      updatedBy: username,
    };
    const addRes = await db.collection(COL_SHOP_CONFIG).add({ data: fullDoc });
    return { ok: true, id: addRes._id };
  }
}

async function toggleCouponStatus(id, newStatus, username) {
  if (!id) return { ok: false, message: '缺少ID' };
  const status = newStatus ? 'active' : 'inactive';
  const got = await db.collection(COL_SHOP_CONFIG).doc(id).get().catch(() => null);
  if (!got || !got.data || got.data.type !== 'coupon_template') return { ok: false, message: '优惠券不存在或类型错误' };
  if (got.data.claimable === false) return { ok: false, message: '会员模板优惠券不可操作' };
  
  await db.collection(COL_SHOP_CONFIG).doc(id).update({
    data: {
      status,
      updatedAt: now(),
      updatedBy: username,
    }
  });
  return { ok: true };
}

module.exports = {
  listGifts,
  upsertGift,
  disableGift,
  consumeCode,
  getConfig,
  setNotice,
  setConfig,
  listCoupons,
  upsertCoupon,
  toggleCouponStatus,
};