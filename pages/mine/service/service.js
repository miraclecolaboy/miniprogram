const CF_NAME = 'user';
const CF_ACTION = 'getShopConfig';

const { SHOP_CONTACT_CACHE_MAIN: CACHE_KEY } = require('../../../utils/storageKeys');
const { safeStr, isCloudFileId } = require('../../../utils/common');
const { getTempFileUrl } = require('../../../utils/cloudFile');
const { parseServiceHoursRanges, fmtMinOfDay } = require('../../../utils/serviceHours');
const CACHE_TTL = 6 * 60 * 60 * 1000; 

function now() { return Date.now(); }
function nowSec() { return Math.floor(Date.now() / 1000); }

const TEMP_URL_EXPIRE_BUFFER_SEC = 60;

function tempUrlExpireAtSec(url) {
  const s = safeStr(url);
  if (!s) return 0;
  // CloudBase tempFileURL often looks like: ...?sign=...&t=1770447820
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

  // Fallback: split by common separators. (Config is normally normalized as space-delimited ranges.)
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
    // 客服二维码：优先存 fileID（可换取新临时链接），qrSrc 为临时 URL 或直链 URL
    qrFileId: '',
    qrSrc: '',
  },

  onLoad() {
    this._ensureCloudInit();
    this._loadCache();      // 先缓存秒开
    this._refreshQrSrcIfNeeded(false);
    this._fetchContact(false); // 再拉最新
  },

  onPullDownRefresh() {
    this._fetchContact(true).finally(() => wx.stopPullDownRefresh());
  },

  async previewQr() {
    await this._refreshQrSrcIfNeeded(false);

    const url = safeStr(this.data.qrSrc);
    const fileId = safeStr(this.data.qrFileId);

    if (!url && fileId) {
      // Retry once for slow networks.
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
    // Avoid infinite retries if the file is deleted or permission is wrong.
    this.__qrRetryCount = Number(this.__qrRetryCount || 0);
    if (this.__qrRetryCount >= 2) return;
    this.__qrRetryCount += 1;

    const t = now();
    if (this.__qrRetryAt && (t - this.__qrRetryAt) < 2500) return;
    this.__qrRetryAt = t;

    if (safeStr(this.data.qrFileId)) {
      this._refreshQrSrcIfNeeded(true);
    } else {
      // If config was saved as an expired temp URL before, force refetch to get fileID.
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
    try {
      const cached = wx.getStorageSync(CACHE_KEY);
      if (!cached || typeof cached !== 'object') return;

      const ts = Number(cached.ts || 0);
      if (!ts || now() - ts > CACHE_TTL) return;

      const cachedQrFileId = safeStr(cached.qrFileId);
      let cachedQrSrc = safeStr(cached.qrSrc);

      // Prevent using expired temp URLs (403) on first render.
      if (cachedQrSrc && isExpiredTempUrl(cachedQrSrc)) {
        cachedQrSrc = '';
      }

      this._setDataIfChanged({
        phone: safeStr(cached.phone),
        serviceHours: safeStr(cached.serviceHours),
        qrFileId: cachedQrFileId,
        qrSrc: cachedQrSrc,
      });
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

        // Persist the refreshed temp URL (phone/serviceHours/fileId still follow CACHE_TTL).
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

          // 1) If we have fileID, refresh temp URL independently, no need to refetch config.
          if (cachedQrFileId) {
            this._refreshQrSrcIfNeeded(false);
            return;
          }

          // 2) If cache only has a signed temp URL and it is expired, we must refetch config
          // to get the fileID (or a fresh URL).
          if (cachedQrSrc && isExpiredTempUrl(cachedQrSrc)) {
            // fallthrough
          } else {
            return;
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

      const phone = safeStr(cfg.phone);
      const serviceHours = safeStr(cfg.serviceHours);

      // 商家配置：kefuQrUrl 允许 http(s) 或 cloud:// fileID
      const qrRaw = safeStr(cfg.kefuQrUrl);
      let qrFileId = '';
      let qrSrc = '';

      if (qrRaw && isCloudFileId(qrRaw)) {
        qrFileId = qrRaw;
        qrSrc = await getTempFileUrl(qrFileId);
      } else {
        qrSrc = qrRaw; // Could be a direct https URL
      }

      const next = { phone, serviceHours, qrFileId, qrSrc };

      try {
        wx.setStorageSync(CACHE_KEY, { ...next, ts: now() });
      } catch (_) {}

      this.__qrRetryCount = 0;
      this._setDataIfChanged(next);
    } catch (e) {
      // 有缓存就静默；需要提示可打开：
      // wx.showToast({ title: '客服信息加载失败', icon: 'none' });
    }
  },

  _setDataIfChanged(next) {
    if (!next) return;

    const viewModel = {
      phone: safeStr(next.phone),
      serviceHours: safeStr(next.serviceHours),
      qrFileId: safeStr(next.qrFileId),
      qrSrc: safeStr(next.qrSrc),
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
