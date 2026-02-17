
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
    return list;
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
  },

  _skuPriceMap: new Map(),
  _openerChannel: null,

  onLoad() {
    this._openerChannel = this.getOpenerEventChannel();
    if (!this._openerChannel || !this._openerChannel.on) {
      console.error('[detail] cannot get EventChannel');
      wx.showToast({ title: '页面加载错误', icon: 'none' });
      return;
    }

    this._openerChannel.on('initProduct', (data) => {
      const product = data && data.product;
      if (!product) return;

      this._buildSkuPriceMap(product.skuList);
      const specSelected = product.hasSpecs ? getDefaultSelectedSpecs(product.specs) : {};

      this.setData({
        product: { ...product, img: '', imgs: [] },
        specSelected,
        quantity: 1,
      }, () => {
        this._resolveImages(product.imgs);
        this.updatePrice();
      });
    });
  },

  updatePrice() {
    const { product, specSelected, quantity } = this.data;
    if (!product) return;

    const price = this._getSkuPrice(specSelected);
    this.setData({
      finalPrice: Number(price.toFixed(2)),
      totalPrice: (price * quantity).toFixed(2),
    });
  },

  _getSkuPrice(selectedSpecs) {
    const { product } = this.data;
    if (!product) return 0;
    if (!product.hasSpecs) return toNum(product.price, 0);

    const skuKey = this._getSkuKey(product.id, selectedSpecs);
    return toNum(this._skuPriceMap.get(skuKey), toNum(product.price, 0));
  },

  _getSkuKey(productId, selectedSpecs) {
    const { product } = this.data;
    if (!product) return String(productId || '');
    return buildSkuKey(productId, product.specs, selectedSpecs);
  },

  _buildSkuPriceMap(skuList) {
    this._skuPriceMap.clear();
    if (!Array.isArray(skuList)) return;
    skuList.forEach((sku) => {
      const key = sku.skuKey || sku._id;
      if (key) this._skuPriceMap.set(key, toNum(sku.price, 0));
    });
  },

  async _resolveImages(rawImgList) {
    const list = await resolveCloudImgList(rawImgList);
    if (!list.length) return;
    this.setData({
      'product.img': list[0],
      imgList: list,
    });
  },

  selectSpec(e) {
    const { group, option } = e.currentTarget.dataset;
    this.setData({
      [`specSelected.${group}`]: option,
      quantity: 1,
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
    if (this.data.quantity <= 1) return;
    this.setData({ quantity: this.data.quantity - 1 }, () => this.updatePrice());
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
  },
});
