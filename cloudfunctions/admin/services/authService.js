const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const {
  COL_USERS,
  COL_SESS
} = require('../config/constants');
const {
  now,
  isCollectionNotExists,
  sha256,
  randomToken
} = require('../utils/common');

// 初始化数据库
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const SESSION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000; // ~10 years
const SESSION_RENEW_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // renew when <30 days left

// 确保默认管理员存在
async function ensureDefaultAdmin() {
  let r;
  try {
    r = await db.collection(COL_USERS).where({ username: 'admin' }).limit(1).get();
  } catch (e) {
    if (isCollectionNotExists(e)) r = { data: [] };
    else throw e;
  }

  if (r.data && r.data.length) return r.data[0];

  const salt = crypto.randomBytes(8).toString('hex');
  const passwordHash = sha256('admin123' + salt);

  const admin = {
    username: 'admin',
    enabled: true,
    salt,
    passwordHash,
    createdAt: now(),
    updatedAt: now()
  };

  const addRes = await db.collection(COL_USERS).add({ data: admin });
  return { ...admin, _id: addRes._id };
}

// 创建会话
async function createSession(openid, user) {
  const token = randomToken();
  const expiresAt = now() + SESSION_TTL_MS;

  await db.collection(COL_SESS).add({
    data: {
      token,
      openid,
      username: user.username,
      createdAt: now(),
      expiresAt
    }
  });

  return { token, expiresAt };
}

// 校验 Session (核心鉴权函数)
async function verifySession(token) {
  if (!token) return null;

  const nowTs = now();

  let r;
  try {
    r = await db.collection(COL_SESS).where({ token }).limit(1).get();
  } catch (e) {
    if (isCollectionNotExists(e)) return null;
    throw e;
  }

  if (!r.data || !r.data.length) return null;

  const sess = r.data[0];
  // Session expires only when expiresAt is in the past.
  // We also auto-renew sessions so merchants won't be forced to re-login frequently.
  if (sess.expiresAt && sess.expiresAt < nowTs) return null;

  let u;
  try {
    u = await db.collection(COL_USERS).where({ username: sess.username }).limit(1).get();
  } catch (e) {
    if (isCollectionNotExists(e)) return null;
    throw e;
  }

  if (!u.data || !u.data.length) return null;
  if (!u.data[0].enabled) return null;

  // Sliding renew: extend expiry when it's close.
  try {
    const exp = Number(sess.expiresAt || 0);
    if (exp && (exp - nowTs) < SESSION_RENEW_THRESHOLD_MS && sess._id) {
      const nextExp = nowTs + SESSION_TTL_MS;
      await db.collection(COL_SESS).doc(sess._id).update({ data: { expiresAt: nextExp } });
      sess.expiresAt = nextExp;
    }
  } catch (_) {}

  return { ...sess, user: u.data[0] };
}

// 获取管理员身份信息
function adminIdentity(sess) {
  const u = sess?.user || {};
  return { username: String(u.username || sess?.username || '') };
}

// 登录业务逻辑封装
async function login(username, password, openid) {
  await ensureDefaultAdmin();

  if (!username || !password) return { ok: false, message: '缺少账号或密码' };

  let r;
  try {
    r = await db.collection(COL_USERS).where({ username }).limit(1).get();
  } catch (e) {
    if (isCollectionNotExists(e)) return { ok: false, message: '管理员集合未初始化，请重试' };
    throw e;
  }

  if (!r.data || !r.data.length) return { ok: false, message: '账号不存在' };

  const user = r.data[0];
  if (!user.enabled) return { ok: false, message: '账号已被禁用' };

  const hash = sha256(password + user.salt);
  if (hash !== user.passwordHash) return { ok: false, message: '密码错误' };

  const sess = await createSession(openid, user);
  return {
    ok: true,
    token: sess.token,
    expiresAt: sess.expiresAt,
    user: { username: user.username }
  };
}

module.exports = {
  ensureDefaultAdmin,
  createSession,
  verifySession,
  adminIdentity,
  login
};
