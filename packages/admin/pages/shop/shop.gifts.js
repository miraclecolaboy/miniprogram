// packages/admin/pages/shop/shop.gifts.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { getTempUrlMap } = require('../../../../utils/cloudFile');
const { uploadAndReplace, generateThumbnail } = require('../../../../utils/uploader');
const { toInt } = require('./shop.helpers');

module.exports = {
  // ===== 积分兑换商品（shop_config: points_gift）=====
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
  onGiftDescInput(e) {
    this.setData({ giftForm: { ...this.data.giftForm, desc: safeStr(e.detail.value) } });
  },

  // 积分礼品图片上传 - 强制生成 300x300 缩略图
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

      // 1. 核心：生成 300x300 缩略图 (依赖 WXML 中的 canvas)
      const thumbPath = await generateThumbnail(rawPath);

      wx.showLoading({ title: '上传中...', mask: true });

      // 2. 上传 (只存这一张图)
      const fileID = await uploadAndReplace(thumbPath, this.data.giftForm.thumbFileId, 'redeem_gifts');

      this.setData({
        giftForm: { ...this.data.giftForm, thumbFileId: fileID, thumbPreview: thumbPath },
      });

      wx.hideLoading();
      wx.showToast({ title: '已上传', icon: 'success' });
    } catch (e) {
      if ((e?.errMsg || '').includes('cancel')) return;
      console.error('[shop] upload gift thumb error', e);
      wx.hideLoading();
      wx.showToast({ title: '上传失败', icon: 'none' });
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
        desc: g.desc || '',
        thumbFileId: safeStr(g.thumbFileId),
        thumbPreview: safeStr(g.thumbUrl),
      },
    });
  },

  onCancelEdit() {
    this.setData({
      editingGiftId: '',
      editingGiftName: '',
      giftForm: { name: '', points: '', desc: '', thumbFileId: '', thumbPreview: '' },
    });
  },

  async onSaveGift() {
    const session = getSession();
    if (!session?.token) return;

    const name = safeStr(this.data.giftForm.name);
    const points = toInt(this.data.giftForm.points, 0);
    const desc = safeStr(this.data.giftForm.desc);
    const thumbFileId = safeStr(this.data.giftForm.thumbFileId);

    if (!name) return wx.showToast({ title: '请输入商品名字', icon: 'none' });
    if (!points || points <= 0) return wx.showToast({ title: '所需积分必须大于0', icon: 'none' });
    if (desc.length > 200) return wx.showToast({ title: '描述最多200字', icon: 'none' });

    const r = await call('admin', {
      action: 'redeem_gifts_upsert',
      token: session.token,
      id: this.data.editingGiftId || '',
      name,
      points,
      desc,
      thumbFileId,
    }, { loadingTitle: '保存中' }).catch(() => null);

    if (!r?.ok) return wx.showToast({ title: r?.message || '保存失败', icon: 'none' });

    wx.showToast({ title: '已保存', icon: 'success' });

    this.setData({
      editingGiftId: '',
      editingGiftName: '',
      giftForm: { name: '', points: '', desc: '', thumbFileId: '', thumbPreview: '' },
    });

    await this.loadGifts();
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

    const r = await call('admin', { action: 'redeem_gifts_disable', token: session.token, id }, { loadingTitle: '处理中' }).catch(() => null);
    if (!r?.ok) return wx.showToast({ title: r?.message || '操作失败', icon: 'none' });

    wx.showToast({ title: '已删除', icon: 'success' });
    await this.loadGifts();
  },
};
