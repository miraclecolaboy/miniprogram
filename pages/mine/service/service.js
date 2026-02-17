const CF_NAME = 'user';
const CF_ACTION = 'getShopConfig';

const { SHOP_CONTACT_CACHE_MAIN: CACHE_KEY } = require('../../../utils/storageKeys');
const { safeStr, isCloudFileId } = require('../../../utils/common');
const { getTempFileUrl } = require('../../../utils/cloudFile');
const { parseServiceHoursRanges, fmtMinOfDay } = require('../../../utils/serviceHours');
const { getShopConfigCache, setShopConfigCache } = require('../../../utils/shopConfigCache');
const CACHE_TTL = 6 * 60 * 60 * 1000; 

function now() { return Date.now(); }
function nowSec() { return Math.floor(Date.now() / 1000); }

const TEMP_URL_EXPIRE_BUFFER_SEC = 60;

function tempUrlExpireAtSec(url) {
  const s = safeStr(url);
  if (!s) return 0;
  const m = s.match(/[?&]t=(\d{8,})/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function isExpiredTempUrl(url) {
  const exp = tempUrlExpireAtSec(url);
  if (!exp) return false;
  return exp <= (nowSec() + TEMP_URL_EXPIRE_BUFFER_SEC);
}

const DEFAULT_SERVICE_HOURS = '10:00-22:00';

function buildServiceHoursLines(text) {
  const raw = safeStr(text);
  if (!raw) return [DEFAULT_SERVICE_HOURS];

  const parsed = parseServiceHoursRanges(raw);
  if (parsed && parsed.length) {
    return parsed.map(r => `${fmtMinOfDay(r.start)}-${fmtMinOfDay(r.end)}`);
  }

  const parts = raw
    .split(/[\s,，;；、/]+/)
    .map(s => safeStr(s).trim())
    .filter(Boolean);
  return parts.length ? parts : [raw];
}

Page({
  data: {
    phone: '',
    serviceHours: '',
    serviceHoursLines: [],
    qrFileId: '',
    qrSrc: '',
    refresherTriggered: false,
  },

  onLoad() {
    this._ensureCloudInit();
    this._loadCache();
    this._refreshQrSrcIfNeeded(false);
    this._fetchContact(false);
  },

  onPullDownRefresh() {
    this.onRefresherRefresh();
  },

  onRefresherRefresh() {
    if (this.data.refresherTriggered) return;
    this.setData({ refresherTriggered: true });
    this._fetchContact(true).finally(() => {
      this.setData({ refresherTriggered: false });
      try { wx.stopPullDownRefresh(); } catch (_) {}
    });
  },

  async previewQr() {
    await this._refreshQrSrcIfNeeded(false);

    const url = safeStr(this.data.qrSrc);
    const fileId = safeStr(this.data.qrFileId);

    if (!url && fileId) {
      await this._refreshQrSrcIfNeeded(true);
    }

    let finalUrl = safeStr(this.data.qrSrc);
    if (!finalUrl && !fileId) {
      await this._fetchContact(true);
      finalUrl = safeStr(this.data.qrSrc);
    }

    if (!finalUrl) {
      wx.showToast({ title: '商家未配置客服二维码', icon: 'none' });
      return;
    }

    wx.previewImage({
      urls: [finalUrl],
      current: finalUrl,
      fail: () => wx.showToast({ title: '预览失败', icon: 'none' }),
    });
  },

  onQrImgError() {
    this.__qrRetryCount = Number(this.__qrRetryCount || 0);
    if (this.__qrRetryCount >= 2) return;
    this.__qrRetryCount += 1;

    const t = now();
    if (this.__qrRetryAt && (t - this.__qrRetryAt) < 2500) return;
    this.__qrRetryAt = t;

    if (safeStr(this.data.qrFileId)) {
      this._refreshQrSrcIfNeeded(true);
    } else {
      this._fetchContact(true);
    }
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
    let cachedPhone = '';
    try {
      const cached = wx.getStorageSync(CACHE_KEY);
      if (cached && typeof cached === 'object') {
        const ts = Number(cached.ts || 0);
        if (ts && now() - ts <= CACHE_TTL) {
          const cachedQrFileId = safeStr(cached.qrFileId);
          let cachedQrSrc = safeStr(cached.qrSrc);

          if (cachedQrSrc && isExpiredTempUrl(cachedQrSrc)) {
            cachedQrSrc = '';
          }

          cachedPhone = safeStr(cached.phone);

          this._setDataIfChanged({
            phone: cachedPhone,
            serviceHours: safeStr(cached.serviceHours),
            qrFileId: cachedQrFileId,
            qrSrc: cachedQrSrc,
          });
        }
      }
    } catch (_) {}

    if (cachedPhone) return;
    try {
      const cfg = getShopConfigCache();
      if (!cfg || typeof cfg !== 'object') return;

      const phone = safeStr(cfg.phone || cfg.kefuPhone || cfg.contactPhone || cfg.servicePhone || cfg.tel || cfg.mobile);
      const serviceHours = safeStr(cfg.serviceHours || cfg.businessHours || cfg.openHours);

      const qrRaw = safeStr(cfg.kefuQrUrl || cfg.kefuQr || cfg.qrUrl);
      let qrFileId = '';
      let qrSrc = '';

      if (qrRaw && isCloudFileId(qrRaw)) qrFileId = qrRaw;
      else qrSrc = qrRaw;

      if (phone || serviceHours || qrFileId || qrSrc) {
        this._setDataIfChanged({ phone, serviceHours, qrFileId, qrSrc });
      }
    } catch (_) {}
  },

  async _refreshQrSrcIfNeeded(force) {
    if (!wx.cloud) return;
    if (this.__refreshingQr) return;

    const fileId = safeStr(this.data.qrFileId);
    if (!fileId) return;

    const cur = safeStr(this.data.qrSrc);
    const shouldRefresh = force || !cur || isExpiredTempUrl(cur);
    if (!shouldRefresh) return;

    this.__refreshingQr = true;
    try {
      const nextUrl = await getTempFileUrl(fileId);
      if (nextUrl && nextUrl !== cur) {
        this.__qrRetryCount = 0;
        this._setDataIfChanged({ qrSrc: nextUrl });

        try {
          const cached = wx.getStorageSync(CACHE_KEY);
          if (cached && typeof cached === 'object') {
            wx.setStorageSync(CACHE_KEY, { ...cached, qrFileId: fileId, qrSrc: nextUrl });
          }
        } catch (_) {}
      }
    } finally {
      this.__refreshingQr = false;
    }
  },

  async _fetchContact(force) {
    if (!wx.cloud) return;

    if (!force) {
      try {
        const cached = wx.getStorageSync(CACHE_KEY);
        const ts = Number(cached?.ts || 0);
        if (ts && now() - ts <= CACHE_TTL) {
          const cachedQrFileId = safeStr(cached?.qrFileId);
          const cachedQrSrc = safeStr(cached?.qrSrc);
          const cachedPhone = safeStr(cached?.phone);

          if (cachedQrFileId) {
            this._refreshQrSrcIfNeeded(false);
            if (cachedPhone) return;
          }

          if (cachedQrSrc && isExpiredTempUrl(cachedQrSrc)) {
          } else {
            if (cachedPhone) return;
          }
        }
      } catch (_) {}
    }

    try {
      const res = await wx.cloud.callFunction({
        name: CF_NAME,
        data: { action: CF_ACTION },
      });

      const cfg = res?.result?.data || res?.result || {};

      setShopConfigCache(cfg);

      const phone = safeStr(cfg.phone || cfg.kefuPhone || cfg.contactPhone || cfg.servicePhone || cfg.tel || cfg.mobile);
      const serviceHours = safeStr(cfg.serviceHours || cfg.businessHours || cfg.openHours);

      const qrRaw = safeStr(cfg.kefuQrUrl || cfg.kefuQr || cfg.qrUrl);
      let qrFileId = '';
      let qrSrc = '';

      if (qrRaw && isCloudFileId(qrRaw)) {
        qrFileId = qrRaw;
        qrSrc = await getTempFileUrl(qrFileId);
      } else {
        qrSrc = qrRaw;
      }

      const next = { phone, serviceHours, qrFileId, qrSrc };

      try {
        wx.setStorageSync(CACHE_KEY, { ...next, ts: now() });
      } catch (_) {}

      this.__qrRetryCount = 0;
      this._setDataIfChanged(next);
    } catch (e) {
    }
  },

  _setDataIfChanged(next) {
    if (!next) return;

    const merged = {
      phone: (Object.prototype.hasOwnProperty.call(next, 'phone') ? next.phone : this.data.phone),
      serviceHours: (Object.prototype.hasOwnProperty.call(next, 'serviceHours') ? next.serviceHours : this.data.serviceHours),
      qrFileId: (Object.prototype.hasOwnProperty.call(next, 'qrFileId') ? next.qrFileId : this.data.qrFileId),
      qrSrc: (Object.prototype.hasOwnProperty.call(next, 'qrSrc') ? next.qrSrc : this.data.qrSrc),
    };

    const viewModel = {
      phone: safeStr(merged.phone),
      serviceHours: safeStr(merged.serviceHours),
      qrFileId: safeStr(merged.qrFileId),
      qrSrc: safeStr(merged.qrSrc),
    };
    viewModel.serviceHoursLines = buildServiceHoursLines(viewModel.serviceHours);

    const prevLinesKey = Array.isArray(this.data.serviceHoursLines) ? this.data.serviceHoursLines.join('|') : '';
    const nextLinesKey = viewModel.serviceHoursLines.join('|');

    const changed =
      viewModel.phone !== this.data.phone ||
      viewModel.serviceHours !== this.data.serviceHours ||
      viewModel.qrFileId !== this.data.qrFileId ||
      viewModel.qrSrc !== this.data.qrSrc ||
      nextLinesKey !== prevLinesKey;

    if (changed) this.setData(viewModel);
  },
});
