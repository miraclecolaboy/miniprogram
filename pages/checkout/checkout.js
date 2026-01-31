// pages/checkout/checkout.js
const { isLoginOK } = require('../../utils/auth');
const { CART_CLEAR: KEY_CART_CLEAR } = require('../../utils/storageKeys');

const cartMethods = require('./checkout.cart');
const locationMethods = require('./checkout.location');
const shopMethods = require('./checkout.shop');
const payMethods = require('./checkout.pay');
const syncMethods = require('./checkout.sync');

Page(Object.assign({
  data: {
    // 核心模式
    mode: 'ziti',         // 'ziti' | 'waimai' (外部传入)
    storeSubMode: 'ziti', // 'tangshi' | 'ziti' (内部切换)
    
    // UI状态
    isCartExpanded: false,

    // 核心业务数据
    cart: [],
    address: null,
    storeName: '',
    distance: '',
    distanceUnit: '',
    pickupTime: '立即取餐',
    timeList: [],
    
    // 价格与优惠
    totalPrice: '0.00',
    deliveryFee: '0.00',
    finalPay: '0.00',
    vipDiscount: '0.00',
    couponDiscount: '0.00',
    needMoreFreeDelivery: '0.00',
    
    // 用户与支付
    isVip: false,
    balance: 0,
    balanceText: '0.00',
    paySheetVisible: false,
    payMethod: 'wechat',
    payMethodText: '微信支付',
    remark: '',
    
    // 优惠券
    selectedCoupon: null,
    availableCouponsCount: 0,
  },

  onLoad(options) {
    // 1. 初始化模式
    const mode = options.mode || 'ziti';
    const subMode = options.storeSubMode || 'ziti';
    this.setData({ mode, storeSubMode: subMode });

    // 2. 初始化购物车
    let cartList = [];
    if (options.cart) {
      try { cartList = JSON.parse(decodeURIComponent(options.cart)); } catch(e){}
    }
    this.initCart(cartList);

    // 3. 异步加载配置、店铺信息、距离
    this.genPickupTimes();
    this.loadShopConfig().then(() => {
      // 只有外卖模式才预加载地址
      if (mode !== 'ziti') this.syncDefaultAddressFromStorage();
      this.refreshDistance();
    });

    // 4. 用户信息
    this.syncUserFromStorage();
    if (isLoginOK()) {
      this.syncUserAndCoupons();
    }
  },

  onShow() {
    // 1. 处理支付成功后的自动返回
    const clearMark = wx.getStorageSync(KEY_CART_CLEAR);
    if (clearMark && clearMark.ts) {
      wx.removeStorageSync(KEY_CART_CLEAR);
      wx.navigateBack();
      return;
    }

    // 2. 刷新用户数据(余额/VIP状态)
    this.syncUserFromStorage();

    // 3. 【关键】处理从优惠券页面选择返回的数据
    const pages = getCurrentPages();
    const curr = pages[pages.length - 1];
    if (curr.data._selectedCouponFromPage !== undefined) {
      const coupon = curr.data._selectedCouponFromPage;
      // 重置标记，避免死循环
      curr.data._selectedCouponFromPage = undefined; 
      
      this.setData({ selectedCoupon: coupon }, () => {
        this.recalcCart();
      });
    }
  },

  // 切换 堂食 / 自提
  switchStoreSubMode(e) {
    const target = e.currentTarget.dataset.sub;
    if (target && target !== this.data.storeSubMode) {
      this.setData({ storeSubMode: target });
      // 如果将来堂食和自提有不同的打包费逻辑，在这里调用 this.recalcCart()
    }
  },

  // 展开/折叠购物车
  toggleCartExpand() {
    this.setData({ isCartExpanded: !this.data.isCartExpanded });
  }

}, cartMethods, locationMethods, shopMethods, payMethods, syncMethods));