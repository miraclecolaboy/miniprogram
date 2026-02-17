
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

function pickAddressLngLat(addr) {
  if (!addr || typeof addr !== 'object') return null;
  const lat = Number(addr.lat ?? addr.latitude ?? addr.location?.lat ?? addr.location?.latitude);
  const lng = Number(addr.lng ?? addr.longitude ?? addr.location?.lng ?? addr.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function resolveKuaidiRule(cfg, opts = {}) {
  const inFee = round2(cfg?.kuaidiDeliveryFee ?? 10);
  const inLine = Number(cfg?.minOrderKuaidi ?? 100);
  const outDistanceKm = Number(cfg?.kuaidiOutProvinceDistanceKm ?? 300);
  const outFee = round2(cfg?.kuaidiOutDeliveryFee ?? 25);
  const outLine = Number(cfg?.minOrderKuaidiOut ?? 140);

  let km = Number(opts?.distanceKm);
  if (!Number.isFinite(km)) {
    const ll = pickAddressLngLat(opts?.address);
    const storeLat = Number(cfg?.storeLat);
    const storeLng = Number(cfg?.storeLng);
    if (ll && Number.isFinite(storeLat) && Number.isFinite(storeLng) && storeLat && storeLng) {
      km = calcDistanceKm(ll.lat, ll.lng, storeLat, storeLng);
    }
  }

  const limitKm = Number.isFinite(outDistanceKm) ? Math.max(0, outDistanceKm) : 300;
  const isOutProvince = Number.isFinite(km) && limitKm > 0 && km > limitKm;
  const fee = Math.max(0, isOutProvince ? outFee : inFee);
  const freeLineRaw = isOutProvince ? outLine : inLine;
  const freeLine = Number.isFinite(freeLineRaw) ? Math.max(0, freeLineRaw) : 0;

  return {
    isOutProvince,
    distanceKm: Number.isFinite(km) ? km : NaN,
    fee,
    freeLine,
  };
}

function computeDeliveryFee(mode, goodsTotal, cfg, opts = {}) {
  const m = String(mode || 'ziti');
  const gt = round2(goodsTotal);
  const wFee = round2(cfg?.waimaiDeliveryFee);
  const wLine = Number(cfg?.minOrderWaimai ?? 0);

  if (m === 'waimai') {
    if (wFee <= 0) return 0;
    if (Number.isFinite(wLine) && wLine > 0 && gt >= wLine) return 0;
    return wFee;
  }
  if (m === 'kuaidi') {
    const rule = resolveKuaidiRule(cfg, opts);
    if (rule.fee <= 0) return 0;
    if (rule.freeLine > 0 && gt >= rule.freeLine) return 0;
    return rule.fee;
  }
  return 0;
}

function computeFreeDeliveryLine(mode, cfg, opts = {}) {
  const m = String(mode || 'ziti');
  if (m === 'waimai') {
    const line = Number(cfg?.minOrderWaimai ?? 0);
    return Number.isFinite(line) ? Math.max(0, line) : 0;
  }
  if (m === 'kuaidi') {
    const rule = resolveKuaidiRule(cfg, opts);
    return Number.isFinite(rule.freeLine) ? Math.max(0, rule.freeLine) : 0;
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
  computeFreeDeliveryLine,
  computeDeliveryFee,
  genPickupTimeSlotsByServiceHours,
  getSystemLocationFlags,
  promisifyAuthorizeLocation,
  promisifyGetLocation,
  promisifyGetSetting,
  storeSubModeText,
};
