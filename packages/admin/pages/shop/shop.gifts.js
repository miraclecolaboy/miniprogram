// packages/admin/pages/shop/shop.gifts.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { getTempUrlMap } = require('../../../../utils/cloudFile');
const { generateThumbnail } = require('../../../../utils/uploader');
const { toInt } = require('./shop.helpers');

function emptyGiftForm() {
  return {
    name: '',
    points: '',
    quantity: '',
    desc: '',
    thumbFileId: '',
    thumbPreview: '',
    thumbLocalPath: '',
  };
}

function buildGiftCloudPath() {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `redeem_gifts/${suffix}.jpg`;
}

module.exports = {
  async loadGifts() {
    const session = getSession();
    if (!session?.token) return;

    const r = await call('admin', { action: 'redeem_gifts_list', token: session.token }).catch(() => null);
    if (!r?.ok) return;

    const list = Array.isArray(r.list) ? r.list : [];
    const fileIds = list.map((x) => safeStr(x.thumbFileId)).filter(Boolean);
    const urlMap = await getTempUrlMap(fileIds);

    const gifts = list.map((x) => ({
      ...x,
      thumbUrl: x.thumbFileId ? (urlMap[x.thumbFileId] || '') : '',
    }));

    this.setData({ gifts });
  },

  onGiftNameInput(e) {
    this.setData({ giftForm: { ...this.data.giftForm, name: safeStr(e.detail.value) } });
  },

  onGiftPointsInput(e) {
    this.setData({ giftForm: { ...this.data.giftForm, points: safeStr(e.detail.value) } });
  },

  onGiftQuantityInput(e) {
    this.setData({ giftForm: { ...this.data.giftForm, quantity: safeStr(e.detail.value) } });
  },

  onGiftDescInput(e) {
    const desc = safeStr(e.detail.value).slice(0, 20);
    this.setData({ giftForm: { ...this.data.giftForm, desc } });
  },

  async onUploadGiftThumb() {
    try {
      const r = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      });

      const rawPath = r?.tempFiles?.[0]?.tempFilePath;
      if (!rawPath) return;

      wx.showLoading({ title: '生成缩略图...', mask: true });
      const thumbPath = await generateThumbnail(rawPath);

      this.setData({
        giftForm: {
          ...this.data.giftForm,
          thumbPreview: thumbPath,
          thumbLocalPath: thumbPath,
        },
      });

      wx.hideLoading();
      wx.showToast({ title: '已选择', icon: 'success' });
    } catch (e) {
      if ((e?.errMsg || '').includes('cancel')) return;
      console.error('[shop] choose gift thumb error', e);
      wx.hideLoading();
      wx.showToast({ title: '选择图片失败', icon: 'none' });
    }
  },

  onEditGift(e) {
    const id = safeStr(e.currentTarget.dataset.id);
    const g = (this.data.gifts || []).find((x) => x.id === id);
    if (!g) return;

    this.setData({
      editingGiftId: g.id,
      editingGiftName: g.name,
      giftForm: {
        name: g.name,
        points: String(g.points || ''),
        quantity: g.totalQuantity > 0 ? String(g.totalQuantity) : '',
        desc: g.desc || '',
        thumbFileId: safeStr(g.thumbFileId),
        thumbPreview: safeStr(g.thumbUrl),
        thumbLocalPath: '',
      },
    });
  },

  onCancelEdit() {
    this.setData({
      editingGiftId: '',
      editingGiftName: '',
      giftForm: emptyGiftForm(),
    });
  },

  async onSaveGift() {
    const session = getSession();
    if (!session?.token) return;

    const name = safeStr(this.data.giftForm.name);
    const points = toInt(this.data.giftForm.points, 0);
    const totalQuantity = toInt(this.data.giftForm.quantity, 0);
    const desc = safeStr(this.data.giftForm.desc);
    const oldThumbFileId = safeStr(this.data.giftForm.thumbFileId);
    const thumbLocalPath = safeStr(this.data.giftForm.thumbLocalPath);

    if (!name) return wx.showToast({ title: '请输入商品名字', icon: 'none' });
    if (!points || points <= 0) return wx.showToast({ title: '所需积分必须大于0', icon: 'none' });
    if (!totalQuantity || totalQuantity <= 0) return wx.showToast({ title: '数量必须大于0', icon: 'none' });
    if (desc.length > 20) return wx.showToast({ title: '描述最多20字', icon: 'none' });

    let nextThumbFileId = oldThumbFileId;
    let uploadedThumbFileId = '';
    const isEditing = !!safeStr(this.data.editingGiftId);
    let giftSaved = false;

    try {
      wx.showLoading({ title: '保存中...', mask: true });

      if (thumbLocalPath) {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: buildGiftCloudPath(),
          filePath: thumbLocalPath,
        });
        uploadedThumbFileId = safeStr(uploadRes?.fileID);
        if (!uploadedThumbFileId) throw new Error('上传图片失败');
        nextThumbFileId = uploadedThumbFileId;
      }

      const r = await call('admin', {
        action: 'redeem_gifts_upsert',
        token: session.token,
        id: this.data.editingGiftId || '',
        name,
        points,
        totalQuantity,
        desc,
        thumbFileId: nextThumbFileId,
      }).catch(() => null);

      if (!r?.ok) throw new Error(r?.message || '保存失败');
      giftSaved = true;

      if (isEditing && oldThumbFileId && nextThumbFileId && oldThumbFileId !== nextThumbFileId && oldThumbFileId.startsWith('cloud://')) {
        wx.cloud.deleteFile({ fileList: [oldThumbFileId] }).catch((e) => {
          console.error('[shop] delete old gift thumb error', e);
        });
      }

      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({
        editingGiftId: '',
        editingGiftName: '',
        giftForm: emptyGiftForm(),
      });

      await this.loadGifts();
    } catch (e) {
      if (!giftSaved && uploadedThumbFileId) {
        wx.cloud.deleteFile({ fileList: [uploadedThumbFileId] }).catch((err) => {
          console.error('[shop] rollback uploaded gift thumb error', err);
        });
      }
      wx.showToast({ title: e?.message || '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onDisableGift(e) {
    const session = getSession();
    if (!session?.token) return;

    const id = safeStr(e.currentTarget.dataset.id);
    if (!id) return;

    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '确认删除？',
        content: '删除后不可恢复，用户端将不可兑换。',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    const r = await call('admin', {
      action: 'redeem_gifts_disable',
      token: session.token,
      id,
    }, { loadingTitle: '处理中' }).catch(() => null);
    if (!r?.ok) return wx.showToast({ title: r?.message || '操作失败', icon: 'none' });

    wx.showToast({ title: '已删除', icon: 'success' });
    await this.loadGifts();
  },
};
