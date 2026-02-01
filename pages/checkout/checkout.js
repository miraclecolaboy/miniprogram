// pages/checkout/checkout.js
const { isLoginOK } = require('../../utils/auth');
const { CART_CLEAR: KEY_CART_CLEAR } = require('../../utils/storageKeys');

// 引入子模块保持不变
const cartMethods = require('./checkout.cart');
const locationMethods = require('./checkout.location');
const shopMethods = require('./checkout.shop');
const payMethods = require('./checkout.pay');
const syncMethods = require('./checkout.sync');

Page(Object.assign({
  data: {
    // 核心模式: 'ziti' (门店自提) | 'waimai' (外卖配送)
    mode: 'ziti', 
    // 自提子模式: 'ziti'(打包) | 'tangshi'(堂食)
    storeSubMode: 'ziti', 
    
    // UI状态
    isMenuExpanded: false,
    
    // 基础数据
    storeName: '',
    storeAddress: '', 
    address: null,
    distance: '',
    distanceUnit: 'km',
    
    // 购物车与费用
    cart: [],
    totalPrice: '0.00',
    finalPay: '0.00',
    deliveryFee: '0.00',
    vipDiscount: '0.00',
    couponDiscount: '0.00',
    needMoreFreeDelivery: '0.00',
    
    // 选项
    pickupTime: '立即取餐',
    timeList: [],
    remark: '',
    
    // 支付状态
    paying: false,
    
    // 权益
    selectedCoupon: null,
    availableCoupons: [], 
    isVip: false
  },

  _initPromise: null,

  async onLoad(options) {
    this._initPromise = (async () => {
      // 1. 初始化模式
      const rawMode = options.mode || 'ziti';
      const mode = ['waimai', 'kuaidi'].includes(rawMode) ? rawMode : 'ziti';
      const rawSub = options.storeSubMode || 'ziti';
      const storeSubMode = (mode === 'ziti' && rawSub === 'tangshi') ? 'tangshi' : 'ziti';

      this.setData({ mode, storeSubMode });

      // 2. 加载用户与购物车
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

      // 3. 生成时间 & 加载店铺
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
    // 检查是否有清理标记 (支付成功返回)
    const clearMark = wx.getStorageSync(KEY_CART_CLEAR);
    if (clearMark && clearMark.ts) {
      wx.removeStorageSync(KEY_CART_CLEAR);
      wx.navigateBack();
      return;
    }
    
    this.syncUserFromStorage();
    this.recheckAddressForMode(false);
  },

  // --- 1. 时间生成逻辑 (每10分钟一档) ---
  genPickupTimes() {
    const now = new Date();
    // 基础缓冲：当前时间 + 15分钟准备时间
    let start = new Date(now.getTime() + 15 * 60 * 1000);
    
    // 向上取整到最近的 10 分钟 (例如 10:03 -> 10:10, 10:12 -> 10:20)
    let minutes = start.getMinutes();
    let remainder = minutes % 10;
    if (remainder !== 0) {
      start.setMinutes(minutes + (10 - remainder));
    }
    // 秒数清零
    start.setSeconds(0);
    start.setMilliseconds(0);

    const times = ['立即取餐'];
    
    // 生成未来 3 小时的时间段 (约18个刻度)
    for (let i = 0; i < 18; i++) {
       let t = new Date(start.getTime() + i * 10 * 60 * 1000);
       
       let hh = t.getHours().toString().padStart(2, '0');
       let mm = t.getMinutes().toString().padStart(2, '0');
       
       times.push(`${hh}:${mm}`);
    }
    
    this.setData({ timeList: times });
  },

  // --- 2. 优惠券选择逻辑 (跳转页面) ---
  onSelectCoupon() {
    const that = this;
    // 跳转到优惠券页面，标记 from=checkout
    wx.navigateTo({
      url: '/pages/mine/coupon/index?from=checkout&select=1', 
      
      events: {
        // 监听：在优惠券页面触发 'acceptSelectedCoupon'
        acceptSelectedCoupon: function(couponData) {
          console.log('Checkout页收到优惠券:', couponData);
          
          // 如果 couponData 为 null，表示不使用/取消选择
          that.setData({ 
            selectedCoupon: couponData 
          }, () => {
            // 选完后重新计算购物车总价
            if (that.recalcCart) {
              that.recalcCart(); 
            }
          });
        }
      }
    });
  },
  
  // --- UI 交互 ---

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
  }

}, cartMethods, locationMethods, shopMethods, payMethods, syncMethods));
