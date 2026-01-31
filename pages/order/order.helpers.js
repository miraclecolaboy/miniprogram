// pages/order/order.helpers.js
// 点单页专用 helper：纯函数，方便复用与测试。

const { buildSkuKey, buildSpecText } = require('../../utils/sku');

function getCartKey(item) {
  if (!item) return '';
  if (item.hasSpecs && item.skuKey) return item.skuKey;
  return item.productId || item.id || '';
}

module.exports = {
  buildSkuKey,
  buildSpecText,
  getCartKey,
};
