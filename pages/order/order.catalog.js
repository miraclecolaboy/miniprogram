// pages/order/order.catalog.js
// 点单页：分类/商品加载与列表筛选

const { callUser } = require('../../utils/cloud');
const { toNum } = require('../../utils/common');

const PAGE_SIZE = 20;

module.exports = {
  async loadCatalog() {
    try {
      const [catRes, prodRes] = await Promise.all([
        callUser('listCategories'),
        callUser('listProducts'),
      ]);

      const categories = (catRes?.result?.data || []).map((c) => ({
        id: c._id || c.id,
        name: c.name,
      }));

      // 重建 SKU 库存表，避免旧数据残留
      if (this._skuStockMap && typeof this._skuStockMap.clear === 'function') this._skuStockMap.clear();
      else this._skuStockMap = new Map();

      const rawProducts = (prodRes?.result?.data || []);
      this._products = rawProducts.map((p) => {
        const stock = this._processSkuData(p);
        return {
          ...p,
          id: p._id || p.id,
          modes: (Array.isArray(p.modes) && p.modes.length) ? p.modes : ['ziti', 'waimai', 'kuaidi'],
          stock,
        };
      });

      this._productById = this._products.reduce((map, p) => {
        map[p.id] = p;
        return map;
      }, {});

      const firstCategoryId = categories.length ? categories[0].id : '';
      this.setData({ categories, selectedCategoryId: firstCategoryId }, () => this._filterAndRenderProducts());
    } catch (e) {
      console.error('[order] loadCatalog error', e);
      this.setData({ categories: [{ id: 'error', name: '加载异常' }], filteredProducts: [] });
    }
  },

  _processSkuData(product) {
    if (!product?.hasSpecs || !Array.isArray(product.skuList) || product.skuList.length === 0) {
      return toNum(product?.stock, 0);
    }

    let totalStock = 0;
    product.skuList.forEach((sku) => {
      const key = sku.skuKey || sku._id;
      if (!key) return;

      const stock = toNum(sku.stock, 0);
      this._skuStockMap.set(key, {
        stock,
        price: toNum(sku.price, 0),
      });
      totalStock += stock;
    });

    return totalStock;
  },

  selectCategory(e) {
    const id = e.currentTarget.dataset.id;
    if (id !== this.data.selectedCategoryId) {
      this.setData({ selectedCategoryId: id }, () => this._filterAndRenderProducts());
    }
  },

  _filterAndRenderProducts() {
    const { mode, selectedCategoryId } = this.data;
    const products = (this._products || []);

    this._filteredIds = products
      .filter((p) => p.categoryId === selectedCategoryId && Array.isArray(p.modes) && p.modes.includes(mode))
      .map((p) => p.id);

    const initialView = this._filteredIds
      .slice(0, PAGE_SIZE)
      .map((id) => this._mapProductToView(this._productById[id]));

    this.setData({ filteredProducts: initialView });
  },

  onProductsReachBottom() {
    const currentCount = (this.data.filteredProducts || []).length;
    if (currentCount >= this._filteredIds.length) return;

    const nextItems = this._filteredIds
      .slice(currentCount, currentCount + PAGE_SIZE)
      .map((id) => this._mapProductToView(this._productById[id]));

    this.setData({ filteredProducts: [...this.data.filteredProducts, ...nextItems] });
  },
};

