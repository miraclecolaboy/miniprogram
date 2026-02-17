const cloud = require('wx-server-sdk');
const { COL_USERS, COL_ORDERS } = require('../config/constants');
const { now, isCollectionNotExists } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

async function _listAddresses(openid, limit = 50) {
  let gotU = null;
  try {
    gotU = await db.collection(COL_USERS).doc(openid).get();
  } catch (e) {
    return [];
  }

  const u = gotU?.data || {};
  const defaultId = String(u.defaultAddressId || '').trim();

  let list = Array.isArray(u.addresses) ? u.addresses : [];
  list = list
    .filter(x => x && typeof x === 'object')
    .map(x => {
      const id = String(x.id || x._id || '').trim();
      const region = String(x.region || '').trim();
      const detail = String(x.detail || '').trim();
      const addressText = String(x.address || '').trim() || (region && detail ? `${region} ${detail}` : (region || detail));
      const lat = Number(x.lat ?? x.latitude);
      const lng = Number(x.lng ?? x.longitude);
      const hasLL = Number.isFinite(lat) && Number.isFinite(lng);

      return {
        id,
        name: String(x.name || '').trim(),
        phone: String(x.phone || '').trim(),
        address: addressText,
        ...(hasLL ? { lat, lng } : {}),
        createdAt: Number(x.createdAt || 0),
        updatedAt: Number(x.updatedAt || 0),
        isDefault: defaultId ? (id === defaultId) : !!x.isDefault,
      };
    })
    .filter(x => !!x.id);

  list.sort((a, b) => {
    const d = Number(!!b.isDefault) - Number(!!a.isDefault);
    if (d !== 0) return d;
    return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
  });

  return list.slice(0, limit);
}

async function getOrderStats(openid) {
  try {
    const countRes = await db.collection(COL_ORDERS).where({ openid }).count();
    const count = Number(countRes.total || 0);
    const lastRes = await db.collection(COL_ORDERS).where({ openid }).orderBy('createdAt', 'desc').limit(1).get();
    const last = (lastRes.data && lastRes.data[0]) || null;
    return {
      count,
      lastOrderAt: last ? Number(last.createdAt || 0) : 0,
      lastOrderId: last ? String(last._id || '') : '',
    };
  } catch (e) {
    return { count: 0, lastOrderAt: 0, lastOrderId: '' };
  }
}

function normalizeMemberCouponTitle(title) {
  const t = String(title || '').trim();
  if (!t) return '';
  return t.replace(/^等级会员无门槛/, '会员无门槛');
}

function normalizeUserCoupons(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const couponId = String(c.couponId || '').trim();
    const title = String(c.title || '').trim();
    if (couponId.startsWith('coupon_member_') && title.startsWith('等级会员无门槛')) {
      return { ...c, title: normalizeMemberCouponTitle(title) };
    }
    return c;
  });
}

function normalizeReservePhone(v) {
  return String(v == null ? '' : v).replace(/\D+/g, '').slice(0, 11);
}

async function ensureUser(openid, profile = null) {
  try {
    const got = await db.collection(COL_USERS).doc(openid).get();
    const u = got.data || {};
    const patch = { openid, lastLoginAt: now(), updatedAt: now() };
    
    await db.collection(COL_USERS).doc(openid).update({ data: patch });
    return { ...u, ...patch, _id: openid };

  } catch (e) {
    if (isCollectionNotExists(e)) throw e;

    const randomSuffix = Math.random().toString().slice(-6);
    const defaultNickName = `用户${randomSuffix}`;
    
    const user = {
      openid,
      nickName: defaultNickName,
      avatarUrl: '',
      gender: 0,
      balance: 0,
      points: 0,
      memberLevel: 0,
      totalRecharge: 0,
      reservePhone: '',
      defaultAddressId: '',
      addresses: [],
      coupons: [],
      orderStats: { count: 0, lastOrderAt: 0, lastOrderId: '' },
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: now(),
    };

    await db.collection(COL_USERS).doc(openid).set({ data: user });
    return { ...user, _id: openid };
  }
}

async function loginOrRegister(event, openid) {
  const src = (event && event.userInfo) || event || {};
  const { nickName, avatarUrl, gender } = src;
  
  const hasNick = nickName && nickName !== '微信用户';
  const hasAvatar = avatarUrl && !avatarUrl.includes('icTdbqWNOwNR');
  const hasGender = typeof gender === 'number';

  const profile = (hasNick || hasAvatar || hasGender) ? { nickName, avatarUrl, gender } : null;
  const user = await ensureUser(openid, profile);
  return { data: user };
}

