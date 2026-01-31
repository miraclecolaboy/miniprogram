const cloud = require('wx-server-sdk');
const { COL_USERS, COL_ORDERS } = require('../config/constants');
const { now, isCollectionNotExists } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// --- 内部辅助 ---

// 格式化地址列表
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
        region,
        detail,
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

// 统计订单数据
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

// 确保用户存在 (核心登录逻辑)
async function ensureUser(openid, profile = null) {
  try {
    // 尝试获取用户
    const got = await db.collection(COL_USERS).doc(openid).get();
    const u = got.data || {};
    const patch = { openid, lastLoginAt: now(), updatedAt: now() };
    
    // [重构] 登录时不再依赖前端传来的微信信息，只更新登录时间
    await db.collection(COL_USERS).doc(openid).update({ data: patch });
    return { ...u, ...patch, _id: openid };

  } catch (e) {
    if (isCollectionNotExists(e)) throw e; // 如果是其他错误，则抛出

    // [重构] 捕获 "document not exists" 错误，说明是新用户，执行创建
    // 1. 生成随机昵称
    const randomSuffix = Math.random().toString().slice(-6);
    const defaultNickName = `用户${randomSuffix}`;
    
    // 2. 创建新用户文档
    const user = {
      openid,
      nickName: defaultNickName,
      avatarUrl: '', // 头像默认为空
      gender: 0,
      balance: 0,
      points: 0,
      // Level-based membership (cumulative recharge). Lv4 gets permanent discount.
      memberLevel: 0,
      totalRecharge: 0,
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

// --- 导出接口 ---

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

  // 异步更新统计信息，不阻塞返回
  db.collection(COL_USERS).doc(openid).update({ data: { orderStats, updatedAt: now() } }).catch(() => {});

  return { data: { ...me, _id: openid, addresses, orderStats } };
}

async function updateProfile(event, openid) {
  await ensureUser(openid, null);
  
  // 获取旧头像以便清理
  let oldAvatar = '';
  try {
    const old = await db.collection(COL_USERS).doc(openid).get();
    oldAvatar = old.data?.avatarUrl || '';
  } catch (_) {}

  const patch = { updatedAt: now() };
  if (event.nickName) patch.nickName = String(event.nickName).trim();
  if (event.avatarUrl) patch.avatarUrl = String(event.avatarUrl).trim();
  if (typeof event.gender === 'number') patch.gender = event.gender;

  await db.collection(COL_USERS).doc(openid).update({ data: patch });

  // 清理旧头像文件
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

  // 构建新地址对象
  const lat = Number(addr.lat ?? addr.latitude ?? addr.location?.lat);
  const lng = Number(addr.lng ?? addr.longitude ?? addr.location?.lng);
  const hasLL = Number.isFinite(lat) && Number.isFinite(lng);

  const nextItem = {
    id, 
    name: String(addr.name || '').trim(), 
    phone: String(addr.phone || '').trim(),
    region: String(addr.region || '').trim(),
    detail: String(addr.detail || '').trim(),
    address: String(addr.address || '').trim(),
    ...(hasLL ? { lat, lng } : {}),
    createdAt: tNow, 
    updatedAt: tNow
  };

  // 更新数组
  const idx = addresses.findIndex(x => String(x.id || x._id) === id);
  if (idx >= 0) {
    nextItem.createdAt = addresses[idx].createdAt || tNow; // 保持创建时间
    addresses[idx] = { ...addresses[idx], ...nextItem };
  } else {
    addresses.unshift(nextItem);
  }

  if (addr.isDefault || !defaultId) defaultId = id;

  // 排序与截断
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

  // 如果删的是默认地址，重置默认
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
