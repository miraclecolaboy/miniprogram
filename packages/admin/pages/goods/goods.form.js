// packages/admin/pages/goods/goods.form.js

const { requireLogin, getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr, toNum } = require('../../../../utils/common');
const { toInt, normalizeModes } = require('./goods.helpers');
const { compressImage, generateThumbnail: generateThumbnailUtil } = require('../../../../utils/uploader');

module.exports = {
  openAdd() {
    const defaultCategoryIndex = this.data.categories.findIndex((c) => c && c._id !== 'all');
    if (defaultCategoryIndex < 0) {
      wx.showToast({ title: '请先新增商品分组', icon: 'none' });
      return;
    }

    const cat = this.data.categories[defaultCategoryIndex];
    const tempId = `temp_${Date.now()}`;

    this.setData({
      showForm: true,
      editingId: tempId,
      saving: false,
      deletedFileIDs: [],
      formCategoryIndex: defaultCategoryIndex,
      formModesMap: { ziti: true, waimai: true, kuaidi: true },
      form: {
        name: '',
        categoryId: cat?._id || '',
        price: '',
        sort: '0',
        onShelf: true,
        modes: ['ziti', 'waimai', 'kuaidi'],
        displayImages: [],
        thumb: { localPath: '', fileID: '' },
        originalThumbFileID: '',
        desc: '',
        detail: '',
        hasSpecs: false,
        specs: [],
        skuList: [],
      },
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
      const formCategoryIndex = Math.max(0, this.data.categories.findIndex((c) => c._id === p.categoryId));
      const modes = normalizeModes(p.modes);
      const formModesMap = { ziti: modes.includes('ziti'), waimai: modes.includes('waimai'), kuaidi: modes.includes('kuaidi') };

      const displayImages = (p.imgFileIDs || []).map((fileID, index) => ({
        key: fileID,
        type: 'cloud',
        path: p.imgs[index],
        preview: p.imgs[index],
        fileID: fileID,
      }));

      this.setData({
        showForm: true,
        editingId: p._id,
        saving: false,
        deletedFileIDs: [],
        formCategoryIndex,
        formModesMap,
        form: {
          name: p.name || '',
          categoryId: p.categoryId || '',
          price: p.price,
          sort: String(p.sort ?? '0'),
          onShelf: p.status === 1,
          modes,
          displayImages: displayImages,
          thumb: { localPath: '', fileID: p.thumbFileID || '' },
          originalThumbFileID: p.thumbFileID || '',
          desc: p.desc || '',
          detail: p.detail || '',
          hasSpecs: !!p.hasSpecs,
          specs: p.specs || [],
          skuList: Array.isArray(p.skuList) ? p.skuList : [],
        },
      });
    } catch (err) {
      if (err?.code === 'AUTH_EXPIRED') return;
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  cancelForm() { this.setData({ showForm: false }); },

  onFormInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  onFormCategoryChange(e) {
    const idx = Number(e.detail.value || 0);
    const chosen = this.data.categories[idx];
    if (!chosen || chosen._id === 'all') {
      wx.showToast({ title: '请选择商品分组', icon: 'none' });
      return;
    }
    this.setData({ formCategoryIndex: idx, 'form.categoryId': this.data.categories[idx]?._id || '' });
  },

  onShelfSwitch(e) { this.setData({ 'form.onShelf': !!e.detail.value }); },

  toggleMode(e) {
    const { mode } = e.currentTarget.dataset;
    const map = { ...this.data.formModesMap, [mode]: !this.data.formModesMap[mode] };
    this.setData({ formModesMap: map, 'form.modes': Object.keys(map).filter((k) => map[k]) });
  },

  // 直接调用 uploader.js 的 generateThumbnail
  // 必须确保 WXML 里有 canvas-id="image-cropper"
  async triggerThumbnailGen(filePath) {
    if (!filePath) return;
    try {
      const thumbPath = await generateThumbnailUtil(filePath);
      this.setData({ 'form.thumb.localPath': thumbPath });
    } catch (e) {
      console.error('triggerThumbnailGen error', e);
      wx.showToast({ title: '缩略图生成失败', icon: 'none' });
    }
  },

  async chooseImage() {
    const { displayImages } = this.data.form;
    if (displayImages.length >= 3) {
      return wx.showToast({ title: '最多上传3张图片', icon: 'none' });
    }

    try {
      const res = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] });
      const localPath = res.tempFiles[0].tempFilePath;

      const newImage = {
        key: `local_${Date.now()}`,
        type: 'local',
        path: localPath,
        preview: localPath,
        fileID: '',
      };

      this.setData({ 'form.displayImages': [...displayImages, newImage] });

      if (this.data.form.displayImages.length === 1) {
        await this.triggerThumbnailGen(localPath);
      }
    } catch (e) {
      if (e.errMsg && !e.errMsg.includes('cancel')) {
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      }
    }
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
          } catch (err) {
            wx.showToast({ title: '主图处理失败', icon: 'none' });
          } finally {
            wx.hideLoading();
          }
        }
      }
    }
  },

  previewImage(e) {
    const previews = this.data.form.displayImages.map((img) => img.preview);
    wx.previewImage({ urls: previews, current: previews[e.currentTarget.dataset.index] });
  },

  onHasSpecsSwitch(e) {
    const hasSpecs = !!e.detail.value;
    if (hasSpecs && this.data.form.specs.length === 0) {
      this.setData({ 'form.hasSpecs': true, 'form.specs': [{ name: '', options: [{ label: '' }] }] });
    } else {
      this.setData({ 'form.hasSpecs': hasSpecs });
    }
  },

  addSpecGroup() {
    this.setData({ 'form.specs': [...this.data.form.specs, { name: '', options: [{ label: '' }] }] });
  },

  removeSpecGroup(e) {
    const { gi } = e.currentTarget.dataset;
    this.data.form.specs.splice(gi, 1);
    this.setData({ 'form.specs': this.data.form.specs });
  },

  onSpecGroupNameInput(e) {
    this.setData({ [`form.specs[${e.currentTarget.dataset.gi}].name`]: e.detail.value });
  },

  addSpecOption(e) {
    const { gi } = e.currentTarget.dataset;
    this.data.form.specs[gi].options.push({ label: '' });
    this.setData({ 'form.specs': this.data.form.specs });
  },

  removeSpecOption(e) {
    const { gi, oi } = e.currentTarget.dataset;
    this.data.form.specs[gi].options.splice(oi, 1);
    this.setData({ 'form.specs': this.data.form.specs });
  },

  onSpecOptionInput(e) {
    this.setData({ [`form.specs[${e.currentTarget.dataset.gi}].options[${e.currentTarget.dataset.oi}].label`]: e.detail.value });
  },

  async saveForm() {
    if (this.data.saving) return;

    const f = this.data.form;
    if (!safeStr(f.name) || !f.categoryId || f.categoryId === 'all') {
      return wx.showToast({ title: '请填写商品名和分类', icon: 'none' });
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...', mask: true });
    let uploadedFileIDs = [];
    let productSaved = false;

    try {
      const uploadTasks = [];
      const newImages = f.displayImages.filter((img) => img.type === 'local');

      for (const [index, img] of newImages.entries()) {
        const compressedPath = await compressImage(img.path, 200);
        uploadTasks.push(
          wx.cloud.uploadFile({
            cloudPath: `products/${Date.now()}-${index}.jpg`,
            filePath: compressedPath,
          }).then((res) => ({ type: 'image', fileID: res.fileID }))
        );
      }

      if (f.thumb && f.thumb.localPath) {
        uploadTasks.push(
          wx.cloud.uploadFile({
            cloudPath: `products/thumb/${Date.now()}.jpg`,
            filePath: f.thumb.localPath,
          }).then((res) => ({ type: 'thumb', fileID: res.fileID }))
        );
      }

      const uploadResults = await Promise.all(uploadTasks);
      uploadedFileIDs = uploadResults.map((res) => safeStr(res.fileID)).filter(Boolean);

      const newImageFileIDs = uploadResults.filter((res) => res.type === 'image').map((res) => res.fileID);
      const thumbResult = uploadResults.find((res) => res.type === 'thumb');
      const newThumbFileID = thumbResult ? thumbResult.fileID : '';

      const existingImageFileIDs = f.displayImages.filter((img) => img.type === 'cloud').map((img) => img.fileID);
      const finalImageFileIDs = [...existingImageFileIDs, ...newImageFileIDs];

      let finalThumbFileID = f.thumb.fileID;
      if (newThumbFileID) {
        finalThumbFileID = newThumbFileID;
        if (f.originalThumbFileID && f.originalThumbFileID !== newThumbFileID) {
          this.data.deletedFileIDs.push(f.originalThumbFileID);
        }
      }

      const payload = {
        name: safeStr(f.name),
        categoryId: f.categoryId,
        sort: toInt(f.sort, 0),
        status: f.onShelf ? 1 : 0,
        modes: f.modes,
        imgs: finalImageFileIDs,
        thumbFileID: finalThumbFileID,
        desc: safeStr(f.desc),
        detail: safeStr(f.detail),
        hasSpecs: f.hasSpecs,
        ...(f.hasSpecs ? {
          specs: f.specs,
          skuList: Array.isArray(f.skuList) ? f.skuList : [],
        } : {
          price: toNum(f.price, 0),
        }),
      };

      const editingId = this.data.editingId;
      const action = (typeof editingId === 'string' && editingId.startsWith('temp_')) ? 'products_add' : 'products_update';
      await call('admin', {
        action,
        id: editingId,
        data: payload,
        deletedFileIDs: this.data.deletedFileIDs,
        token: getSession().token,
      });
      productSaved = true;

      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showForm: false });
      await this.fetchList(true);
    } catch (e) {
      if (!productSaved && uploadedFileIDs.length) {
        wx.cloud.deleteFile({ fileList: uploadedFileIDs }).catch((err) => {
          console.error('rollback uploaded files error', err);
        });
      }
      if (e?.code === 'AUTH_EXPIRED') return;
      wx.hideLoading();
      console.error('saveForm error', e);
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async removeItem(e) {
    const { id } = e.currentTarget.dataset;
    const item = this.data.list.find((x) => x._id === id);
    const res = await new Promise((r) => wx.showModal({
      title: '确认删除？',
      content: `将删除「${item.name}」`,
      confirmText: '删除',
      confirmColor: '#fa5151',
      success: r,
    }));
    if (!res.confirm) return;

    try {
      await call('admin', { action: 'products_remove', id, token: getSession().token });
      wx.showToast({ title: '已删除', icon: 'success' });
      this.setData({ list: this.data.list.filter((x) => x._id !== id) });
    } catch (e) {
      if (e?.code === 'AUTH_EXPIRED') return;
      wx.showToast({ title: e.message || '删除失败', icon: 'none' });
    }
  },

  async toggleShelf(e) {
    const { id, onshelf } = e.currentTarget.dataset;
    try {
      await call('admin', { action: 'products_toggle', id, onShelf: !onshelf, token: getSession().token });
      const newList = this.data.list.map((it) => (it._id === id ? { ...it, status: onshelf ? 0 : 1 } : it));
      this.setData({ list: newList });
    } catch (e) {
      if (e?.code === 'AUTH_EXPIRED') return;
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    }
  },
};
