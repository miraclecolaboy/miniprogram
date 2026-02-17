const { isLoginOK } = require('../../utils/auth');
const { CART_CLEAR: KEY_CART_CLEAR } = require('../../utils/storageKeys');
const { getShopConfigCache } = require('../../utils/shopConfigCache');

const CACHED_SHOP_CFG = getShopConfigCache() || {};

const cartMethods = require('./checkout.cart');
const locationMethods = require('./checkout.location');
const shopMethods = require('./checkout.shop');
const payMethods = require('./checkout.pay');
const syncMethods = require('./checkout.sync');

Page(Object.assign({
  data: {
    mode: 'ziti', 
    storeSubMode: 'ziti', 
    
    isMenuExpanded: false,
    
    storeName: CACHED_SHOP_CFG.storeName || '',
    waimaiOn: CACHED_SHOP_CFG.waimaiOn !== false,
    kuaidiOn: CACHED_SHOP_CFG.kuaidiOn !== false,
    storeAddress: '', 
    address: null,
    distance: '',
    distanceUnit: 'km',
    kuaidiOutProvinceDistanceKm: Number(CACHED_SHOP_CFG.kuaidiOutProvinceDistanceKm ?? 300),
    kuaidiOutDeliveryFee: Number(CACHED_SHOP_CFG.kuaidiOutDeliveryFee ?? 25),
    minOrderKuaidiOut: Number(CACHED_SHOP_CFG.minOrderKuaidiOut ?? 140),
    
    cart: [],
    totalPrice: '0.00',
    finalPay: '0.00',
    deliveryFee: '0.00',
    vipDiscount: '0.00',
    vipPreviewDiscount: '0.00',
    couponDiscount: '0.00',
    discountTotal: '0.00',
    needMoreFreeDelivery: '0.00',
    
    pickupTime: '立即取餐',
    timeList: [],
    remark: '',
    reservePhone: '',
    
    paying: false,
    
    selectedCoupon: null,
    selectedCouponKey: '',
    availableCoupons: [], 
    showCouponPopup: false,
    isVip: false
  },

  _initPromise: null,

  async onLoad(options) {
    this._initPromise = (async () => {
      const rawMode = options.mode || 'ziti';
      const mode = ['waimai', 'kuaidi'].includes(rawMode) ? rawMode : 'ziti';
      const rawSub = options.storeSubMode || 'ziti';
      const storeSubMode = (mode === 'ziti' && rawSub === 'tangshi') ? 'tangshi' : 'ziti';

      const cachedCfg = getShopConfigCache() || {};
      this.setData({ mode, storeSubMode, storeName: cachedCfg.storeName || '' });

      this.syncUserFromStorage();
      
      if (options.cart) {
        try { 
          this.initCart(JSON.parse(decodeURIComponent(options.cart))); 
        } catch (e) { 
          this.initCart([]); 
        }
      } else {
        this.initCart([]);
      }

      this.genPickupTimes();
      await this.loadShopConfig(); 
      
      if (mode === 'waimai' || mode === 'kuaidi') {
        this.syncDefaultAddressFromStorage(false);
      } else {
        await this.refreshDistance(false);
      }
      
      await this.syncUserAndCoupons();
    })();
    
    await this._initPromise;
  },

  async onShow() {
    const clearMark = wx.getStorageSync(KEY_CART_CLEAR);
    if (clearMark && clearMark.ts) {
      wx.removeStorageSync(KEY_CART_CLEAR);
      wx.navigateBack();
      return;
    }
    
    this.syncUserFromStorage();
    this.recheckAddressForMode(false);
  },

  genPickupTimes() {
    const now = new Date();
    let start = new Date(now.getTime() + 15 * 60 * 1000);
    
    let minutes = start.getMinutes();
    let remainder = minutes % 10;
    if (remainder !== 0) {
      start.setMinutes(minutes + (10 - remainder));
    }
    start.setSeconds(0);
    start.setMilliseconds(0);

    const times = ['立即取餐'];
    
    for (let i = 0; i < 18; i++) {
       let t = new Date(start.getTime() + i * 10 * 60 * 1000);
       
       let hh = t.getHours().toString().padStart(2, '0');
       let mm = t.getMinutes().toString().padStart(2, '0');
       
       times.push(`${hh}:${mm}`);
    }
    
    this.setData({ timeList: times });
  },

  toggleMenuExpand() {
    this.setData({ isMenuExpanded: !this.data.isMenuExpanded });
  },
  
  showPriceDetail() {
    const { totalPrice, deliveryFee, vipDiscount, couponDiscount } = this.data;
    const modeName = this.data.mode === 'kuaidi' ? '运费' : '配送费';
    wx.showModal({
      title: '费用明细',
      content: `商品总额: ¥${totalPrice}\n${modeName}: +¥${deliveryFee}\n会员优惠: -¥${vipDiscount}\n优惠券: -¥${couponDiscount}`,
      showCancel: false,
      confirmText: '确定'
    });
  },

  noop() {}

}, cartMethods, locationMethods, shopMethods, payMethods, syncMethods));
