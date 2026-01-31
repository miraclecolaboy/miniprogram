// utils/auth.js
const { MERCHANT_SESSION } = require('../../../utils/storageKeys');

const SESSION_KEY = MERCHANT_SESSION;

function getSession() {
  try {
    return wx.getStorageSync(SESSION_KEY) || null;
  } catch (e) {
    return null;
  }
}

function setSession(session) {
  wx.setStorageSync(SESSION_KEY, session);
}

function clearSession() {
  wx.removeStorageSync(SESSION_KEY);
}

function requireLogin() {
  const session = getSession();
  if (!session || !session.token) {
    wx.reLaunch({ url: '/packages/admin/pages/login/login' });
    return null;
  }
  return session;
}

module.exports = {
  SESSION_KEY,
  getSession,
  setSession,
  clearSession,
  requireLogin
};
