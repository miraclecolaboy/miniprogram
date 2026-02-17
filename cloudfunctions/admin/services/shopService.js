const cloud = require('wx-server-sdk');
const { COL_SHOP_CONFIG, COL_CUSTOMERS } = require('../config/constants');
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

async function deleteFileSafe(fileIDs) {
  const ids = (Array.isArray(fileIDs) ? fileIDs : [fileIDs])
    .filter((id) => typeof id === 'string' && id.startsWith('cloud://'));
  if (!ids.length) return;

  try {
    await cloud.deleteFile({ fileList: ids });
  } catch (e) {
    console.error('[deleteFileSafe] error', e);
  }
}

function hasValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function getGiftInventory(g) {
  const redeemedQuantity = Math.max(0, toInt(g && g.redeemedQuantity, 0));

  if (hasValue(g && g.totalQuantity)) {
    const totalQuantity = Math.max(0, toInt(g.totalQuantity, 0));
    const leftQuantity = totalQuantity > 0
      ? Math.max(0, totalQuantity - Math.min(totalQuantity, redeemedQuantity))
      : -1;
    return { totalQuantity, redeemedQuantity, leftQuantity, stockMode: false };
  }

  if (hasValue(g && g.stock)) {
    const leftQuantity = Math.max(0, toInt(g.stock, 0));
    const totalQuantity = leftQuantity + redeemedQuantity;
    return { totalQuantity, redeemedQuantity, leftQuantity, stockMode: true };
  }

  return { totalQuantity: 0, redeemedQuantity, leftQuantity: -1, stockMode: false };
}

function pickUserRedeemCode(userDoc, code) {
  const codeText = safeStr(code);
  const list = Array.isArray(userDoc && userDoc.redeemCodes) ? userDoc.redeemCodes : [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const itemCode = safeStr(item && item.code);
    const consumedAt = Math.max(0, toInt(item && item.consumedAt, 0));
    if (itemCode === codeText && item && item.consumed !== true && consumedAt <= 0) {
      return { index: i, record: item };
    }
  }
  return null;
}

async function findRedeemCodeOwner(code) {
  const codeText = safeStr(code);
  if (!/^\d{6}$/.test(codeText)) return null;

  try {
    const quick = await db.collection(COL_CUSTOMERS)
      .where({ redeemCodes: _.elemMatch({ code: codeText }) })
      .field({ _id: true, redeemCodes: true })
      .limit(5)
      .get();

    const quickList = Array.isArray(quick && quick.data) ? quick.data : [];
    for (const user of quickList) {
      const hit = pickUserRedeemCode(user, codeText);
      if (hit) return { openid: safeStr(user && user._id), ...hit };
    }
  } catch (_) {
  }

  let skip = 0;
  const pageSize = 100;
  const maxScan = 10000;
  while (skip < maxScan) {
    const page = await db.collection(COL_CUSTOMERS)
      .field({ _id: true, redeemCodes: true })
      .skip(skip)
      .limit(pageSize)
      .get()
      .catch(() => null);

    const batch = Array.isArray(page && page.data) ? page.data : [];
    if (!batch.length) break;

    for (const user of batch) {
      const hit = pickUserRedeemCode(user, codeText);
      if (hit) return { openid: safeStr(user && user._id), ...hit };
    }

    if (batch.length < pageSize) break;
    skip += batch.length;
  }

  return null;
}

