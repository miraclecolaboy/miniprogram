// utils/serviceHours.js
// 营业时间解析/格式化：前端(用户端/商家端)共用，避免两套逻辑漂移。

const { safeStr, pad2 } = require('./common');

function parseServiceHoursRanges(text) {
  const raw = safeStr(text);
  if (!raw) return null;

  const isValidHm = (h, m) => {
    if (!Number.isInteger(h) || !Number.isInteger(m)) return false;
    if (h === 24) return m === 0;
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  };

  // 支持：10:00-22:00 / 10:00~22:00 / 10-22 / 10：00 至 22：00 / 10:00-14:00 17:00-22:00
  const ranges = [];
  const re = /(\d{1,2})(?:[:：](\d{1,2}))?\s*(?:-|~|～|—|–|至)\s*(\d{1,2})(?:[:：](\d{1,2}))?/g;
  let m;
  while ((m = re.exec(raw))) {
    const sh = parseInt(m[1], 10);
    const sm = parseInt(m[2] || '0', 10);
    const eh = parseInt(m[3], 10);
    const em = parseInt(m[4] || '0', 10);

    if (!isValidHm(sh, sm) || !isValidHm(eh, em)) continue;

    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    // 暂不支持跨天（例如 20:00-02:00）
    if (end <= start) continue;

    ranges.push({ start, end });
  }

  if (!ranges.length) return null;

  // 排序 + 合并重叠
  ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (!last || r.start > last.end) merged.push({ ...r });
    else last.end = Math.max(last.end, r.end);
  }

  return merged.length ? merged : null;
}

function roundUpMinutes(minOfDay, stepMinutes) {
  const step = Math.max(1, Number(stepMinutes || 30));
  const v = Math.max(0, Math.floor(Number(minOfDay || 0)));
  const mod = v % step;
  return mod === 0 ? v : (v + (step - mod));
}

function fmtMinOfDay(minOfDay) {
  const m = Math.max(0, Math.min(24 * 60, Math.floor(Number(minOfDay || 0))));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${pad2(hh % 24)}:${pad2(mm)}`;
}

module.exports = {
  fmtMinOfDay,
  parseServiceHoursRanges,
  roundUpMinutes,
};

