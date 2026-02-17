
const { callUser } = require('../../utils/cloud');
const { toNum } = require('../../utils/common');

const PAGE_SIZE = 20;

module.exports = {
  async loadCatalog() {
    this.setData({ catalogLoading: true });
    try {
      const [catRes, prodRes] = await Promise.all([
        callUser('listCategories'),
        callUser('listProducts'),
      ]);

      const categories = (catRes?.result?.data || []).map((c) => ({
        id: c._id || c.id,
        name: c.name,
      }));

      if (this._skuPriceMap && typeof this._skuPriceMap.clear === 'function') this._skuPriceMap.clear();
      else this._skuPriceMap = new Map();

      const rawProducts = (prodRes?.result?.data || []);
      this._products = rawProducts.map((p) => {
        this._indexSkuPrices(p);
        return {
          ...p,
          id: p._id || p.id,
          modes: (Array.isArray(p.modes) && p.modes.length) ? p.modes : ['ziti', 'waimai', 'kuaidi'],
        };
      });

      this._productById = this._products.reduce((map, p) => {
        map[p.id] = p;
        return map;
      }, {});

      const firstCategoryId = categories.length ? categories[0].id : '';
      const firstCategoryName = categories.length ? (categories[0].name || '') : '';
      this.setData({ categories, selectedCategoryId: firstCategoryId, selectedCategoryName: firstCategoryName }, () => this._filterAndRenderProducts());
    } catch (e) {
      console.error('[order] loadCatalog error', e);
      this.setData({
        categories: [{ id: 'error', name: '加载异常' }],
        selectedCategoryId: 'error',
        selectedCategoryName: '加载异常',
        filteredProducts: [],
      });
    } finally {
      this.setData({ catalogLoading: false });
    }
  },

  _indexSkuPrices(product) {
    if (!product?.hasSpecs || !Array.isArray(product.skuList) || product.skuList.length === 0) return;

    product.skuList.forEach((sku) => {
      const key = sku.skuKey || sku._id;
      if (!key) return;
      this._skuPriceMap.set(key, toNum(sku.price, 0));
    });
  },

  selectCategory(e) {
    const id = e.currentTarget.dataset.id;
    if (id !== this.data.selectedCategoryId) {
      const name = (this.data.categories || []).find(c => c.id === id)?.name || '';
      const nextSeed = (Number(this.data.productAnimSeed) || 0) + 1;
      this.setData({ selectedCategoryId: id, selectedCategoryName: name, productAnimSeed: nextSeed }, () => this._filterAndRenderProducts());
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
      .map((id, idx) => this._mapProductToView(this._productById[id], idx));

    this.setData({ filteredProducts: initialView });
  },

  onProductsReachBottom() {
    const currentCount = (this.data.filteredProducts || []).length;
    if (currentCount >= this._filteredIds.length) return;

    const nextItems = this._filteredIds
      .slice(currentCount, currentCount + PAGE_SIZE)
      .map((id, idx) => this._mapProductToView(this._productById[id], currentCount + idx));

    this.setData({ filteredProducts: [...this.data.filteredProducts, ...nextItems] });
  },
};
