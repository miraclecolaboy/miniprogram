// pages/order/order.spec.js
// 点单页：规格弹窗/详情页回传的加购逻辑

const { toNum } = require('../../utils/common');
const { buildSkuKey, buildSpecText, getDefaultSelectedSpecs } = require('../../utils/sku');

const MAX_ITEM_QTY = 99;

module.exports = {
  async openSpecPopup(e) {
    const id = e?.currentTarget?.dataset?.id;
    const product = this._productById[id];
    if (!product?.hasSpecs) return;

    const specSelectedSpecs = getDefaultSelectedSpecs(product.specs);
    this.setData({
      specProduct: {
        id: product.id,
        name: product.name,
        img: product.img,
        desc: product.desc,
        price: product.price,
        specs: product.specs,
      },
      specSelectedSpecs,
      specQuantity: 1,
      showSpecPopup: true,
    }, () => this.updateSpecData());
  },

  updateSpecData() {
    const { specProduct, specSelectedSpecs, specQuantity } = this.data;
    if (!specProduct) return;

    const skuKey = this._getSkuKey(specProduct.id, specSelectedSpecs);
    const finalPrice = toNum(this._skuPriceMap.get(skuKey), toNum(specProduct.price, 0));
    this.setData({
      specFinalPrice: finalPrice,
      specTotalPrice: (finalPrice * toNum(specQuantity, 1)).toFixed(2),
    });
  },

  _getSkuKey(productId, selectedSpecs) {
    const product = this._productById[productId];
    const specs = (product && Array.isArray(product.specs)) ? product.specs : [];
    return buildSkuKey(productId, specs, selectedSpecs);
  },

  selectSpecOption(e) {
    const group = e.currentTarget.dataset.group;
    const option = e.currentTarget.dataset.option;
    this.setData({
      [`specSelectedSpecs.${group}`]: option,
      specQuantity: 1,
    }, () => this.updateSpecData());
  },

  decreaseSpecQty() {
    if (this.data.specQuantity > 1) {
      this.setData({ specQuantity: this.data.specQuantity - 1 }, () => this.updateSpecData());
    }
  },

  increaseSpecQty() {
    if (this.data.specQuantity + 1 > MAX_ITEM_QTY) {
      wx.showToast({ title: `最多购买${MAX_ITEM_QTY}件`, icon: 'none' });
      return;
    }
    this.setData({ specQuantity: this.data.specQuantity + 1 }, () => this.updateSpecData());
  },

  confirmSpecAdd() {
    const {
      specProduct,
      specSelectedSpecs,
      specQuantity,
      specFinalPrice,
    } = this.data;
    if (!specProduct) return;

    const addQty = toNum(specQuantity, 0);
    if (addQty <= 0) return;

    const baseProduct = this._productById[specProduct.id];
    if (!baseProduct) return;

    const skuKey = this._getSkuKey(baseProduct.id, specSelectedSpecs);

    const cartItem = this._cart.get(skuKey) || {
      ...baseProduct,
      productId: baseProduct.id,
      price: toNum(specFinalPrice, toNum(baseProduct.price, 0)),
      hasSpecs: true,
      specText: buildSpecText(baseProduct.specs, specSelectedSpecs),
      selectedSpecs: specSelectedSpecs,
      skuKey: skuKey,
      count: 0,
      createdAt: Date.now(),
    };

    const nextCount = toNum(cartItem.count, 0) + addQty;
    if (nextCount > MAX_ITEM_QTY) {
      wx.showToast({ title: `最多购买${MAX_ITEM_QTY}件`, icon: 'none' });
      return;
    }

    this._updateCartItem(cartItem, nextCount);
    this.setData({ showSpecPopup: false });
    this._animateCheckoutButton();
  },

  handleSpecConfirm(data) {
    const { id, selectedSpecs, quantity, finalPrice, specText } = data || {};
    const product = this._productById[id];
    if (!product) return;

    const addQty = toNum(quantity, 0);
    if (addQty <= 0) return;

    // 无规格商品也允许从详情页加购
    if (!product.hasSpecs) {
      const cartItem = this._cart.get(product.id) || { ...product, count: 0, createdAt: Date.now() };
      const nextCount = toNum(cartItem.count, 0) + addQty;
      if (nextCount > MAX_ITEM_QTY) {
        wx.showToast({ title: `最多购买${MAX_ITEM_QTY}件`, icon: 'none' });
        return;
      }

      this._updateCartItem(cartItem, nextCount);
      this._animateCheckoutButton();
      return;
    }

    const sel = (selectedSpecs && typeof selectedSpecs === 'object') ? selectedSpecs : {};
    const skuKey = this._getSkuKey(id, sel);
    const fallbackPrice = toNum(finalPrice, toNum(product.price, 0));
    const price = toNum(this._skuPriceMap.get(skuKey), fallbackPrice);

    const cartItem = this._cart.get(skuKey) || {
      ...product,
      productId: product.id,
      price,
      hasSpecs: true,
      specText: specText || buildSpecText(product.specs, sel),
      selectedSpecs: sel,
      skuKey,
      count: 0,
      createdAt: Date.now(),
    };

    const nextCount = toNum(cartItem.count, 0) + addQty;
    if (nextCount > MAX_ITEM_QTY) {
      wx.showToast({ title: `最多购买${MAX_ITEM_QTY}件`, icon: 'none' });
      return;
    }

    this._updateCartItem(cartItem, nextCount);
    this._animateCheckoutButton();
  },

  goDetail(e) {
    const product = this._productById[e.currentTarget.dataset.id];
    if (!product) return;

    wx.navigateTo({
      url: '/pages/order/detail/detail',
      success: (res) => {
        res.eventChannel.emit('initProduct', { product });
        res.eventChannel.on('confirmSpec', (data) => this.handleSpecConfirm(data));
      },
    });
  },

  closeSpecPopup() { this.setData({ showSpecPopup: false }); },
  noop() {},
};
