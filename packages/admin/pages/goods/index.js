// packages/admin/pages/goods/index.js
const { requireLogin, getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr, toNum } = require('../../../../utils/common');
const { buildSkuKey, buildSpecText } = require('../../../../utils/sku');
// [新增] 引入公共工具，替换本地重复逻辑
const { compressImage, generateThumbnail } = require('../../../../utils/uploader');

let keywordTimer = null;

// --- 辅助函数 ---
function toInt(v, d = 0) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function normalizeModes(modes) { if (Array.isArray(modes) && modes.length) return modes; return ['ziti', 'waimai', 'kuaidi']; }
function modesToText(modes) { const set = new Set(normalizeModes(modes)); const map = { ziti: '到店', waimai: '外卖', kuaidi: '快递' }; return Array.from(set).map(k => map[k] || k).join('/'); }
function specsCountText(specs) { if (!Array.isArray(specs) || !specs.length) return ''; const groups = specs.length; let opts = 0; specs.forEach(g => { opts += (Array.isArray(g.options) ? g.options.length : 0); }); return `${groups}组 ${opts}项`; }
function normalizeSpecsForSku(rawSpecs) { const specs = Array.isArray(rawSpecs) ? rawSpecs : []; return specs.map(g => { const name = String(g?.name || '').trim(); const labels = (g.options || []).map(o => String(o?.label || '').trim()).filter(Boolean); return { name, labels }; }).filter(g => g.name && g.labels.length); }
function buildSkuCombos(rawSpecs, maxCombos = 200) { const groups = normalizeSpecsForSku(rawSpecs); if (!groups.length) return { ok: false, message: '请完善规格组名与选项', combos: [] }; let combos = [{}]; for (const g of groups) { const next = []; for (const base of combos) { for (const label of g.labels) { next.push({ ...base, [g.name]: label }); if (next.length > maxCombos) { return { ok: false, message: `规格组合过多（>${maxCombos}）`, combos: [] }; } } } combos = next; } return { ok: true, combos }; }

// [移除] 冗余的 compressToMaxKB 函数

