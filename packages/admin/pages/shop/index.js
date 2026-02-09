// packages/admin/pages/shop/index.js
// 店铺设置页：按客户端页面的方式拆分 methods，降低单文件复杂度
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
    // 公告
    notice: '',
    noticeChanged: false,

    // 轮播图
    banners: [], // { fileId, preview }

    // 配送
    waimaiMaxKm: 10,
    waimaiDeliveryFee: '8',
    kuaidiOn: true,
    kuaidiDeliveryFee: '10',
    minOrderWaimai: '88',
    minOrderKuaidi: '88',
    configChanged: false,

    // 微信支付（子商户号）
    subMchId: '',
    payChanged: false,

    // 客服信息
    phone: '',
    serviceHours: '',
    serviceHoursOriginal: '',
    serviceHoursRanges: [emptyServiceHoursRange()],
    serviceHoursEdited: false,
    kefuQrFileId: '',
    kefuQrPreview: '',
    contactChanged: false,

    // 云打印配置
    cloudPrinterSn: '',
    cloudPrinterUser: '',
    cloudPrinterKey: '',
    cloudPrinterTimes: '',
    cloudPrintChanged: false,

    // 礼品
    giftForm: { name: '', points: '', desc: '', thumbFileId: '', thumbPreview: '' },
    gifts: [],
    editingGiftId: '',
    editingGiftName: '',

    // 核销
    consumeCode: '',
    consumeTip: '',
     // 优惠券管理 
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
