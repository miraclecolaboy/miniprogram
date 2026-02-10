// pages/checkout/checkout.helpers.js
// 结算页专用的纯函数/Promise 包装，避免 checkout.js 变成“巨石文件”。

const { parseServiceHoursRanges, roundUpMinutes, fmtMinOfDay } = require('../../utils/serviceHours');

function rad(x) { return (x * Math.PI) / 180; }

function calcDistanceKm(lat1, lon1, lat2, lon2) {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) return 0;
  const R = 6371;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function round2(n) { const x = Number(n || 0); return Math.round(x * 100) / 100; }

function computeDeliveryFee(mode, goodsTotal, cfg) {
  const m = String(mode || 'ziti');
  const gt = round2(goodsTotal);
  const wFee = round2(cfg?.waimaiDeliveryFee);
  const kFee = round2(cfg?.kuaidiDeliveryFee);
  const wLine = Number(cfg?.minOrderWaimai ?? 0);
  const kLine = Number(cfg?.minOrderKuaidi ?? 0);

  if (m === 'waimai') {
    if (wFee <= 0) return 0;
    if (Number.isFinite(wLine) && wLine > 0 && gt >= wLine) return 0;
    return wFee;
  }
  if (m === 'kuaidi') {
    if (kFee <= 0) return 0;
    if (Number.isFinite(kLine) && kLine > 0 && gt >= kLine) return 0;
    return kFee;
  }
  return 0;
}

function promisifyGetSetting() {
  return new Promise((resolve) => {
    wx.getSetting({
      success: resolve,
      fail: () => resolve({ authSetting: {} }),
    });
  });
}

function promisifyGetLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'wgs84',
      success: resolve,
      fail: reject,
    });
  });
}

function promisifyAuthorizeLocation() {
  return new Promise((resolve, reject) => {
    wx.authorize({
      scope: 'scope.userLocation',
      success: resolve,
      fail: reject,
    });
  });
}

function getSystemLocationFlags() {
  try {
    const info = wx.getSystemInfoSync();
    return { locationEnabled: info.locationEnabled, locationAuthorized: info.locationAuthorized };
  } catch (e) {
    return { locationEnabled: null, locationAuthorized: null };
  }
}

function storeSubModeText(sub) {
  return sub === 'tangshi' ? '堂食' : '自提';
}

function genPickupTimeSlotsByServiceHours(serviceHours) {
  const DEFAULT_RANGES = [{ start: 10 * 60, end: 22 * 60 }];
  const ranges = parseServiceHoursRanges(serviceHours) || DEFAULT_RANGES;

  const now = Date.now();
  const nowD = new Date(now);
  const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
  const step = 10;

  // 找到今天“下一段”营业区间：end >= nowMin（与原逻辑保持一致，结束时间点仍视为可选）
  let rangeIndex = ranges.findIndex(r => r.end >= nowMin);
  let useTomorrow = false;
  if (rangeIndex < 0) {
    useTomorrow = true;
    rangeIndex = 0;
  }

  const curRange = ranges[rangeIndex];
  const inOpenRangeToday = !useTomorrow && nowMin >= curRange.start && nowMin <= curRange.end;
  const includeNow = inOpenRangeToday;

  let startMin;
  if (useTomorrow) {
    startMin = ranges[0].start;
  } else if (nowMin < curRange.start) {
    startMin = curRange.start;
  } else {
    startMin = Math.max(curRange.start, roundUpMinutes(nowMin, step));
  }

  const list = includeNow ? ['立即取餐'] : [];

  for (let i = rangeIndex; i < ranges.length; i += 1) {
    const r = ranges[i];
    let cur = i === rangeIndex ? startMin : r.start;
    if (cur < r.start) cur = r.start;

    while (cur <= r.end) {
      list.push(fmtMinOfDay(cur));
      cur += step;
    }
  }

  return list;
}

module.exports = {
  calcDistanceKm,
  computeDeliveryFee,
  genPickupTimeSlotsByServiceHours,
  getSystemLocationFlags,
  promisifyAuthorizeLocation,
  promisifyGetLocation,
  promisifyGetSetting,
  storeSubModeText,
};
