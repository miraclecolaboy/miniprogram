// pages/checkout/checkout.location.js
// 结算页：定位/距离/配送范围校验相关方法

const { toNum } = require('../../utils/common');
const { LOC_CACHE: KEY_LOC_CACHE } = require('../../utils/storageKeys');
const { getAddressLngLat: getAddrLngLat } = require('../../utils/address');
const {
  calcDistanceKm,
  getSystemLocationFlags,
  promisifyAuthorizeLocation,
  promisifyGetLocation,
  promisifyGetSetting,
} = require('./checkout.helpers');

const LOC_CACHE_TTL = 10 * 60 * 1000;

module.exports = {
  showOutOfRangeModal(limitKm, km) {
    wx.showModal({
      title: '超出配送范围',
      content: `该地址距离门店约 ${Number(km || 0).toFixed(2)} km，超出配送范围（${limitKm} km），无法配送。`,
      showCancel: false,
      confirmText: '我知道了',
    });
  },

  validateWaimaiAddress(addr, tip = true, ui = 'toast') {
    const ll = getAddrLngLat(addr);
    if (!ll) {
      if (tip) wx.showToast({ title: '地址缺少定位信息', icon: 'none' });
      return false;
    }
    const { storeLat, storeLng, waimaiMaxKm } = this.data;
    if (!storeLat || !storeLng) return true;
    const km = calcDistanceKm(ll.lat, ll.lng, storeLat, storeLng);
    if (waimaiMaxKm > 0 && km > waimaiMaxKm) {
      if (tip) {
        if (ui === 'modal') this.showOutOfRangeModal(waimaiMaxKm, km);
        else wx.showToast({ title: `外卖地址超出门店${waimaiMaxKm}公里`, icon: 'none' });
      }
      return false;
    }
    return true;
  },

  recheckAddressForMode(tip) {
    if (this.data.mode !== 'waimai') return;
    const addr = this.data.address;
    if (addr && !this.validateWaimaiAddress(addr, tip, 'toast')) {
      this.setData({ address: null });
    }
  },

  async refreshDistance(userInitiated = false) {
    const { storeLat, storeLng } = this.data;
    if (!storeLat || !storeLng) return;

    const nowTs = Date.now();

    const setDistanceByLatLng = (lat, lng) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const km = calcDistanceKm(Number(lat), Number(lng), Number(storeLat), Number(storeLng));
      if (!Number.isFinite(km)) return;

      let distance = '';
      let distanceUnit = '';
      if (km < 1) {
        distance = String(Math.max(1, Math.round(km * 1000)));
        distanceUnit = 'm';
      } else {
        distance = km.toFixed(km < 10 ? 2 : 1);
        distanceUnit = 'km';
      }

      this.safeSetData({ distance, distanceUnit });
    };

    // 1) 读缓存（首次进页优先秒开；点击时也可用缓存避免频繁定位）
    try {
      const cached = wx.getStorageSync(KEY_LOC_CACHE);
      const ts = Number(cached?.ts || 0);
      const lat = Number(cached?.lat);
      const lng = Number(cached?.lng);
      const fresh = ts > 0 && (nowTs - ts) <= LOC_CACHE_TTL;
      if (fresh && Number.isFinite(lat) && Number.isFinite(lng)) {
        setDistanceByLatLng(lat, lng);
        // 非用户主动点击：用到缓存就直接返回；用户点击则继续尝试刷新一次
        if (!userInitiated) return;
      }
    } catch (_) {}

    // 2) 非用户主动触发：没有授权就不弹窗不请求（避免“进页就弹授权”）
    let authed = false;
    try {
      const setting = await promisifyGetSetting();
      authed = !!(setting?.authSetting && setting.authSetting['scope.userLocation']);
    } catch (_) {
      authed = false;
    }
    if (!authed && !userInitiated) return;

    // 3) 用户主动触发：处理系统定位开关/权限提示
    if (userInitiated) {
      const flags = getSystemLocationFlags();
      if (flags.locationEnabled === false) {
        wx.showModal({
          title: '无法获取定位',
          content: '请在系统设置中开启定位服务后重试。',
          showCancel: false,
        });
        return;
      }
    }

    if (!authed && userInitiated) {
      try {
        await promisifyAuthorizeLocation();
        authed = true;
      } catch (_) {
        wx.showModal({
          title: '需要定位权限',
          content: '用于计算你与门店的距离，请在设置中开启定位权限。',
          confirmText: '去设置',
          cancelText: '取消',
          success: (r) => {
            if (r.confirm) wx.openSetting({});
          },
        });
        return;
      }
    }

    if (!authed) return;

    if (userInitiated) wx.showLoading({ title: '定位中', mask: true });
    try {
      const loc = await promisifyGetLocation();
      const lat = Number(loc?.latitude);
      const lng = Number(loc?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('bad_location');

      try {
        wx.setStorageSync(KEY_LOC_CACHE, { lat, lng, ts: nowTs });
      } catch (_) {}

      setDistanceByLatLng(lat, lng);
    } catch (e) {
      if (userInitiated) wx.showToast({ title: '定位失败', icon: 'none' });
    } finally {
      if (userInitiated) wx.hideLoading();
    }
  },

  onTapLocation() { this.refreshDistance(true); },
};