async function listGifts() {
  try {
    const r = await db.collection(COL_SHOP_CONFIG)
      .where({ type: 'points_gift' })
      .limit(300)
      .get();

    const list = (r.data || [])
      .map((g) => {
        const inventory = getGiftInventory(g);
        return {
          id: g._id,
          name: safeStr(g.name),
          points: Math.floor(toNum(g.points, 0)),
          totalQuantity: inventory.totalQuantity,
          redeemedQuantity: inventory.redeemedQuantity,
          leftQuantity: inventory.leftQuantity,
          desc: safeStr(g.desc),
          thumbFileId: safeStr(g.thumbFileId),
          updatedAt: Number(g.updatedAt || 0),
        };
      })
      .filter((x) => x.name && x.points > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return { ok: true, list };
  } catch (e) {
    if (isCollectionNotExists(e)) return { ok: true, list: [] };
    throw e;
  }
}

async function upsertGift(data) {
  const id = safeStr(data.id);
  const name = safeStr(data.name);
  const desc = safeStr(data.desc);
  const points = Math.floor(toNum(data.points, 0));
  const totalQuantity = Math.floor(toNum(data.totalQuantity, 0));
  const thumbFileId = safeStr(data.thumbFileId);

  if (!name) return { ok: false, message: 'gift name is required' };
  if (!points || points <= 0) return { ok: false, message: 'invalid points' };
  if (!totalQuantity || totalQuantity <= 0) return { ok: false, message: 'quantity must be > 0' };
  if (desc.length > 20) return { ok: false, message: 'desc max 20 chars' };

  const tNow = now();

  if (id) {
    const ref = db.collection(COL_SHOP_CONFIG).doc(id);
    const got = await ref.get().catch(() => null);
    if (!got || !got.data || got.data.type !== 'points_gift') return { ok: false, message: 'gift not found' };

    const inventory = getGiftInventory(got.data);
    const redeemedQuantity = inventory.redeemedQuantity;
    if (totalQuantity < redeemedQuantity) return { ok: false, message: 'quantity < redeemed' };
    const stock = Math.max(0, totalQuantity - redeemedQuantity);

    const oldThumbFileId = safeStr(got.data.thumbFileId);
    const nextThumbFileId = thumbFileId || oldThumbFileId;
    const patch = {
      name,
      desc,
      points,
      redeemedQuantity,
      stock,
      totalQuantity: _.remove(),
      thumbFileId: nextThumbFileId,
      updatedAt: tNow,
    };

    await ref.update({ data: patch });

    if (oldThumbFileId && nextThumbFileId && oldThumbFileId !== nextThumbFileId) {
      await deleteFileSafe(oldThumbFileId);
    }
    return { ok: true, id };
  }

  const doc = {
    type: 'points_gift',
    name,
    desc,
    points,
    stock: totalQuantity,
    redeemedQuantity: 0,
    thumbFileId: thumbFileId || '',
    createdAt: tNow,
    updatedAt: tNow,
  };
  const addRes = await db.collection(COL_SHOP_CONFIG).add({ data: doc });
  return { ok: true, id: addRes._id };
}

async function disableGift(id) {
  if (!id) return { ok: false, message: 'missing id' };

  try {
    const doc = await db.collection(COL_SHOP_CONFIG).doc(id).get().then((res) => res.data).catch(() => null);
    if (doc) {
      if (doc.thumbFileId) {
        await deleteFileSafe(doc.thumbFileId);
      }
      await db.collection(COL_SHOP_CONFIG).doc(id).remove();
    }
  } catch (e) {
    console.error('disableGift error', e);
  }
  return { ok: true };
}

async function consumeCode(code) {
  const codeText = safeStr(code);
  if (!codeText) return { ok: false, message: 'code is required' };
  if (!/^\d{6}$/.test(codeText)) return { ok: false, message: 'code must be 6 digits' };

  try {
    const owner = await findRedeemCodeOwner(codeText);
    if (!owner || !owner.openid) return { ok: false, message: 'code not found' };

    return await db.runTransaction(async (t) => {
      const userRef = t.collection(COL_CUSTOMERS).doc(owner.openid);
      const userDoc = await userRef.get().catch(() => null);
      const user = userDoc && userDoc.data;
      if (!user) return { ok: false, message: 'code not found' };

      const hit = pickUserRedeemCode(user, codeText);
      if (!hit) return { ok: false, message: 'code not found' };

      const oldList = Array.isArray(user.redeemCodes) ? user.redeemCodes : [];
      const nextList = oldList.filter((_, idx) => idx !== hit.index);
      const nextRedeemCodes = nextList.length ? nextList : _.remove();
      await userRef.update({
        data: {
          redeemCodes: nextRedeemCodes,
          updatedAt: now(),
        }
      });

      return {
        ok: true,
        data: {
          code: codeText,
          giftName: safeStr(hit.record && hit.record.giftName),
          costPoints: Math.floor(toNum(hit.record && hit.record.costPoints, 0)),
          usedAt: now(),
        }
      };
    });
  } catch (e) {
    console.error('consumeCode error', e);
    return { ok: false, message: 'consume failed' };
  }
}

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
      waimaiOn: cfg ? (cfg.waimaiOn !== false) : true,
      kuaidiOn: cfg ? (cfg.kuaidiOn !== false) : true,
      kuaidiDeliveryFee: toNum(cfg && cfg.kuaidiDeliveryFee, 10),
      kuaidiOutProvinceDistanceKm: toNum(cfg && cfg.kuaidiOutProvinceDistanceKm, 300),
      kuaidiOutDeliveryFee: toNum(cfg && cfg.kuaidiOutDeliveryFee, 25),
      minOrderWaimai: toNum(cfg && cfg.minOrderWaimai, 88),
      minOrderKuaidi: toNum(cfg && cfg.minOrderKuaidi, 100),
      minOrderKuaidiOut: toNum(cfg && cfg.minOrderKuaidiOut, 140),
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
  const noticeText = safeStr(notice);
  if (!noticeText) return { ok: false, message: 'notice is required' };
  if (noticeText.length > 20) return { ok: false, message: 'notice max 20 chars' };

  const docId = 'main';
  const ref = db.collection(COL_SHOP_CONFIG).doc(docId);
  const got = await ref.get().catch(() => null);
  const cfg = got && got.data ? got.data : null;

  const patch = { notice: noticeText, updatedAt: now() };
  if (!cfg || cfg.storeAddress === undefined) patch.storeAddress = '';

  if (cfg) await ref.update({ data: patch });
  else await ref.set({ data: patch });
  return { ok: true };
}

