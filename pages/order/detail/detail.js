// pages/order/detail/detail.js

// --- 辅助函数 ---
const { toNum } = require('../../../utils/common');
const { resolveCloudFileList } = require('../../../utils/cloudFile');
const { buildSkuKey, buildSpecText, getDefaultSelectedSpecs } = require('../../../utils/sku');

const MAX_ITEM_QTY = 99;

async function resolveCloudImgList(imgList) {
  const list = Array.isArray(imgList) ? imgList : [];
  if (!list.length) return [];

  try {
    return await resolveCloudFileList(list);
  } catch (e) {
    console.error('[detail] resolveCloudImgList error', e);
    return list; // 失败时返回原始列表
  }
}


Page({
  data: {
    product: null,
    specSelected: {},
    quantity: 1,
    finalPrice: 0,
    totalPrice: '0.00',
    imgList: [],
    swiperAutoplay: false,
    swiperCurrent: 0,
  },

  // [新] 内部状态，不放入 data
  _skuPriceMap: new Map(), // Key: skuKey, Value: price
  _openerChannel: null,

  // ========================================================
  // 生命周期函数
  // ========================================================

  onLoad() {
    this._openerChannel = this.getOpenerEventChannel();
    if (!this._openerChannel || !this._openerChannel.on) {
      console.error("无法获取 EventChannel");
      wx.showToast({ title: '页面加载错误', icon: 'none' });
      return;
    }

      this._openerChannel.on('initProduct', (data) => {
        const product = data && data.product;
        if (!product) return;
        
        // 预处理 SKU 数据，构建快速查找的 Map（仅价格）
        this._buildSkuPriceMap(product.skuList);

        const specSelected = product.hasSpecs ? getDefaultSelectedSpecs(product.specs) : {};
      
      // 1. 优先渲染骨架（不含图片）
      this.setData({
        product: { ...product, img: '', imgs: [] }, // 清空图片，避免旧图闪烁
        specSelected,
        quantity: 1,
      }, () => {
        // 2. 异步加载并填充图片
        this._resolveImages(product.imgs);
        // 3. 计算初始价格
        this.updatePrice();
      });
    });
  },

  // ========================================================
  // 价格计算
  // ========================================================

  /**
   * 统一更新价格
   */
  updatePrice() {
    const { product, specSelected, quantity } = this.data;
    if (!product) return;

    const price = this._getSkuPrice(specSelected);

    this.setData({
      finalPrice: Number(price.toFixed(2)),
      totalPrice: (price * quantity).toFixed(2),
    });
  },

  /**
   * 根据当前选择的规格，获取对应的SKU价格
   * @param {object} selectedSpecs - e.g., { "尺寸": "大杯", "温度": "冰" }
   * @returns {number}
   */
  _getSkuPrice(selectedSpecs) {
    const { product } = this.data;
    if (!product) return 0;

    if (!product.hasSpecs) {
      return toNum(product.price, 0);
    }
    
    const skuKey = this._getSkuKey(product.id, selectedSpecs);
    return toNum(this._skuPriceMap.get(skuKey), toNum(product.price, 0));
  },

  /**
   * [新] 根据商品ID和规格选项，生成唯一的 skuKey
   */
  _getSkuKey(productId, selectedSpecs) {
    const { product } = this.data;
    if (!product) return String(productId || '');
    return buildSkuKey(productId, product.specs, selectedSpecs);
  },

  /**
   * 将 skuList 转换成 Map 结构，便于快速查找
   */
  _buildSkuPriceMap(skuList) {
    this._skuPriceMap.clear();
    if (!Array.isArray(skuList)) return;

    skuList.forEach(sku => {
      const key = sku.skuKey || sku._id;
      if (key) {
        this._skuPriceMap.set(key, toNum(sku.price, 0));
      }
    });
  },

  // ========================================================
  // 图片加载与轮播
  // ========================================================

  async _resolveImages(rawImgList) {
    const list = await resolveCloudImgList(rawImgList);
    if (list.length === 0) return;

    const currentProduct = this.data.product;
    this.setData({
      'product.img': list[0], // 更新封面
      imgList: list,
    });
    
    if (list.length > 1) {
      this._initLightAutoplay();
    }
  },

  _initLightAutoplay() {
    this.setData({ swiperAutoplay: true, swiperCurrent: 0 });
    // 自动轮播两次后停止
    this._autoplayCounter = 2; 
  },

  onSwiperChange(e) {
    const { current, source } = e.detail;
    this.setData({ swiperCurrent: current });

    if (source === 'autoplay') {
      this._autoplayCounter = (this._autoplayCounter || 0) - 1;
      if (this._autoplayCounter <= 0) {
        this.setData({ swiperAutoplay: false });
      }
    } else if (source === 'touch') {
      this.setData({ swiperAutoplay: false });
    }
  },
  
  // ========================================================
  // 事件处理
  // ========================================================

  selectSpec(e) {
    const { group, option } = e.currentTarget.dataset;
    this.setData({
      [`specSelected.${group}`]: option,
      quantity: 1, // 切换规格时重置数量为1
    }, () => this.updatePrice());
  },

  increaseQty() {
    const { quantity } = this.data;
    if (quantity + 1 > MAX_ITEM_QTY) {
      wx.showToast({ title: `最多购买${MAX_ITEM_QTY}件`, icon: 'none' });
      return;
    }
    this.setData({ quantity: quantity + 1 }, () => this.updatePrice());
  },

  decreaseQty() {
    if (this.data.quantity > 1) {
      this.setData({ quantity: this.data.quantity - 1 }, () => this.updatePrice());
    }
  },

  confirmAdd() {
    const { product, specSelected, finalPrice, quantity } = this.data;
    if (!product || !this._openerChannel) return;

    const specText = product.hasSpecs ? buildSpecText(product.specs, specSelected) : '';

    this._openerChannel.emit('confirmSpec', {
      id: product.id,
      selectedSpecs: product.hasSpecs ? specSelected : null,
      specText,
      quantity,
      finalPrice,
    });

    wx.navigateBack();
  }
});
