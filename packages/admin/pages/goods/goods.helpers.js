
function toInt(v, d = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function normalizeModes(modes) {
  if (Array.isArray(modes) && modes.length) return modes;
  return ['ziti', 'waimai', 'kuaidi'];
}

function modesToText(modes) {
  const set = new Set(normalizeModes(modes));
  const map = { ziti: '到店', waimai: '外卖', kuaidi: '快递' };
  return Array.from(set).map((k) => map[k] || k).join('/');
}

function normalizeSpecsForSku(rawSpecs) {
  const specs = Array.isArray(rawSpecs) ? rawSpecs : [];
  return specs
    .map((g) => {
      const name = String(g?.name || '').trim();
      const labels = (g.options || []).map((o) => String(o?.label || '').trim()).filter(Boolean);
      return { name, labels };
    })
    .filter((g) => g.name && g.labels.length);
}

function buildSkuCombos(rawSpecs, maxCombos = 200) {
  const groups = normalizeSpecsForSku(rawSpecs);
  if (!groups.length) return { ok: false, message: '请完善规格组名与选项', combos: [] };

  let combos = [{}];
  for (const g of groups) {
    const next = [];
    for (const base of combos) {
      for (const label of g.labels) {
        next.push({ ...base, [g.name]: label });
        if (next.length > maxCombos) {
          return { ok: false, message: `规格组合过多（>${maxCombos}）`, combos: [] };
        }
      }
    }
    combos = next;
  }

  return { ok: true, combos };
}

module.exports = {
  buildSkuCombos,
  modesToText,
  normalizeModes,
  toInt,
};
