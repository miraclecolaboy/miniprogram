const cloud = require('wx-server-sdk');

function now() { return Date.now(); }

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function toInt(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
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
  return String(Math.floor(100000 + Math.random() * 900000));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatTimeText(ts) {
  const d = new Date(Number(ts || Date.now()));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

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
  toInt,
  isCollectionNotExists,
  normPointsEarn,
  normCount,
  safeErrMsg,
  gen6Code,
  pad2,
  formatTimeText,
  getTempUrlMap
};
