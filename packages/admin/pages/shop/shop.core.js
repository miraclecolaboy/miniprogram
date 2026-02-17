
const { requireLogin, getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { parseServiceHoursRanges, fmtMinOfDay } = require('../../../../utils/serviceHours');
const { getTempUrlMap } = require('../../../../utils/cloudFile');
const { emptyServiceHoursRange, rangeToServiceHoursInput } = require('./shop.helpers');

module.exports = {
  onLoad() {
    requireLogin();
    this.init();
  },

  onShow() {
    const s = requireLogin();
    if (!s) return;

    if (typeof this.onRefreshCloudPrintStatus === 'function') {
      this.onRefreshCloudPrintStatus({ silent: true });
    }
  },

  async init() {
    await Promise.allSettled([this.loadConfig(), this.loadGifts(), this.loadCoupons()]);

    if (typeof this.onRefreshCloudPrintStatus === 'function') {
      await this.onRefreshCloudPrintStatus({ silent: true });
    }
  },

  async onReload() {
    await this.init();
    wx.showToast({ title: '已刷新', icon: 'success' });
  },

  toggleSection(e) {
    const key = String(e?.currentTarget?.dataset?.key || '').trim();
    if (!key) return;

    const path = `sectionOpen.${key}`;
    const cur = !!this.data?.sectionOpen?.[key];
    this.setData({ [path]: !cur });
  },

  async loadConfig() {
    const session = getSession();
    if (!session?.token) return;

    const r = await call('admin', { action: 'shop_getConfig', token: session.token }).catch(() => null);
    if (!r?.ok) return;

    const cfg = r.data || {};

    const kefuQrFileId = safeStr(cfg.kefuQrUrl);
    const bannerIds = Array.isArray(cfg.banners) ? cfg.banners : [];

    const allIds = [...(kefuQrFileId ? [kefuQrFileId] : []), ...bannerIds];
    const urlMap = await getTempUrlMap(allIds);

    const kefuQrPreview = kefuQrFileId ? (urlMap[kefuQrFileId] || '') : '';
    const banners = bannerIds.map((fid, idx) => ({
      key: `remote_${idx}_${fid}`,
      fileId: fid,
      preview: urlMap[fid] || '',
    }));

    const serviceHoursText = safeStr(cfg.serviceHours);
    const parsedServiceRanges = parseServiceHoursRanges(serviceHoursText);
    const normalizedServiceRanges = (parsedServiceRanges && parsedServiceRanges.length)
      ? parsedServiceRanges.slice(0, 2)
      : null;
    const serviceHoursRanges = normalizedServiceRanges
      ? normalizedServiceRanges.map(rangeToServiceHoursInput)
      : [emptyServiceHoursRange()];
    const serviceHoursForSave = normalizedServiceRanges
      ? normalizedServiceRanges.map((r) => `${fmtMinOfDay(r.start)}-${fmtMinOfDay(r.end)}`).join(' ')
      : serviceHoursText;

    this.setData({
      notice: safeStr(cfg.notice),
      noticeChanged: false,

      banners,

      waimaiOn: cfg.waimaiOn !== false,
      waimaiMaxKm: Number(cfg.waimaiMaxKm ?? 10),
      waimaiDeliveryFee: String(cfg.waimaiDeliveryFee ?? 8),
      kuaidiOn: cfg.kuaidiOn !== false,
      kuaidiDeliveryFee: String(cfg.kuaidiDeliveryFee ?? 10),
      minOrderWaimai: String(cfg.minOrderWaimai ?? 88),
      minOrderKuaidi: String(cfg.minOrderKuaidi ?? 100),
      kuaidiOutProvinceDistanceKm: String(cfg.kuaidiOutProvinceDistanceKm ?? 300),
      kuaidiOutDeliveryFee: String(cfg.kuaidiOutDeliveryFee ?? 25),
      minOrderKuaidiOut: String(cfg.minOrderKuaidiOut ?? 140),
      configChanged: false,
      removedBannerFileIds: [],

      subMchId: safeStr(cfg.subMchId),
      payChanged: false,

      phone: safeStr(cfg.phone),
      serviceHours: serviceHoursForSave,
      serviceHoursOriginal: serviceHoursForSave,
      serviceHoursRanges,
      serviceHoursEdited: false,
      kefuQrFileId,
      kefuQrPreview,
      kefuQrLocalPath: '',
      kefuQrRemoved: false,
      contactChanged: false,

      cloudPrinterSn: safeStr(cfg.cloudPrinterSn),
      cloudPrinterUser: safeStr(cfg.cloudPrinterUser),
      cloudPrinterKey: safeStr(cfg.cloudPrinterKey),
      cloudPrinterTimes: safeStr(cfg.cloudPrinterTimes),
      cloudPrintChanged: false,

      sectionOpen: {
        consume: false,
        shopInfo: false,
        deliveryPay: false,
        coupons: false,
        gifts: false,
      },
    });
  },
};
