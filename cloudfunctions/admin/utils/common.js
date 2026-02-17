const crypto = require('crypto');

function now() {
  return Date.now();
}

function isCollectionNotExists(err) {
  if (!err) return false;

  const maybeCodes = [
    err.errCode,
    err.code,
    err?.original?.errCode,
    err?.original?.code
  ].map(v => Number(v));

  if (maybeCodes.some(code => Number.isFinite(code) && code === -502005)) {
    return true;
  }

  const msg = String(
    err.errMsg ||
    err.message ||
    err?.original?.errMsg ||
    err?.original?.message ||
    ''
  ).toLowerCase();

  return (
    msg.includes('collection') &&
    (
      msg.includes('not exist') ||
      msg.includes('does not exist') ||
      msg.includes('not found')
    )
  );
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function toInt(v, d = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function safeStr(v) {
  return String(v == null ? '' : v).trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatTimeText(ts) {
  const d = new Date(Number(ts || Date.now()));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function moneyToFen(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function genPickupCode4() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return String(n);
}

function genOutRefundNo32() {
  return crypto.randomBytes(16).toString('hex');
}

function genNonceStr32() {
  return crypto.randomBytes(16).toString('hex');
}

function normalizeModes(modes) {
  if (Array.isArray(modes) && modes.length) return modes.map(String);
  return ['ziti', 'waimai', 'kuaidi'];
}

function sanitizeSpecs(specs) {
  if (!Array.isArray(specs)) return [];
  return specs
    .map(g => {
      const name = String(g?.name || '').trim();
      const options = Array.isArray(g?.options) ? g.options : [];
      const cleanOpts = options
        .map(o => ({
          label: String(o?.label || '').trim(),
        }))
        .filter(o => o.label);

      if (!name || cleanOpts.length === 0) return null;
      return { name, options: cleanOpts };
    })
    .filter(Boolean);
}

module.exports = {
  now,
  isCollectionNotExists,
  sha256,
  randomToken,
  toNum,
  toInt,
  safeStr,
  pad2,
  formatTimeText,
  moneyToFen,
  genPickupCode4,
  genOutRefundNo32,
  genNonceStr32,
  normalizeModes,
  sanitizeSpecs
};
