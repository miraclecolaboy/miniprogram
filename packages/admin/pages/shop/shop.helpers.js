// packages/admin/pages/shop/shop.helpers.js

const { safeStr, pad2 } = require('../../../../utils/common');
const { parseServiceHoursRanges, fmtMinOfDay } = require('../../../../utils/serviceHours');

function toInt(v, d = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function emptyServiceHoursRange() { return { sh: '', sm: '', eh: '', em: '' }; }
function sanitizeDigits2(v) { return safeStr(v).replace(/[^\d]/g, '').slice(0, 2); }

function normalizeServiceHours(text) {
  const ranges = parseServiceHoursRanges(text);
  if (!ranges) return { ok: false, normalized: '' };
  return { ok: true, normalized: ranges.map((r) => `${fmtMinOfDay(r.start)}-${fmtMinOfDay(r.end)}`).join(' ') };
}

function rangeToServiceHoursInput(r) {
  const start = Math.max(0, Math.floor(Number(r?.start || 0)));
  const end = Math.max(0, Math.floor(Number(r?.end || 0)));
  const sh = Math.floor(start / 60);
  const sm = start % 60;
  const eh = Math.floor(end / 60);
  const em = end % 60;
  return { sh: pad2(sh), sm: pad2(sm), eh: pad2(eh), em: pad2(em) };
}

function buildServiceHoursFromInputRanges(ranges) {
  const arr = Array.isArray(ranges) ? ranges : [];
  const out = [];

  const isValidHm = (h, m) => {
    if (!Number.isInteger(h) || !Number.isInteger(m)) return false;
    if (h === 24) return m === 0;
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  };

  for (let i = 0; i < arr.length; i += 1) {
    const r = arr[i] || {};
    const shStr = safeStr(r.sh);
    const smStr = safeStr(r.sm);
    const ehStr = safeStr(r.eh);
    const emStr = safeStr(r.em);

    const hasAny = shStr || smStr || ehStr || emStr;
    if (!hasAny) continue;

    // 分钟可不填，默认 00；小时必须填
    if (!shStr || !ehStr) return { ok: false, message: `请填写完整的时段${i + 1}` };

    const sh = parseInt(shStr, 10);
    const sm = smStr ? parseInt(smStr, 10) : 0;
    const eh = parseInt(ehStr, 10);
    const em = emStr ? parseInt(emStr, 10) : 0;

    if (![sh, sm, eh, em].every(Number.isFinite)) return { ok: false, message: `时段${i + 1}时间不正确` };
    if (!isValidHm(sh, sm) || !isValidHm(eh, em) || sh === 24) return { ok: false, message: `时段${i + 1}时间不正确` };

    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (end <= start) return { ok: false, message: `时段${i + 1}结束时间需大于开始时间` };

    out.push(`${pad2(sh)}:${pad2(sm)}-${pad2(eh)}:${pad2(em)}`);
  }

  return { ok: true, raw: out.join(' ') };
}

module.exports = {
  buildServiceHoursFromInputRanges,
  emptyServiceHoursRange,
  normalizeServiceHours,
  rangeToServiceHoursInput,
  sanitizeDigits2,
  toInt,
};

