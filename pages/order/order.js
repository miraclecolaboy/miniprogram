// pages/order/order.js
// 点单页：通过“分模块 methods”降低单文件复杂度

const {
  CART_CLEAR: KEY_CART_CLEAR,
  ORDER_MODE: KEY_ORDER_MODE,
} = require('../../utils/storageKeys');

const cartMethods = require('./order.cart');
const catalogMethods = require('./order.catalog');
const specMethods = require('./order.spec');
const shopMethods = require('./order.shop');

Page(Object.assign({
  data: {
    mode: 'ziti',
    kuaidiOn: true,
    storeName: '加载中...',
    notice: '',
    minOrderMap: { ziti: 0, waimai: 88, kuaidi: 100 },
    needMoreFreeDelivery: 0,
    categories: [],
    selectedCategoryId: '',
    selectedCategoryName: '',
    filteredProducts: [],
    totalCount: 0,
    totalPrice: '0.00',
    checkoutBtnText: '去结算',
    checkoutDisabled: true,
    checkoutActive: false,
    showCartDetailFlag: false,
    cart: [],
    showSpecPopup: false,
    specProduct: null,
    specSelectedSpecs: {},
    specQuantity: 1,
    specSkuStock: 0,
    specFinalPrice: 0,
    specTotalPrice: '0.00',
    storeLat: 0,
    storeLng: 0,
  },

  _products: [],
  _productById: {},
  _filteredIds: [],
  _cart: new Map(),
  _skuStockMap: new Map(),
  _isPageReady: false,

  async onLoad() {
    await this.initPage();
  },

  onShow() {
    const mark = wx.getStorageSync(KEY_CART_CLEAR);
    if (mark && mark.ts) {
      wx.removeStorageSync(KEY_CART_CLEAR);
      this.clearCart();
    }

    const nextMode = wx.getStorageSync(KEY_ORDER_MODE);
    if (!nextMode || nextMode === this.data.mode) return;

    wx.removeStorageSync(KEY_ORDER_MODE);
    if (nextMode === 'kuaidi' && this.data.kuaidiOn === false) {
      wx.showToast({ title: '快递暂未开放', icon: 'none' });
      return;
    }

    if (this._isPageReady) {
      this.setData({ mode: nextMode }, () => {
        this._filterAndRenderProducts();
        this._render();
      });
    } else {
      this.setData({ mode: nextMode });
    }
  },

  async initPage() {
    await Promise.all([this.loadShopConfig(), this.loadCatalog()]);
    this._render();
    this._isPageReady = true;
  },
}, cartMethods, catalogMethods, specMethods, shopMethods));
