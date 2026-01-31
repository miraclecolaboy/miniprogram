// pages/checkout/checkout.js
// 结算页：通过“分模块 methods”降低单文件复杂度

const { isLoginOK } = require('../../utils/auth');
const { CART_CLEAR: KEY_CART_CLEAR } = require('../../utils/storageKeys');
const { storeSubModeText } = require('./checkout.helpers');

const cartMethods = require('./checkout.cart');
const locationMethods = require('./checkout.location');
const shopMethods = require('./checkout.shop');
const payMethods = require('./checkout.pay');
const syncMethods = require('./checkout.sync');

Page(Object.assign({
  data: {
    mode: 'ziti',
    modeText: '自提',
    storeSubMode: 'ziti', // 到店：堂食(tangshi) / 自提(ziti)
    kuaidiOn: true,
    storeName: '',
    storeLat: 0,
    storeLng: 0,
    waimaiMaxKm: 10,
    waimaiDeliveryFee: 8,
    kuaidiDeliveryFee: 10,
    minOrderWaimai: 88,
    minOrderKuaidi: 88,
    distance: '位置',
    distanceUnit: '',
    pickupTime: '立即取餐',
    timeList: [],
    serviceHours: '',
    isVip: false,
    memberLevel: 0,
    vipDiscount: '0.00',
    cart: [],
    totalPrice: '0.00',
    deliveryFee: '0.00',
    finalPay: '0.00',
    freeDeliveryLine: '0.00',
    needMoreFreeDelivery: '0.00',
    points: 0,
    paySheetVisible: false,
    payMethod: 'wechat',
    payMethodText: '微信支付',
    balance: 0,
    balanceText: '0.00',
    remark: '',
    address: null,
    paying: false,

    // 优惠券相关
    userCoupons: [],
    availableCoupons: [],
    selectedCoupon: null,
    couponDiscount: '0.00',
  },

  _initPromise: null,
  _chooseAddrToken: null,
  _chooseAddrEventToken: null,

  async onLoad(options) {
    this._initPromise = (async () => {
      const mode = options.mode || 'ziti';
      const rawStoreSubMode = String(options.storeSubMode || '').trim();
      const storeSubMode = ['tangshi', 'ziti'].includes(rawStoreSubMode) ? rawStoreSubMode : 'ziti';
      const modeText = mode === 'waimai' ? '外卖' : (mode === 'kuaidi' ? '快递' : storeSubModeText(storeSubMode));
      this.setData({ mode, modeText, storeSubMode });

      this.syncUserFromStorage();
      if (mode !== 'waimai') this.syncDefaultAddressFromStorage(false);

      if (options.cart) {
        try { this.initCart(JSON.parse(decodeURIComponent(options.cart))); } catch (e) { this.initCart([]); }
      } else {
        this.initCart([]);
      }

      this.genPickupTimes();
      await this.loadShopConfig();
      if (this.data.mode === 'waimai') this.syncDefaultAddressFromStorage(false);
      this.recheckAddressForMode(false);
      await this.refreshDistance(false);
      await this.syncUserAndCoupons();
      this.applyDefaultPayMethod();
    })();

    await this._initPromise;
  },

  async onShow() {
    const clearMark = wx.getStorageSync(KEY_CART_CLEAR);
    if (clearMark && clearMark.ts) {
      wx.removeStorageSync(KEY_CART_CLEAR);
      wx.navigateBack(); // 如果是从支付成功页返回，直接回到上一页
      return;
    }

    this.syncUserFromStorage();
    const token = this._chooseAddrToken;
    const needFallback = !!token && this._chooseAddrEventToken !== token;
    this._chooseAddrToken = null;
    this._chooseAddrEventToken = null;

    await this.loadShopConfig();

    if (needFallback) this.syncDefaultAddressFromStorage(true);
    else this.syncDefaultAddressFromStorage(false);

    this.recheckAddressForMode(false);

    if (isLoginOK()) {
      await this.syncUserAndCoupons();
    }
  },

}, cartMethods, locationMethods, shopMethods, payMethods, syncMethods));
