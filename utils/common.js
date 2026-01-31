// utils/common.js
// 通用工具：集中复用，减少页面里重复的“格式化/数值转换/兼容”代码。

function safeStr(v) {
  return String(v == null ? '' : v).trim();
}

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeTsMs(ts) {
  const t = toNum(ts, 0);
  if (!t) return 0;
  // 兼容秒级时间戳（1e12 约为 2001-09-09 的毫秒时间戳）
  return t < 1e12 ? t * 1000 : t;
}

function fmtMoney(v) {
  return Number(v || 0).toFixed(2);
}

function fmtTime(ts) {
  const t = normalizeTsMs(ts);
  if (!t) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isCloudFileId(s) {
  return typeof s === 'string' && s.startsWith('cloud://');
}

function pickImg(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return pickImg(v[0]);
  if (typeof v === 'object') return pickImg(v.url || v.src || v.tempFileURL || v.fileID || v.fileId || v.path || v.img);
  return '';
}

module.exports = {
  fmtMoney,
  fmtTime,
  isCloudFileId,
  normalizeTsMs,
  pad2,
  pickImg,
  safeStr,
  sleep,
  toNum,
};

