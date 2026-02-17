
const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { compressImage } = require('../../../../utils/uploader');

function makeLocalBanner(localPath) {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    key: `local_${suffix}`,
    fileId: '',
    preview: localPath,
    localPath,
  };
}

function makeBannerCloudPath(index) {
  const suffix = `${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
  return `banners/${suffix}.jpg`;
}

module.exports = {
  onWaimaiOnChange(e) {
    this.setData({ waimaiOn: !!e.detail.value, configChanged: true });
  },
  onWaimaiMaxKmInput(e) {
    this.setData({ waimaiMaxKm: safeStr(e.detail.value), configChanged: true });
  },
  onWaimaiDeliveryFeeInput(e) {
    this.setData({ waimaiDeliveryFee: safeStr(e.detail.value), configChanged: true });
  },
  onKuaidiOnChange(e) {
    this.setData({ kuaidiOn: !!e.detail.value, configChanged: true });
  },
  onKuaidiDeliveryFeeInput(e) {
    this.setData({ kuaidiDeliveryFee: safeStr(e.detail.value), configChanged: true });
  },
  onKuaidiOutProvinceDistanceKmInput(e) {
    this.setData({ kuaidiOutProvinceDistanceKm: safeStr(e.detail.value), configChanged: true });
  },
  onKuaidiOutDeliveryFeeInput(e) {
    this.setData({ kuaidiOutDeliveryFee: safeStr(e.detail.value), configChanged: true });
  },
  onMinOrderWaimaiInput(e) {
    this.setData({ minOrderWaimai: safeStr(e.detail.value), configChanged: true });
  },
  onMinOrderKuaidiInput(e) {
    this.setData({ minOrderKuaidi: safeStr(e.detail.value), configChanged: true });
  },
  onMinOrderKuaidiOutInput(e) {
    this.setData({ minOrderKuaidiOut: safeStr(e.detail.value), configChanged: true });
  },

  async onUploadBanner() {
    try {
      const r = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      });
      const rawPath = r?.tempFiles?.[0]?.tempFilePath;
      if (!rawPath) return;

      wx.showLoading({ title: '处理中...', mask: true });
      const compressedPath = await compressImage(rawPath, 2048);
      const nextBanners = [...(Array.isArray(this.data.banners) ? this.data.banners : []), makeLocalBanner(compressedPath)];

      this.setData({ banners: nextBanners, configChanged: true });
      wx.hideLoading();
      wx.showToast({ title: '已选择', icon: 'success' });
    } catch (e) {
      if ((e?.errMsg || '').includes('cancel')) return;
      console.error('[shop] choose banner error', e);
      wx.hideLoading();
      wx.showToast({ title: '选择图片失败', icon: 'none' });
    }
  },

  async onRemoveBanner(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const banners = Array.isArray(this.data.banners) ? this.data.banners : [];
    if (!Number.isFinite(idx) || idx < 0 || idx >= banners.length) return;
    const banner = banners[idx];
    if (!banner) return;

    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '删除轮播图',
        content: '确认删除这张图片吗？',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    const next = banners.filter((_, i) => i !== idx);
    const removed = Array.isArray(this.data.removedBannerFileIds) ? this.data.removedBannerFileIds : [];
    const cloudId = safeStr(banner.fileId);
    const nextRemoved = (cloudId && cloudId.startsWith('cloud://') && !safeStr(banner.localPath))
      ? Array.from(new Set([...removed, cloudId]))
      : removed;

    this.setData({
      banners: next,
      removedBannerFileIds: nextRemoved,
      configChanged: true,
    });
  },

  async onSaveConfig() {
    const session = getSession();
    if (!session?.token) return;
    if (!this.data.configChanged) return;

    const banners = Array.isArray(this.data.banners) ? this.data.banners : [];
    const removedBannerFileIds = (Array.isArray(this.data.removedBannerFileIds) ? this.data.removedBannerFileIds : [])
      .map(safeStr)
      .filter(Boolean);

    const uploadedFileIds = [];
    const uploadedMap = new Map();
    let configSaved = false;

    try {
      wx.showLoading({ title: '保存中...', mask: true });

      const localBanners = banners.filter((b) => safeStr(b.localPath));
      for (let i = 0; i < localBanners.length; i += 1) {
        const item = localBanners[i];
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: makeBannerCloudPath(i),
          filePath: safeStr(item.localPath),
        });
        const fileId = safeStr(uploadRes?.fileID);
        if (!fileId) throw new Error('上传轮播图失败');
        uploadedFileIds.push(fileId);
        uploadedMap.set(item.key, fileId);
      }

      const nextBanners = [];
      for (let i = 0; i < banners.length; i += 1) {
        const item = banners[i] || {};
        const localPath = safeStr(item.localPath);
        const fileId = localPath ? safeStr(uploadedMap.get(item.key)) : safeStr(item.fileId);
        if (!fileId) continue;
        nextBanners.push({
          key: `remote_${nextBanners.length}_${fileId}`,
          fileId,
          preview: safeStr(item.preview),
        });
      }
      const finalBannerIds = nextBanners.map((x) => x.fileId);

      const r = await call('admin', {
        action: 'shop_setConfig',
        token: session.token,
        banners: finalBannerIds,
        waimaiOn: !!this.data.waimaiOn,
        waimaiMaxKm: Number(this.data.waimaiMaxKm),
        waimaiDeliveryFee: safeStr(this.data.waimaiDeliveryFee),
        kuaidiOn: !!this.data.kuaidiOn,
        kuaidiDeliveryFee: safeStr(this.data.kuaidiDeliveryFee),
        kuaidiOutProvinceDistanceKm: safeStr(this.data.kuaidiOutProvinceDistanceKm),
        kuaidiOutDeliveryFee: safeStr(this.data.kuaidiOutDeliveryFee),
        minOrderWaimai: safeStr(this.data.minOrderWaimai),
        minOrderKuaidi: safeStr(this.data.minOrderKuaidi),
        minOrderKuaidiOut: safeStr(this.data.minOrderKuaidiOut),
      }).catch(() => null);
      if (!r?.ok) throw new Error(r?.message || '保存失败');
      configSaved = true;

      if (removedBannerFileIds.length) {
        wx.cloud.deleteFile({ fileList: removedBannerFileIds }).catch((e) => {
          console.error('[shop] delete removed banners error', e);
        });
      }

      this.setData({
        banners: nextBanners,
        removedBannerFileIds: [],
        configChanged: false,
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      if (!configSaved && uploadedFileIds.length) {
        wx.cloud.deleteFile({ fileList: uploadedFileIds }).catch((err) => {
          console.error('[shop] rollback uploaded banners error', err);
        });
      }
      wx.showToast({ title: e?.message || '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
};