async function getMe(openid) {
  let me;
  try {
    const got = await db.collection(COL_USERS).doc(openid).get();
    me = got.data;
  } catch (e) {
    if (isCollectionNotExists(e)) return { error: 'collection_not_exists', collection: 'users' };
    return { error: 'not_found' };
  }

  const addresses = await _listAddresses(openid);
  const orderStats = await getOrderStats(openid);
  const coupons = normalizeUserCoupons(me && me.coupons);

  db.collection(COL_USERS).doc(openid).update({ data: { orderStats, updatedAt: now() } }).catch(() => {});

  return { data: { ...me, coupons, _id: openid, addresses, orderStats } };
}

async function updateProfile(event, openid) {
  await ensureUser(openid, null);
  
  let oldAvatar = '';
  try {
    const old = await db.collection(COL_USERS).doc(openid).get();
    oldAvatar = old.data?.avatarUrl || '';
  } catch (_) {}

  const patch = { updatedAt: now() };
  if (event.nickName) patch.nickName = String(event.nickName).trim();
  if (event.avatarUrl) patch.avatarUrl = String(event.avatarUrl).trim();
  if (typeof event.gender === 'number') patch.gender = event.gender;
  if (Object.prototype.hasOwnProperty.call(event || {}, 'reservePhone')) {
    patch.reservePhone = normalizeReservePhone(event.reservePhone);
  }

  await db.collection(COL_USERS).doc(openid).update({ data: patch });

  if (oldAvatar && patch.avatarUrl && oldAvatar !== patch.avatarUrl && oldAvatar.startsWith('cloud://')) {
    cloud.deleteFile({ fileList: [oldAvatar] }).catch(() => {});
  }

  return await getMe(openid);
}

async function listAddresses(openid) {
  const list = await _listAddresses(openid);
  return { data: list };
}

function genAddrId() {
  return `a_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function upsertAddress(event, openid) {
  await ensureUser(openid, null);
  const addr = event.address || {};
  let id = String(addr.id || addr._id || '').trim();
  if (!id) id = genAddrId();

  const users = db.collection(COL_USERS);
  const ref = users.doc(openid);
  const gotU = await ref.get().catch(() => null);
  const u = gotU?.data || {};

  let addresses = Array.isArray(u.addresses) ? u.addresses : [];
  let defaultId = String(u.defaultAddressId || '').trim();
  const tNow = now();

  const lat = Number(addr.lat ?? addr.latitude ?? addr.location?.lat);
  const lng = Number(addr.lng ?? addr.longitude ?? addr.location?.lng);
  const hasLL = Number.isFinite(lat) && Number.isFinite(lng);

  const nextItem = {
    id, 
    name: String(addr.name || '').trim(), 
    phone: String(addr.phone || '').trim(),
    address: String(addr.address || '').trim(),
    ...(hasLL ? { lat, lng } : {}),
    createdAt: tNow, 
    updatedAt: tNow
  };

  const idx = addresses.findIndex(x => String(x.id || x._id) === id);
  if (idx >= 0) {
    nextItem.createdAt = addresses[idx].createdAt || tNow;
    const oldItem = addresses[idx] || {};
    const { region: _region, detail: _detail, baseAddress: _baseAddress, poiAddress: _poiAddress, ...rest } = oldItem;
    void _region;
    void _detail;
    void _baseAddress;
    void _poiAddress;
    addresses[idx] = { ...rest, ...nextItem };
  } else {
    addresses.unshift(nextItem);
  }

  if (addr.isDefault || !defaultId) defaultId = id;

  addresses.sort((a, b) => {
    const isDefA = String(a.id) === defaultId;
    const isDefB = String(b.id) === defaultId;
    return (isDefB - isDefA) || (b.updatedAt - a.updatedAt);
  });
  if (addresses.length > 50) addresses = addresses.slice(0, 50);

  await ref.update({
    data: { addresses, defaultAddressId: defaultId, updatedAt: tNow }
  });

  return { data: { ...nextItem, isDefault: String(id) === defaultId } };
}

async function deleteAddress(event, openid) {
  await ensureUser(openid, null);
  const id = String(event.id || '').trim();
  if (!id) return { error: 'invalid_id' };

  const ref = db.collection(COL_USERS).doc(openid);
  const gotU = await ref.get().catch(() => null);
  const u = gotU?.data || {};

  let addresses = (u.addresses || []).filter(x => String(x.id || x._id) !== id);
  let defaultId = u.defaultAddressId;

  if (defaultId === id) {
    addresses.sort((a, b) => b.updatedAt - a.updatedAt);
    defaultId = addresses[0] ? String(addresses[0].id || addresses[0]._id) : '';
  }

  await ref.update({
    data: { addresses, defaultAddressId: defaultId, updatedAt: now() }
  });

  return { data: true };
}

module.exports = {
  ensureUser,
  loginOrRegister,
  getMe,
  updateProfile,
  listAddresses,
  upsertAddress,
  deleteAddress
};