async function setConfig(data) {
  const patch = { updatedAt: now() };

  if (data.banners && Array.isArray(data.banners)) {
    patch.banners = data.banners.map(safeStr).filter(Boolean);
  }

  if (data.notice !== undefined) {
    const notice = safeStr(data.notice);
    if (notice.length > 20) return { ok: false, message: 'notice max 20 chars' };
    patch.notice = notice;
  }
  if (data.pointsNotice !== undefined) patch.pointsNotice = safeStr(data.pointsNotice);

  if (data.storeName !== undefined) patch.storeName = safeStr(data.storeName);
  if (data.subMchId !== undefined) patch.subMchId = safeStr(data.subMchId);
  if (data.storeLat !== undefined) patch.storeLat = toNum(data.storeLat, 0);
  if (data.storeLng !== undefined) patch.storeLng = toNum(data.storeLng, 0);

  if (data.waimaiOn !== undefined) patch.waimaiOn = String(data.waimaiOn) === 'false' ? false : !!data.waimaiOn;
  if (data.kuaidiOn !== undefined) patch.kuaidiOn = String(data.kuaidiOn) === 'false' ? false : !!data.kuaidiOn;

  ['waimaiMaxKm', 'waimaiDeliveryFee', 'kuaidiDeliveryFee', 'kuaidiOutProvinceDistanceKm', 'kuaidiOutDeliveryFee', 'minOrderWaimai', 'minOrderKuaidi', 'minOrderKuaidiOut'].forEach((k) => {
    if (data[k] !== undefined) patch[k] = toNum(data[k], 0);
  });

  if (data.phone !== undefined) patch.phone = safeStr(data.phone);
  if (data.serviceHours !== undefined) {
    const serviceHours = safeStr(data.serviceHours);
    if (!serviceHours) {
      patch.serviceHours = '';
    } else {
      const ranges = serviceHours
        .split(/[;,\uFF0C\uFF1B]/)
        .map((s) => safeStr(s).trim())
        .filter(Boolean);
      if (ranges.length > 2) return { ok: false, message: 'max 2 service time ranges' };
      patch.serviceHours = ranges.join(';');
    }
  }
  if (data.kefuQrUrl !== undefined) patch.kefuQrUrl = safeStr(data.kefuQrUrl);

  if (data.cloudPrinterSn !== undefined) patch.cloudPrinterSn = safeStr(data.cloudPrinterSn);
  if (data.cloudPrinterUser !== undefined) patch.cloudPrinterUser = safeStr(data.cloudPrinterUser);
  if (data.cloudPrinterKey !== undefined) patch.cloudPrinterKey = safeStr(data.cloudPrinterKey);
  if (data.cloudPrinterTimes !== undefined) patch.cloudPrinterTimes = toNum(data.cloudPrinterTimes, 1);

  const docId = 'main';
  const ref = db.collection(COL_SHOP_CONFIG).doc(docId);
  const got = await ref.get().catch(() => null);

  const oldCfg = got && got.data ? got.data : {};
  if (got && got.data) await ref.update({ data: patch });
  else await ref.set({ data: patch });

  if (Array.isArray(data.banners)) {
    const oldBanners = Array.isArray(oldCfg.banners) ? oldCfg.banners.map(safeStr).filter(Boolean) : [];
    const newBanners = patch.banners || [];
    const removedBannerIds = oldBanners.filter((id) => !newBanners.includes(id));
    if (removedBannerIds.length) await deleteFileSafe(removedBannerIds);
  }

  if (data.kefuQrUrl !== undefined) {
    const oldKefuQr = safeStr(oldCfg.kefuQrUrl);
    const newKefuQr = safeStr(patch.kefuQrUrl);
    if (oldKefuQr && oldKefuQr !== newKefuQr) await deleteFileSafe(oldKefuQr);
  }

  return { ok: true };
}

