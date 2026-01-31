// utils/auth.js
const { callUser } = require('./cloud');

const {
  USER: KEY_USER,
  BALANCE: KEY_BALANCE,
  POINTS: KEY_POINTS,
  MEMBER_LEVEL: KEY_MEMBER_LEVEL,
  TOTAL_RECHARGE: KEY_TOTAL_RECHARGE,
  ADDRESS: KEY_ADDRESS,
  ORDER_STATS: KEY_ORDER_STATS,
} = require('./storageKeys');

let _loginPromise = null;

function isLoginOK() {
  const u = wx.getStorageSync(KEY_USER);
  return !!(u && (u.openid || u._id));
}

// 静默登录：不依赖 wx.getUserProfile，避免“微信用户/灰头像”污染 users
async function ensureLogin() {
  if (isLoginOK()) return wx.getStorageSync(KEY_USER);
  if (_loginPromise) return _loginPromise;

  _loginPromise = (async () => {
    const res = await callUser('loginOrRegister', {});
    const out = res && res.result;
    if (out && out.error) throw new Error(out.error);
    const user = out && out.data;
    if (!user) throw new Error('登录失败');

    // 登录成功后马上落盘，供后续页面快速读缓存（这里同步一次即可）
    wx.setStorageSync(KEY_USER, user);
    return user;
  })();

  try {
    return await _loginPromise;
  } finally {
    _loginPromise = null;
  }
}

function setStorageSafe(key, data) {
  return new Promise((resolve) => {
    wx.setStorage({
      key,
      data,
      success: resolve,
      fail: resolve, // 失败不阻塞主流程
    });
  });
}

// 自动同步（支持复用已拿到的 me，避免重复 getMe）
async function refreshUserToStorage(meInput) {
  if (!isLoginOK()) return null;

  let me = meInput;

  // 没传 me 时才去拉，避免页面里先 getMe 又 refresh 再 getMe 的重复请求
  if (!me) {
    const res = await callUser('getMe', {});
    const out = res && res.result;
    if (out && out.error) return null;
    me = out && out.data;
  }

  if (!me) return null;

  const balance = Number(me.balance || 0);
  const points = Number(me.points || 0);
  const memberLevel = Number(me.memberLevel || 0);
  const totalRecharge = Number(me.totalRecharge || 0);
  const addresses = Array.isArray(me.addresses) ? me.addresses : [];
  const orderStats = me.orderStats || { count: 0, lastOrderAt: 0, lastOrderId: '' };

  // 这里用异步存储，避免同步 IO 造成页面进场卡顿
  await Promise.all([
    setStorageSafe(KEY_USER, me),
    setStorageSafe(KEY_BALANCE, balance),
    setStorageSafe(KEY_POINTS, points),
    setStorageSafe(KEY_MEMBER_LEVEL, memberLevel),
    setStorageSafe(KEY_TOTAL_RECHARGE, totalRecharge),
    setStorageSafe(KEY_ADDRESS, addresses),
    setStorageSafe(KEY_ORDER_STATS, orderStats),
  ]);

  return me;
}

module.exports = { ensureLogin, refreshUserToStorage, isLoginOK };
