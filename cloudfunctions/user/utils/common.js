const cloud = require('wx-server-sdk');

// 初始化 cloud 用于 getTempFileURL
// 注意：在被 require 时可能还没 init，所以函数内使用 cloud 实例前最好确保外部已 init，
// 或者在这里 lazy init。为简单起见，这里假设外部 index.js 会负责 init，或者函数内部直接调用 wx-server-sdk。
// 但为了独立性，这里不执行 cloud.init，直接使用 cloud 对象的方法（需确保上下文）

function now() { return Date.now(); }

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function isCollectionNotExists(err) {
  return err && err.errCode === -502005;
}

function normPointsEarn(v) {
  const n = Math.floor(Number(v || 0));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function normCount(v) {
  const n = Math.floor(Number(v || 0));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function safeErrMsg(e) {
  try {
    if (!e) return '';
    return String(e.errMsg || e.message || e) || '';
  } catch (_) {
    return '';
  }
}

function gen6Code() {
  // 100000-999999
  return String(Math.floor(100000 + Math.random() * 900000));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatTimeText(ts) {
  const d = new Date(Number(ts || Date.now()));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 批量换取临时链接
async function getTempUrlMap(fileIds) {
  const ids = (fileIds || []).map(x => String(x || '')).filter(Boolean);
  if (!ids.length) return {};

  const out = {};
  const batch = 50;
  for (let i = 0; i < ids.length; i += batch) {
    const part = ids.slice(i, i + batch);
    try {
      const r = await cloud.getTempFileURL({ fileList: part });
      const list = (r && r.fileList) || [];
      list.forEach(it => {
        if (it && it.fileID && it.tempFileURL) out[it.fileID] = it.tempFileURL;
      });
    } catch (e) {
      console.error('getTempUrlMap error', e);
    }
  }
  return out;
}

module.exports = {
  now,
  toNum,
  isCollectionNotExists,
  normPointsEarn,
  normCount,
  safeErrMsg,
  gen6Code,
  pad2,
  formatTimeText,
  getTempUrlMap
};
