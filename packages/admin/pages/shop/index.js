// packages/admin/pages/shop/index.js
const { emptyServiceHoursRange } = require('./shop.helpers');

const coreMethods = require('./shop.core');
const noticeMethods = require('./shop.notice');
const configMethods = require('./shop.config');
const payMethods = require('./shop.pay');
const contactMethods = require('./shop.contact');
const cloudPrintMethods = require('./shop.cloudprint');
const giftsMethods = require('./shop.gifts');
const consumeMethods = require('./shop.consume');
const couponMethods = require('./shop.coupons');

Page(Object.assign({
  data: {
    sectionOpen: {
      consume: false,
      shopInfo: false,
      deliveryPay: false,
      coupons: false,
      gifts: false,
    },

    notice: '',
    noticeChanged: false,

    // { key, fileId, preview, localPath? }
    banners: [],
    removedBannerFileIds: [],

    waimaiOn: true,
    waimaiMaxKm: 10,
    waimaiDeliveryFee: '8',
    kuaidiOn: true,
    kuaidiDeliveryFee: '10',
    minOrderWaimai: '88',
    minOrderKuaidi: '100',
    kuaidiOutProvinceDistanceKm: '300',
    kuaidiOutDeliveryFee: '25',
    minOrderKuaidiOut: '140',
    configChanged: false,

    // hidden in UI, retained for compatibility with existing methods
    subMchId: '',
    payChanged: false,

    phone: '',
    serviceHours: '',
    serviceHoursOriginal: '',
    serviceHoursRanges: [emptyServiceHoursRange()],
    serviceHoursEdited: false,
    kefuQrFileId: '',
    kefuQrPreview: '',
    kefuQrLocalPath: '',
    kefuQrRemoved: false,
    contactChanged: false,

    cloudPrinterSn: '',
    cloudPrinterUser: '',
    cloudPrinterKey: '',
    cloudPrinterTimes: '',
    cloudPrintChanged: false,
    cloudPrintStatusOk: false,
    cloudPrintStatusText: '待检测',
    cloudPrintStatusLoading: false,

    giftForm: {
      name: '',
      points: '',
      quantity: '',
      desc: '',
      thumbFileId: '',
      thumbPreview: '',
      thumbLocalPath: '',
    },
    gifts: [],
    editingGiftId: '',
    editingGiftName: '',

    consumeCode: '',
    consumeTip: '',

    coupons: [],
    couponSaving: false,
    editingCouponId: '',
    editingCouponTitle: '',
    couponForm: {
      title: '',
      minSpend: '',
      discount: '',
      totalQuantity: '',
    },
  },
}, coreMethods, noticeMethods, configMethods, payMethods, contactMethods, cloudPrintMethods, giftsMethods, consumeMethods, couponMethods));
