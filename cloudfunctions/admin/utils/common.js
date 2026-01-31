const crypto = require('crypto');

// 获取当前时间戳
function now() {
  return Date.now();
}

// 检查集合不存在错误
function isCollectionNotExists(err) {
  return err && err.errCode === -502005;
}

// SHA256 加密
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// 生成随机 Token
function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

// 转数字，默认 d
function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * 【新增】安全地将值转换为整数
 * @param {*} v - 输入值
 * @param {number} d - 转换失败时的默认值
 * @returns {number}
 */
function toInt(v, d = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

// 安全转字符串
function safeStr(v) {
  return String(v == null ? '' : v).trim();
}

// 补零
function pad2(n) {
  return String(n).padStart(2, '0');
}

// 格式化时间
function formatTimeText(ts) {
  const d = new Date(Number(ts || Date.now()));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 金额转分
function moneyToFen(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

// 生成随机取餐码 (4位)
function genPickupCode4() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return String(n);
}

// 生成退款单号 (32位)
function genOutRefundNo32() {
  return crypto.randomBytes(16).toString('hex');
}

// 生成随机字符串 (32位)
function genNonceStr32() {
  return crypto.randomBytes(16).toString('hex');
}

// 规范化配送模式
function normalizeModes(modes) {
  if (Array.isArray(modes) && modes.length) return modes.map(String);
  return ['ziti', 'waimai', 'kuaidi'];
}

// 清洗规格数据
function sanitizeSpecs(specs) {
  if (!Array.isArray(specs)) return [];
  return specs
    .map(g => {
      const name = String(g?.name || '').trim();
      const options = Array.isArray(g?.options) ? g.options : [];
      // 【新逻辑】规格选项不再包含 priceDelta
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

// 导出所有函数
module.exports = {
  now,
  isCollectionNotExists,
  sha256,
  randomToken,
  toNum,
  toInt, // 【新增】导出 toInt 函数
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