// utils/address.js
// 地址相关：兼容旧数据结构（id/_id、lat/lng/latitude/longitude/location 等），统一归一化逻辑。

const { safeStr, toNum } = require('./common');

function getAddressId(addr) {
  return safeStr(addr && (addr.id || addr._id));
}

function buildFullAddress(addr) {
  if (!addr) return '';
  const a = safeStr(addr.address);
  if (a) return a;
  const f = safeStr(addr.fullAddress);
  if (f) return f;
  const base = safeStr(addr.baseAddress || addr.poiAddress || addr.region);
  const detail = safeStr(addr.detail);
  return [base, detail].filter(Boolean).join(' ');
}

function normalizeAddress(addr) {
  if (!addr || typeof addr !== 'object') return null;
  const id = getAddressId(addr);
  if (!id) return null;
  return {
    ...addr,
    id,
    address: buildFullAddress(addr),
    isDefault: !!addr.isDefault,
  };
}

function normalizeAddressList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(normalizeAddress)
    .filter(Boolean);
}

function getAddressLngLat(addr) {
  if (!addr) return null;
  const lat = toNum(addr.lat ?? addr.latitude ?? addr.location?.lat ?? addr.location?.latitude, null);
  const lng = toNum(addr.lng ?? addr.longitude ?? addr.location?.lng ?? addr.location?.longitude, null);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function pickAddressForUpsert(addr) {
  if (!addr || typeof addr !== 'object') return {};
  const id = getAddressId(addr);
  const ll = getAddressLngLat(addr);
  return {
    id,
    name: addr.name,
    phone: addr.phone,
    address: buildFullAddress(addr),
    lat: ll ? ll.lat : undefined,
    lng: ll ? ll.lng : undefined,
    location: addr.location,
    isDefault: !!addr.isDefault,
  };
}

function normalizeAddressForView(addr) {
  const a = normalizeAddress(addr);
  if (!a) return null;
  return { ...a, fullAddress: buildFullAddress(a) };
}

module.exports = {
  buildFullAddress,
  getAddressId,
  getAddressLngLat,
  normalizeAddress,
  normalizeAddressForView,
  normalizeAddressList,
  pickAddressForUpsert,
};
