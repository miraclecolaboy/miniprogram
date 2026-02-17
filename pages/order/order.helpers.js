
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
