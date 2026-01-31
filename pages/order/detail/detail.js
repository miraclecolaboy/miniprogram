// pages/order/detail/detail.js

// --- 辅助函数 ---
const { toNum } = require('../../../utils/common');
const { resolveCloudFileList } = require('../../../utils/cloudFile');
const { buildSkuKey, buildSpecText, getDefaultSelectedSpecs } = require('../../../utils/sku');

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
    currentStock: 0, // 当前可选规格的可用库存
    imgList: [],
    swiperAutoplay: false,
    swiperCurrent: 0,
  },

  // [新] 内部状态，不放入 data
  _skuMap: new Map(), // Key: skuKey, Value: {price, stock}
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
        
        // [新] 预处理 SKU 数据，构建快速查找的 Map
        this._buildSkuMap(product.skuList);

        const specSelected = product.hasSpecs ? getDefaultSelectedSpecs(product.specs) : {};
      
      // 1. 优先渲染骨架（不含图片）
      this.setData({
        product: { ...product, img: '', imgs: [] }, // 清空图片，避免旧图闪烁
        specSelected,
        quantity: 1,
      }, () => {
        // 2. 异步加载并填充图片
        this._resolveImages(product.imgs);
        // 3. 计算初始价格和库存
        this.updatePriceAndStock();
      });
    });
  },

  // ========================================================
  // [核心改造] 价格与库存计算
  // ========================================================

  /**
   * [核心改造] 统一更新价格和库存
   */
  updatePriceAndStock() {
    const { product, specSelected, quantity } = this.data;
    if (!product) return;

    const skuInfo = this._getSkuInfo(specSelected);
    const price = skuInfo.price;
    const stock = skuInfo.stock;

    this.setData({
      finalPrice: Number(price.toFixed(2)),
      totalPrice: (price * quantity).toFixed(2),
      currentStock: stock,
    });
  },

  /**
   * [新] 根据当前选择的规格，获取对应的SKU信息
   * @param {object} selectedSpecs - e.g., { "尺寸": "大杯", "温度": "冰" }
   * @returns {{price: number, stock: number}}
   */
  _getSkuInfo(selectedSpecs) {
    const { product } = this.data;
    if (!product) return { price: 0, stock: 0 };

    if (!product.hasSpecs) {
      return {
        price: toNum(product.price, 0),
        stock: toNum(product.stock, 0)
      };
    }
    
    const skuKey = this._getSkuKey(product.id, selectedSpecs);
    return this._skuMap.get(skuKey) || { price: 0, stock: 0 };
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
   * [新] 将 skuList 转换成 Map 结构，便于快速查找
   */
  _buildSkuMap(skuList) {
    this._skuMap.clear();
    if (!Array.isArray(skuList)) return;

    skuList.forEach(sku => {
      const key = sku.skuKey || sku._id;
      if (key) {
        this._skuMap.set(key, {
          price: toNum(sku.price, 0),
          stock: toNum(sku.stock, 0),
        });
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
    }, () => this.updatePriceAndStock());
  },

  increaseQty() {
    const { quantity, currentStock } = this.data;
    if (quantity + 1 > currentStock) {
      wx.showToast({ title: '库存不足', icon: 'none' });
      return;
    }
    this.setData({ quantity: quantity + 1 }, () => this.updatePriceAndStock());
  },

  decreaseQty() {
    if (this.data.quantity > 1) {
      this.setData({ quantity: this.data.quantity - 1 }, () => this.updatePriceAndStock());
    }
  },

  confirmAdd() {
    const { product, specSelected, finalPrice, quantity, currentStock } = this.data;
    if (!product || !this._openerChannel) return;

    if (quantity > currentStock) {
      wx.showToast({ title: '库存不足', icon: 'none' });
      return;
    }

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
