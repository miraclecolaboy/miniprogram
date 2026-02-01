// packages/admin/pages/shop/shop.core.js

const { requireLogin, getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { parseServiceHoursRanges } = require('../../../../utils/serviceHours');
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
  },

  async init() {
    await Promise.allSettled([this.loadConfig(), this.loadGifts()]);
    this.loadCoupons();
  },

  async onReload() {
    await this.init();
    wx.showToast({ title: '已刷新', icon: 'success' });
  },

  async loadConfig() {
    const session = getSession();
    if (!session?.token) return;

    const r = await call('admin', { action: 'shop_getConfig', token: session.token }).catch(() => null);
    if (!r?.ok) return;

    const cfg = r.data || {};

    // 处理图片资源
    const kefuQrFileId = safeStr(cfg.kefuQrUrl);
    const bannerIds = Array.isArray(cfg.banners) ? cfg.banners : [];

    // 批量换取临时链接
    const allIds = [...(kefuQrFileId ? [kefuQrFileId] : []), ...bannerIds];
    const urlMap = await getTempUrlMap(allIds);

    const kefuQrPreview = kefuQrFileId ? (urlMap[kefuQrFileId] || '') : '';
    const banners = bannerIds.map((fid) => ({
      fileId: fid,
      preview: urlMap[fid] || '',
    }));

    const serviceHoursText = safeStr(cfg.serviceHours);
    const parsedServiceRanges = parseServiceHoursRanges(serviceHoursText);
    const serviceHoursRanges = (parsedServiceRanges && parsedServiceRanges.length)
      ? parsedServiceRanges.map(rangeToServiceHoursInput)
      : [emptyServiceHoursRange()];

    this.setData({
      notice: safeStr(cfg.notice),
      noticeChanged: false,

      banners,

      waimaiMaxKm: Number(cfg.waimaiMaxKm ?? 10),
      waimaiDeliveryFee: String(cfg.waimaiDeliveryFee ?? 8),
      kuaidiOn: cfg.kuaidiOn !== false,
      kuaidiDeliveryFee: String(cfg.kuaidiDeliveryFee ?? 10),
      minOrderWaimai: String(cfg.minOrderWaimai ?? 88),
      minOrderKuaidi: String(cfg.minOrderKuaidi ?? 88),
      configChanged: false,

      subMchId: safeStr(cfg.subMchId),
      payChanged: false,

      phone: safeStr(cfg.phone),
      serviceHours: serviceHoursText,
      serviceHoursOriginal: serviceHoursText,
      serviceHoursRanges,
      serviceHoursEdited: false,
      kefuQrFileId,
      kefuQrPreview,
      contactChanged: false,

      cloudPrinterSn: safeStr(cfg.cloudPrinterSn),
      cloudPrinterUser: safeStr(cfg.cloudPrinterUser),
      cloudPrinterKey: safeStr(cfg.cloudPrinterKey),
      cloudPrinterTimes: safeStr(cfg.cloudPrinterTimes),
      cloudPrintChanged: false,
    });
  },
};