async function listCoupons() {
  try {
    const r = await db.collection(COL_SHOP_CONFIG)
      .where({ type: 'coupon_template' })
      .orderBy('createdAt', 'desc')
      .limit(300)
      .get();

    const list = (r.data || []).filter((c) => c && c.claimable !== false);
    return { ok: true, list };
  } catch (e) {
    if (isCollectionNotExists(e)) return { ok: true, list: [] };
    throw e;
  }
}

async function upsertCoupon(data) {
  const { id, title, minSpend, discount, totalQuantity } = data;

  if (!safeStr(title)) return { ok: false, message: 'title is required' };
  const nMinSpend = toNum(minSpend, 0);
  const nDiscount = toNum(discount, 0);
  const nTotalQuantity = toInt(totalQuantity, 0);

  if (nMinSpend < 0 || nDiscount <= 0 || nTotalQuantity <= 0) {
    return { ok: false, message: 'invalid amount or quantity' };
  }
  if (nMinSpend > 0 && nDiscount > nMinSpend) {
    return { ok: false, message: 'discount cannot exceed minSpend' };
  }

  const tNow = now();

  if (id) {
    const ref = db.collection(COL_SHOP_CONFIG).doc(id);
    const got = await ref.get().catch(() => null);
    if (!got || !got.data || got.data.type !== 'coupon_template') {
      return { ok: false, message: 'coupon not found or type mismatch' };
    }
    if (got.data.claimable === false) {
      return { ok: false, message: 'member coupon template cannot be edited' };
    }

    const patchData = {
      title: safeStr(title),
      minSpend: nMinSpend,
      discount: nDiscount,
      totalQuantity: nTotalQuantity,
      updatedAt: tNow,
    };
    await ref.update({ data: patchData });
    return { ok: true, id };
  }

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
  };
  const addRes = await db.collection(COL_SHOP_CONFIG).add({ data: fullDoc });
  return { ok: true, id: addRes._id };
}

async function deleteCoupon(id) {
  if (!id) return { ok: false, message: 'missing id' };

  const ref = db.collection(COL_SHOP_CONFIG).doc(id);
  const got = await ref.get().catch(() => null);
  if (!got || !got.data || got.data.type !== 'coupon_template') {
    return { ok: false, message: 'coupon not found or type mismatch' };
  }
  if (got.data.claimable === false) {
    return { ok: false, message: 'member coupon template cannot be deleted' };
  }

  await ref.remove();
  return { ok: true };
}

async function toggleCouponStatus(id, newStatus) {
  if (!id) return { ok: false, message: 'missing id' };

  const status = newStatus ? 'active' : 'inactive';
  const got = await db.collection(COL_SHOP_CONFIG).doc(id).get().catch(() => null);
  if (!got || !got.data || got.data.type !== 'coupon_template') {
    return { ok: false, message: 'coupon not found or type mismatch' };
  }
  if (got.data.claimable === false) {
    return { ok: false, message: 'member coupon template cannot be changed' };
  }

  await db.collection(COL_SHOP_CONFIG).doc(id).update({
    data: {
      status,
      updatedAt: now(),
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
  deleteCoupon,
};
