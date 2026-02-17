
const { toNum } = require('../../utils/common');
const { getCartKey } = require('./order.helpers');

const MAX_ITEM_QTY = 99;

module.exports = {
  _render() {
    const { mode, minOrderMap } = this.data;

    let totalCount = 0;
    let totalPriceNum = 0;
    const cartList = [];

    for (const item of this._cart.values()) {
      if (item.modes && !item.modes.includes(mode)) continue;

      const count = item.count;
      const price = toNum(item.price, 0);
      totalCount += count;
      totalPriceNum += price * count;

      cartList.push({
        ...item,
        cartKey: getCartKey(item),
        total: (price * count).toFixed(2),
      });
    }

    const min = toNum(minOrderMap[mode], 0);
    const minDiff = min > 0 ? (min - totalPriceNum) : 0;

    let checkoutDisabled = totalCount === 0;
    let checkoutBtnText = '去结算';
    if (mode === 'ziti' && min > 0 && totalPriceNum < min) {
      checkoutDisabled = true;
      checkoutBtnText = totalCount > 0 ? `满${min}元可结算` : '去结算';
    } else if (totalCount === 0) {
      checkoutDisabled = true;
    }

    const updatedProducts = (this.data.filteredProducts || []).map((p, idx) =>
      this._productById[p.id] ? this._mapProductToView(this._productById[p.id], idx, p) : p
    );

    this.setData({
      filteredProducts: updatedProducts,
      cart: cartList.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
      totalCount,
      totalPrice: totalPriceNum.toFixed(2),
      checkoutDisabled,
      checkoutBtnText,
      needMoreFreeDelivery: (mode !== 'ziti' && minDiff > 0 && totalCount > 0) ? Number(minDiff.toFixed(2)) : 0,
    });
  },

  _updateCartItem(item, quantity) {
    const key = getCartKey(item);
    if (!key) return;

    if (quantity > 0) this._cart.set(key, { ...item, count: quantity });
    else this._cart.delete(key);

    this._render();
  },

  _mapProductToView(product, indexInList, prevView) {
    if (!product) return null;

    let count = 0;

    if (product.hasSpecs) {
      for (const key of this._cart.keys()) {
        if (key.startsWith(product.id + '::')) count += (this._cart.get(key).count || 0);
      }
    } else {
      const cartItem = this._cart.get(product.id);
      count = cartItem ? cartItem.count : 0;
    }

    const seed = Number(this.data.productAnimSeed) || 0;
    const idx = Number.isFinite(Number(indexInList)) ? Number(indexInList) : 0;
    const clamped = Math.min(Math.max(0, idx), 7);

    return {
      id: product.id,
      name: product.name,
      img: product.img,
      thumbUrl: product.thumbUrl,
      desc: product.desc,
      price: product.price,
      priceWithSpec: product.price,
      hasSpecs: product.hasSpecs,
      modes: product.modes,
      count,
      animKey: (prevView && prevView.animKey) ? prevView.animKey : `${product.id}__${seed}`,
      animDelay: (prevView && prevView.animDelay) ? prevView.animDelay : `${(clamped * 0.04).toFixed(2)}s`,
    };
  },

  addToCart(e) {
    const id = e.currentTarget.dataset.id;
    const product = this._productById[id];
    if (!product) return;

    if (product.hasSpecs) {
      this.openSpecPopup(e);
      return;
    }

    const cartItem = this._cart.get(id) || { ...product, count: 0, createdAt: Date.now() };
    const nextCount = cartItem.count + 1;
    if (nextCount > MAX_ITEM_QTY) {
      wx.showToast({ title: `最多购买${MAX_ITEM_QTY}件`, icon: 'none' });
      return;
    }

    this._updateCartItem(cartItem, nextCount);
    this._animateCheckoutButton();
  },

  decreaseCount(e) {
    const key = e.currentTarget.dataset.id;
    const cartItem = this._cart.get(key);
    if (cartItem) this._updateCartItem(cartItem, cartItem.count - 1);
  },

  increaseCartItemCount(e) {
    const key = e.currentTarget.dataset.id;
    const cartItem = this._cart.get(key);
    if (!cartItem) return;

    if (cartItem.count + 1 > MAX_ITEM_QTY) {
      wx.showToast({ title: `最多购买${MAX_ITEM_QTY}件`, icon: 'none' });
      return;
    }

    this._updateCartItem(cartItem, cartItem.count + 1);
  },

  clearCart() {
    if (this._cart.size > 0) {
      this._cart.clear();
      this._render();
    }
    this.setData({ showCartDetailFlag: false });
  },

  showCartDetail() { this.setData({ showCartDetailFlag: true }); },
  closeCartDetail() { this.setData({ showCartDetailFlag: false }); },

  _animateCheckoutButton() {
    this.setData({ checkoutActive: true });
    setTimeout(() => this.setData({ checkoutActive: false }), 200);
  },

  goToCart() {
    if (this.data.checkoutDisabled) {
      const min = toNum(this.data.minOrderMap[this.data.mode], 0);
      if (this.data.mode === 'ziti' && min > 0) {
        wx.showToast({ title: `满${min}元才能结算`, icon: 'none' });
      }
      return;
    }

    const cartForCheckout = [...this._cart.values()].filter(item => item.modes.includes(this.data.mode));
    wx.navigateTo({
      url: `/pages/checkout/checkout?cart=${encodeURIComponent(JSON.stringify(cartForCheckout))}&mode=${this.data.mode}`,
    });
  },
};
