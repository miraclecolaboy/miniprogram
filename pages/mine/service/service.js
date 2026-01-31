const CF_NAME = 'user';
const CF_ACTION = 'getShopConfig';

const { SHOP_CONTACT_CACHE_MAIN: CACHE_KEY } = require('../../../utils/storageKeys');
const { safeStr, isCloudFileId } = require('../../../utils/common');
const { getTempFileUrl } = require('../../../utils/cloudFile');
const CACHE_TTL = 6 * 60 * 60 * 1000; 

function now() { return Date.now(); }

Page({
  data: {
    phone: '',
    serviceHours: '',
    // 默认空：空则 WXML 中 wx:if 不展示二维码卡片
    qrSrc: '',
  },

  onLoad() {
    this._ensureCloudInit();
    this._loadCache();      // 先缓存秒开
    this._fetchContact(false); // 再拉最新
  },

  onPullDownRefresh() {
    this._fetchContact(true).finally(() => wx.stopPullDownRefresh());
  },

  previewQr() {
    const url = safeStr(this.data.qrSrc);
    if (!url) {
      wx.showToast({ title: '商家未配置客服二维码', icon: 'none' });
      return;
    }
    wx.previewImage({
      urls: [url],
      current: url,
      fail: () => wx.showToast({ title: '预览失败', icon: 'none' }),
    });
  },

  copyPhone() {
    const phone = safeStr(this.data.phone);
    if (!phone) {
      wx.showToast({ title: '商家未配置电话', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: phone,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' }),
    });
  },

  callPhone() {
    const phone = safeStr(this.data.phone);
    if (!phone) {
      wx.showToast({ title: '商家未配置电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => wx.showToast({ title: '拨打失败', icon: 'none' }),
    });
  },

  _ensureCloudInit() {
    if (!wx.cloud || this.__cloudInited) return;
    try {
      wx.cloud.init({ traceUser: true });
    } catch (_) {}
    this.__cloudInited = true;
  },

  _loadCache() {
    try {
      const cached = wx.getStorageSync(CACHE_KEY);
      if (!cached || typeof cached !== 'object') return;

      const ts = Number(cached.ts || 0);
      if (!ts || now() - ts > CACHE_TTL) return;

      this._setDataIfChanged({
        phone: safeStr(cached.phone),
        serviceHours: safeStr(cached.serviceHours),
        qrSrc: safeStr(cached.qrSrc),
      });
    } catch (_) {}
  },

  async _fetchContact(force) {
    if (!wx.cloud) return;

    if (!force) {
      try {
        const cached = wx.getStorageSync(CACHE_KEY);
        const ts = Number(cached?.ts || 0);
        if (ts && now() - ts <= CACHE_TTL) return;
      } catch (_) {}
    }

    try {
      const res = await wx.cloud.callFunction({
        name: CF_NAME,
        data: { action: CF_ACTION },
      });

      const cfg = res?.result?.data || res?.result || {};

      const phone = safeStr(cfg.phone);
      const serviceHours = safeStr(cfg.serviceHours);

      // 商家配置：kefuQrUrl 允许 http(s) 或 cloud:// fileID
      let qr = safeStr(cfg.kefuQrUrl);

      if (qr && isCloudFileId(qr)) {
        qr = await getTempFileUrl(qr);
      }

      const next = { phone, serviceHours, qrSrc: qr };

      try {
        wx.setStorageSync(CACHE_KEY, { ...next, ts: now() });
      } catch (_) {}

      this._setDataIfChanged(next);
    } catch (e) {
      // 有缓存就静默；需要提示可打开：
      // wx.showToast({ title: '客服信息加载失败', icon: 'none' });
    }
  },

  _setDataIfChanged(next) {
    if (!next) return;
    const changed =
      next.phone !== this.data.phone ||
      next.serviceHours !== this.data.serviceHours ||
      next.qrSrc !== this.data.qrSrc;

    if (changed) this.setData(next);
  },
});
