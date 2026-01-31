// packages/admin/pages/goods/goods.sku.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { toNum } = require('../../../../utils/common');
const { buildSkuKey, buildSpecText } = require('../../../../utils/sku');
const { toInt, buildSkuCombos } = require('./goods.helpers');

module.exports = {
  openSkuModal() {
    const built = buildSkuCombos(this.data.form.specs);
    if (!built.ok) return wx.showToast({ title: built.message, icon: 'none' });

    const skuList = Array.isArray(this.data.form.skuList) ? this.data.form.skuList : [];
    const existedMap = skuList.reduce((map, sku) => {
      map[sku.skuKey] = sku;
      return map;
    }, {});

    const skuItems = built.combos.map((sel) => {
      const skuKey = buildSkuKey(this.data.editingId, this.data.form.specs, sel);
      const old = existedMap[skuKey];
      return {
        skuKey,
        specText: buildSpecText(this.data.form.specs, sel),
        price: old ? String(old.price) : '',
        stock: old ? String(old.stock) : '',
      };
    });

    this.setData({ showSkuModal: true, skuItems });
  },

  closeSkuModal() { this.setData({ showSkuModal: false }); },

  onSkuBulkInput(e) {
    this.setData({ [`skuBulk${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  applySkuBulk(e) {
    const field = e.currentTarget.dataset.field.toLowerCase();
    const value = this.data[`skuBulk${field === 'price' ? 'Price' : 'Stock'}`];
    if (value === '') return;

    const updates = {};
    this.data.skuItems.forEach((it, idx) => {
      if (String(it[field] || '') === '') updates[`skuItems[${idx}].${field}`] = value;
    });
    if (Object.keys(updates).length) this.setData(updates);
  },

  onSkuPriceInput(e) { this.setData({ [`skuItems[${e.currentTarget.dataset.index}].price`]: e.detail.value }); },
  onSkuStockInput(e) { this.setData({ [`skuItems[${e.currentTarget.dataset.index}].stock`]: e.detail.value }); },

  async saveSkuStocks() {
    const skus = [];
    for (const it of this.data.skuItems) {
      const price = toNum(it.price, -1);
      const stock = toInt(it.stock, -1);
      if (price < 0 || stock < 0) {
        return wx.showToast({ title: `“${it.specText}”的价格或库存不合法`, icon: 'none' });
      }
      skus.push({ skuKey: it.skuKey, specText: it.specText, price, stock });
    }

    const editingId = this.data.editingId;
    const isNewTemp = typeof editingId === 'string' && editingId.startsWith('temp_');
    if (isNewTemp) {
      const stock = skus.reduce((sum, sku) => sum + toInt(sku.stock, 0), 0);
      const minPrice = Math.min(...skus.map((sku) => toNum(sku.price, Infinity)));
      const price = isFinite(minPrice) ? minPrice : 0;
      this.setData({ 'form.skuList': skus, 'form.price': Number(price.toFixed(2)), 'form.stock': stock });
      wx.showToast({ title: 'SKU已暂存', icon: 'none' });
      this.closeSkuModal();
      return;
    }

    this.setData({ skuSaving: true });
    try {
      await call('admin', { action: 'product_update_skus', token: getSession().token, productId: editingId, skus });
      const res = await call('admin', { action: 'product_get_for_edit', id: editingId, token: getSession().token });
      const p = res.data || {};
      this.setData({
        'form.price': p.price,
        'form.stock': p.stock,
        'form.skuList': Array.isArray(p.skuList) ? p.skuList : [],
      });
      wx.showToast({ title: 'SKU已保存', icon: 'success' });
      this.closeSkuModal();
    } catch (e) {
      if (e?.code === 'AUTH_EXPIRED') return;
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ skuSaving: false });
    }
  },
};

