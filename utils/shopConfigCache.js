// utils/shopConfigCache.js
// Cache shop config (getShopConfig) in local storage to avoid UI flicker on first render.

const { SHOP_CONFIG_CACHE_MAIN: CACHE_KEY } = require('./storageKeys');

function now() { return Date.now(); }

function getShopConfigCache() {
  try {
    const cached = wx.getStorageSync(CACHE_KEY);
    if (!cached || typeof cached !== 'object') return null;
    const out = { ...cached };
    delete out.ts;
    return out;
  } catch (_) {
    return null;
  }
}

function setShopConfigCache(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  try {
    const prev = wx.getStorageSync(CACHE_KEY);
    const prevObj = (prev && typeof prev === 'object') ? prev : {};
    // Merge to keep old fields if server omits them temporarily.
    wx.setStorageSync(CACHE_KEY, { ...prevObj, ...cfg, ts: now() });
  } catch (_) {}
}

module.exports = {
  getShopConfigCache,
  setShopConfigCache,
};

