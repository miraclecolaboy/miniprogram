// utils/sku.js
// 统一 SKU Key / 规格文案生成，避免多处实现不一致。

function buildSkuKey(productId, specs, selectedSpecs) {
  const pid = String(productId || '').trim();
  const groups = Array.isArray(specs) ? specs : [];
  const sel = selectedSpecs || {};
  if (!pid || !groups.length) return pid;

  const pairs = groups.map((g) => {
    const v = sel[g.name];
    return `${g.name}=${v == null ? '' : String(v)}`;
  });

  return `${pid}::${encodeURIComponent(pairs.join('|'))}`;
}

function buildSpecText(specs, selectedSpecs) {
  const groups = Array.isArray(specs) ? specs : [];
  const sel = selectedSpecs || {};
  const parts = groups.map((g) => sel[g.name]).filter((v) => v != null && v !== '');
  return parts.join(' / ');
}

function getDefaultSelectedSpecs(specs) {
  const groups = Array.isArray(specs) ? specs : [];
  const selected = {};

  groups.forEach((g) => {
    const opt = (Array.isArray(g.options) && g.options.length) ? g.options[0].label : '';
    selected[g.name] = opt;
  });

  return selected;
}

module.exports = {
  buildSkuKey,
  buildSpecText,
  getDefaultSelectedSpecs,
};