Page({
  data: {
    keyword: '',
    loading: false,
    hasMore: true,
    pageNum: 1,
    pageSize: 20,
    categories: [{ _id: 'all', name: '全部分类' }],
    filterCategoryIndex: 0,
    list: [],
    showForm: false,
    editingId: '',
    saving: false,
    
    deletedFileIDs: [],
    
    formCategoryIndex: 0,
    formModesMap: { ziti: true, waimai: true, kuaidi: true },
    
    form: {
      name: '', categoryId: '', price: '', stock: '', sort: '0', onShelf: true,
      modes: ['ziti', 'waimai', 'kuaidi'],
      
      displayImages: [],
      thumb: { localPath: '', fileID: '' },
      originalThumbFileID: '',

      desc: '', detail: '', hasSpecs: false, specs: [], skuList: []
    },

    showSkuModal: false,
    skuLoading: false,
    skuSaving: false,
    skuItems: [],
    skuBulkPrice: '',
    skuBulkStock: '',
    showCategoryForm: false,
    categorySaving: false,
    categoryForm: { name: '', sort: '0' }
  },

  onShow() { if (requireLogin()) this.loadCategoriesAndList(true); },
  onPullDownRefresh() { this.loadCategoriesAndList(true).finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (!this.data.loading && this.data.hasMore) this.fetchList(false); },
  onKeywordInput(e) { this.setData({ keyword: e.detail.value || '' }); clearTimeout(keywordTimer); keywordTimer = setTimeout(() => this.fetchList(true), 350); },
  onFilterCategoryChange(e) { this.setData({ filterCategoryIndex: Number(e.detail.value || 0) }, () => this.fetchList(true)); },
  async loadCategoriesAndList(reset) { await this.fetchCategories(); await this.fetchList(reset); },

  async fetchCategories() {
    try {
      const res = await call('admin', { action: 'categories_list', token: getSession().token });
      if (!res?.ok) return;
      const cats = (res.list || []).filter(c => c && (c.status == null || c.status === 1));
      const categories = [{ _id: 'all', name: '全部分类' }, ...cats];
      this.setData({ categories });
    } catch (e) { console.error('[goods] fetchCategories error', e); }
  },

  async fetchList(reset) {
    const session = getSession();
    if (!session?.token || this.data.loading) return;
    const pageNum = reset ? 1 : this.data.pageNum;
    const { pageSize, keyword, categories, filterCategoryIndex } = this.data;
    const cat = categories[filterCategoryIndex];
    const categoryId = (cat?._id !== 'all') ? String(cat?._id || '') : '';
    this.setData({ loading: true });
    try {
      const res = await call('admin', { action: 'products_list', token: session.token, keyword, categoryId, pageNum, pageSize });
      if (!res?.ok) {
        if (res?.code === 'AUTH_EXPIRED') { wx.reLaunch({ url: '/packages/admin/pages/login/login' }); }
        else { wx.showToast({ title: res?.message || '加载失败', icon: 'none' }); }
        return;
      }
      const incoming = (res.list || []).map(it => ({ ...it, modesText: modesToText(it.modes), specsCountText: it.hasSpecs ? specsCountText(it.specs) : '' }));
      const hasMore = incoming.length === pageSize;
      const nextList = reset ? incoming : [...this.data.list, ...incoming];
      this.setData({ list: nextList, hasMore, pageNum: hasMore ? pageNum + 1 : pageNum });
    } catch (e) { console.error('[goods] fetchList error', e); wx.showToast({ title: '加载异常', icon: 'none' }); }
    finally { this.setData({ loading: false }); }
  },
  
  openCategoryForm() { this.setData({ showCategoryForm: true, categorySaving: false, categoryForm: { name: '', sort: '0' } }); },
  closeCategoryForm() { this.setData({ showCategoryForm: false }); },
  onCategoryInput(e) { this.setData({ [`categoryForm.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  async saveCategory() {
    const { name, sort } = this.data.categoryForm;
    if (!safeStr(name)) return wx.showToast({ title: '请输入分组名称', icon: 'none' });
    this.setData({ categorySaving: true });
    try {
      await call('admin', { action: 'categories_add', token: getSession().token, name: safeStr(name), sort: toInt(sort, 0) });
      wx.showToast({ title: '已添加', icon: 'success' });
      this.closeCategoryForm();
      await this.fetchCategories();
    } catch (e) { wx.showToast({ title: e.message || '添加失败', icon: 'none' }); }
    finally { this.setData({ categorySaving: false }); }
  },

  openAdd() {
    const cat = this.data.categories[1] || this.data.categories[0];
    const tempId = `temp_${Date.now()}`;
    this.setData({
      showForm: true, editingId: tempId, saving: false, deletedFileIDs: [],
      formCategoryIndex: this.data.categories.length > 1 ? 1 : 0,
      formModesMap: { ziti: true, waimai: true, kuaidi: true },
      form: {
        name: '', categoryId: cat?._id || '', price: '', stock: '', sort: '0', onShelf: true,
        modes: ['ziti', 'waimai', 'kuaidi'],
        displayImages: [],
        thumb: { localPath: '', fileID: '' },
        originalThumbFileID: '',
        desc: '', detail: '', hasSpecs: false, specs: [], skuList: []
      }
    });
  },

  async openEdit(e) {
    const session = requireLogin();
    if (!session) return;
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.showLoading({ title: '加载中...', mask: true });
    try {
      const res = await call('admin', { action: 'product_get_for_edit', id, token: session.token });
      if (!res?.ok) throw new Error(res.message);
      const p = res.data;
      const formCategoryIndex = Math.max(0, this.data.categories.findIndex(c => c._id === p.categoryId));
      const modes = normalizeModes(p.modes);
      const formModesMap = { ziti: modes.includes('ziti'), waimai: modes.includes('waimai'), kuaidi: modes.includes('kuaidi') };
      
      const displayImages = (p.imgFileIDs || []).map((fileID, index) => ({
        key: fileID,
        type: 'cloud',
        path: p.imgs[index],
        preview: p.imgs[index],
        fileID: fileID
      }));
      
      this.setData({
        showForm: true, editingId: p._id, saving: false, deletedFileIDs: [],
        formCategoryIndex, formModesMap,
        form: {
          name: p.name || '', categoryId: p.categoryId || '', price: p.price, stock: p.stock,
          sort: String(p.sort ?? '0'), onShelf: p.status === 1, modes,
          displayImages: displayImages,
          thumb: { localPath: '', fileID: p.thumbFileID || '' },
          originalThumbFileID: p.thumbFileID || '',
          desc: p.desc || '', detail: p.detail || '',
          hasSpecs: !!p.hasSpecs, specs: p.specs || [],
          skuList: Array.isArray(p.skuList) ? p.skuList : []
        }
      });
    } catch (err) { wx.showToast({ title: err.message || '加载失败', icon: 'none' }); }
    finally { wx.hideLoading(); }
  },
  
  cancelForm() { this.setData({ showForm: false }); },
  onFormInput(e) { this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  onFormCategoryChange(e) { const idx = Number(e.detail.value || 0); this.setData({ formCategoryIndex: idx, 'form.categoryId': this.data.categories[idx]?._id || '' }); },
  onShelfSwitch(e) { this.setData({ 'form.onShelf': !!e.detail.value }); },
  toggleMode(e) { const { mode } = e.currentTarget.dataset; const map = { ...this.data.formModesMap, [mode]: !this.data.formModesMap[mode] }; this.setData({ formModesMap: map, 'form.modes': Object.keys(map).filter(k => map[k]) }); },

  // [修改] 直接调用 uploader.js 的 generateThumbnail
  // 必须确保 WXML 里有 canvas-id="image-cropper"
  async triggerThumbnailGen(filePath) {
    if (!filePath) return;
    try {
      // 调用工具方法生成缩略图
      const thumbPath = await generateThumbnail(filePath);
      this.setData({ 'form.thumb.localPath': thumbPath });
    } catch (e) {
      console.error('triggerThumbnailGen error', e);
      wx.showToast({ title: '缩略图生成失败', icon: 'none' });
    }
  },

  async chooseImage() {
    const { displayImages } = this.data.form;
    if (displayImages.length >= 3) { return wx.showToast({ title: '最多上传3张图片', icon: 'none' }); }
    try {
      const res = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] });
      const localPath = res.tempFiles[0].tempFilePath;

      const newImage = {
        key: `local_${Date.now()}`,
        type: 'local',
        path: localPath,
        preview: localPath,
        fileID: ''
      };

      this.setData({ 'form.displayImages': [...displayImages, newImage] });
      
      // 如果是第一张图，自动作为缩略图
      if (this.data.form.displayImages.length === 1) {
        await this.triggerThumbnailGen(localPath);
      }

    } catch (e) { if (e.errMsg && !e.errMsg.includes('cancel')) { wx.showToast({ title: '选择图片失败', icon: 'none' }); } }
  },

  async removeImage(e) {
    const { index } = e.currentTarget.dataset;
    const { displayImages } = this.data.form;
    const removedImage = displayImages[index];

    if (removedImage.type === 'cloud' && removedImage.fileID) {
      this.setData({ deletedFileIDs: [...this.data.deletedFileIDs, removedImage.fileID] });
    }

    const newDisplayImages = [...displayImages];
    newDisplayImages.splice(index, 1);
    this.setData({ 'form.displayImages': newDisplayImages });

    if (index === 0) {
      this.setData({ 'form.thumb.localPath': '', 'form.thumb.preview': '' });
      if (newDisplayImages.length > 0) {
        const nextFirstImage = newDisplayImages[0];
        if (nextFirstImage.type === 'local') {
          await this.triggerThumbnailGen(nextFirstImage.path);
        } else if (nextFirstImage.type === 'cloud') {
          wx.showLoading({ title: '处理主图...', mask: true });
          try {
            const downloadRes = await wx.downloadFile({ url: nextFirstImage.path });
            await this.triggerThumbnailGen(downloadRes.tempFilePath);
          } catch(err) {
            wx.showToast({ title: '主图处理失败', icon: 'none' });
          } finally {
            wx.hideLoading();
          }
        }
      }
    }
  },

  previewImage(e) { 
    const previews = this.data.form.displayImages.map(img => img.preview);
    wx.previewImage({ urls: previews, current: previews[e.currentTarget.dataset.index] }); 
  },
  
  onHasSpecsSwitch(e) { const hasSpecs = !!e.detail.value; if (hasSpecs && this.data.form.specs.length === 0) { this.setData({ 'form.hasSpecs': true, 'form.specs': [{ name: '', options: [{ label: '' }] }] }); } else { this.setData({ 'form.hasSpecs': hasSpecs }); } },
  addSpecGroup() { this.setData({ 'form.specs': [...this.data.form.specs, { name: '', options: [{ label: '' }] }] }); },
  removeSpecGroup(e) { const { gi } = e.currentTarget.dataset; this.data.form.specs.splice(gi, 1); this.setData({ 'form.specs': this.data.form.specs }); },
  onSpecGroupNameInput(e) { this.setData({ [`form.specs[${e.currentTarget.dataset.gi}].name`]: e.detail.value }); },
  addSpecOption(e) { const { gi } = e.currentTarget.dataset; this.data.form.specs[gi].options.push({ label: '' }); this.setData({ 'form.specs': this.data.form.specs }); },
  removeSpecOption(e) { const { gi, oi } = e.currentTarget.dataset; this.data.form.specs[gi].options.splice(oi, 1); this.setData({ 'form.specs': this.data.form.specs }); },
  onSpecOptionInput(e) { this.setData({ [`form.specs[${e.currentTarget.dataset.gi}].options[${e.currentTarget.dataset.oi}].label`]: e.detail.value }); },

  openSkuModal() {
    const built = buildSkuCombos(this.data.form.specs);
    if (!built.ok) return wx.showToast({ title: built.message, icon: 'none' });
    const skuList = Array.isArray(this.data.form.skuList) ? this.data.form.skuList : [];
    const existedMap = skuList.reduce((map, sku) => { map[sku.skuKey] = sku; return map; }, {});
    const skuItems = built.combos.map(sel => {
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
  onSkuBulkInput(e) { this.setData({ [`skuBulk${e.currentTarget.dataset.field}`]: e.detail.value }); },
  applySkuBulk(e) { const field = e.currentTarget.dataset.field.toLowerCase(); const value = this.data[`skuBulk${field === 'price' ? 'Price' : 'Stock'}`]; if (value === '') return; const updates = {}; this.data.skuItems.forEach((it, idx) => { if (String(it[field] || '') === '') updates[`skuItems[${idx}].${field}`] = value; }); if (Object.keys(updates).length) this.setData(updates); },
  onSkuPriceInput(e) { this.setData({ [`skuItems[${e.currentTarget.dataset.index}].price`]: e.detail.value }); },
  onSkuStockInput(e) { this.setData({ [`skuItems[${e.currentTarget.dataset.index}].stock`]: e.detail.value }); },
  
  async saveSkuStocks() {
    const skus = [];
    for (const it of this.data.skuItems) {
      const price = toNum(it.price, -1);
      const stock = toInt(it.stock, -1);
      if (price < 0 || stock < 0) return wx.showToast({ title: `“${it.specText}”的价格或库存不合法`, icon: 'none' });
      skus.push({ skuKey: it.skuKey, specText: it.specText, price, stock });
    }
    const editingId = this.data.editingId;
    const isNewTemp = typeof editingId === 'string' && editingId.startsWith('temp_');
    if (isNewTemp) {
      const stock = skus.reduce((sum, sku) => sum + toInt(sku.stock, 0), 0);
      const minPrice = Math.min(...skus.map(sku => toNum(sku.price, Infinity)));
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
        'form.skuList': Array.isArray(p.skuList) ? p.skuList : []
      });
      wx.showToast({ title: 'SKU已保存', icon: 'success' });
      this.closeSkuModal();
    } catch (e) { wx.showToast({ title: e.message || '保存失败', icon: 'none' }); }
    finally { this.setData({ skuSaving: false }); }
  },

  async saveForm() {
    if (this.data.saving) return;
    
    const f = this.data.form;
    if (!safeStr(f.name) || !f.categoryId) return wx.showToast({ title: '请填写商品名和分类', icon: 'none' });
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...', mask: true });

    try {
      const uploadTasks = [];
      const newImages = f.displayImages.filter(img => img.type === 'local');

      for (const [index, img] of newImages.entries()) {
        // [修改] 调用公共压缩方法 (商品图压缩至 200KB 左右以保证详情页加载速度)
        const compressedPath = await compressImage(img.path, 200);
        uploadTasks.push(
          wx.cloud.uploadFile({
            cloudPath: `products/${Date.now()}-${index}.jpg`,
            filePath: compressedPath,
          }).then(res => ({ type: 'image', fileID: res.fileID }))
        );
      }
      
      if (f.thumb && f.thumb.localPath) {
        uploadTasks.push(
          wx.cloud.uploadFile({
            cloudPath: `products/thumb/${Date.now()}.jpg`,
            filePath: f.thumb.localPath,
          }).then(res => ({ type: 'thumb', fileID: res.fileID }))
        );
      }
      
      const uploadResults = await Promise.all(uploadTasks);
      
      const newImageFileIDs = uploadResults.filter(res => res.type === 'image').map(res => res.fileID);
      const thumbResult = uploadResults.find(res => res.type === 'thumb');
      const newThumbFileID = thumbResult ? thumbResult.fileID : '';
      
      const existingImageFileIDs = f.displayImages.filter(img => img.type === 'cloud').map(img => img.fileID);
      const finalImageFileIDs = [...existingImageFileIDs, ...newImageFileIDs];
      
      let finalThumbFileID = f.thumb.fileID;
      if (newThumbFileID) {
        finalThumbFileID = newThumbFileID;
        if (f.originalThumbFileID && f.originalThumbFileID !== newThumbFileID) {
          this.data.deletedFileIDs.push(f.originalThumbFileID);
        }
      }

      const payload = {
        name: safeStr(f.name), categoryId: f.categoryId,
        sort: toInt(f.sort, 0), status: f.onShelf ? 1 : 0, modes: f.modes,
        imgs: finalImageFileIDs,
        thumbFileID: finalThumbFileID,
        desc: safeStr(f.desc), detail: safeStr(f.detail),
        hasSpecs: f.hasSpecs,
        ...(f.hasSpecs ? {
          specs: f.specs,
          skuList: Array.isArray(f.skuList) ? f.skuList : []
        } : {
          price: toNum(f.price, 0), stock: toInt(f.stock, 0)
        })
      };

      const editingId = this.data.editingId;
      const action = (typeof editingId === 'string' && editingId.startsWith('temp_')) ? 'products_add' : 'products_update';
      await call('admin', { 
        action, 
        id: editingId, 
        data: payload, 
        deletedFileIDs: this.data.deletedFileIDs,
        token: getSession().token 
      });

      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showForm: false });
      await this.fetchList(true);

    } catch (e) {
      wx.hideLoading();
      console.error('saveForm error', e);
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
  
  async removeItem(e) {
    const { id } = e.currentTarget.dataset;
    const item = this.data.list.find(x => x._id === id);
    const res = await new Promise(r => wx.showModal({ title: '确认删除？', content: `将删除「${item.name}」`, confirmText: '删除', confirmColor: '#fa5151', success: r }));
    if (!res.confirm) return;
    try {
      await call('admin', { action: 'products_remove', id, token: getSession().token });
      wx.showToast({ title: '已删除', icon: 'success' });
      this.setData({ list: this.data.list.filter(x => x._id !== id) });
    } catch (e) { wx.showToast({ title: e.message || '删除失败', icon: 'none' }); }
  },

  async toggleShelf(e) {
    const { id, onshelf } = e.currentTarget.dataset;
    try {
      await call('admin', { action: 'products_toggle', id, onShelf: !onshelf, token: getSession().token });
      const newList = this.data.list.map(it => it._id === id ? { ...it, status: onshelf ? 0 : 1 } : it);
      this.setData({ list: newList });
    } catch (e) { wx.showToast({ title: e.message || '操作失败', icon: 'none' }); }
  }
});