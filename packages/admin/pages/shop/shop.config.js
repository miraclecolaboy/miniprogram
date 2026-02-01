// packages/admin/pages/shop/shop.config.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { uploadAndReplace, compressImage } = require('../../../../utils/uploader');

module.exports = {
  // --- 配送 & 轮播图 ---
  onWaimaiMaxKmInput(e) { this.setData({ waimaiMaxKm: safeStr(e.detail.value), configChanged: true }); },
  onWaimaiDeliveryFeeInput(e) { this.setData({ waimaiDeliveryFee: safeStr(e.detail.value), configChanged: true }); },
  onKuaidiOnChange(e) { this.setData({ kuaidiOn: !!e.detail.value, configChanged: true }); },
  onKuaidiDeliveryFeeInput(e) { this.setData({ kuaidiDeliveryFee: safeStr(e.detail.value), configChanged: true }); },
  onMinOrderWaimaiInput(e) { this.setData({ minOrderWaimai: safeStr(e.detail.value), configChanged: true }); },
  onMinOrderKuaidiInput(e) { this.setData({ minOrderKuaidi: safeStr(e.detail.value), configChanged: true }); },

  // 轮播图管理 - 使用压缩
  async onUploadBanner() {
    try {
      const r = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] });
      const rawPath = r?.tempFiles?.[0]?.tempFilePath;
      if (!rawPath) return;

      wx.showLoading({ title: '处理中...', mask: true });

      // 1. 压缩图片 (限制 2MB 以内)
      const compressedPath = await compressImage(rawPath, 2048);

      // 2. 上传
      // 轮播图是列表，追加时不涉及替换旧图，oldFileId=null
      const fileId = await uploadAndReplace(compressedPath, null, 'banners');

      const newBanner = { fileId, preview: compressedPath }; // 预览用本地路径更快
      const nextBanners = [...this.data.banners, newBanner];

      this.setData({ banners: nextBanners, configChanged: true });

      wx.hideLoading();
    } catch (e) {
      if ((e?.errMsg || '').includes('cancel')) return;
      console.error(e);
      wx.hideLoading();
      wx.showToast({ title: '上传失败', icon: 'none' });
    }
  },

  async onRemoveBanner(e) {
    const idx = e.currentTarget.dataset.index;
    const banner = this.data.banners[idx];
    if (!banner) return;

    const ok = await new Promise((res) => wx.showModal({
      title: '删除轮播图?',
      content: '确认删除这张图片吗？',
      success: (r) => res(r.confirm),
    }));
    if (!ok) return;

    if (banner.fileId) {
      // 异步删除云文件
      wx.cloud.deleteFile({ fileList: [banner.fileId] }).catch(console.error);
    }

    const nextBanners = this.data.banners.filter((_, i) => i !== idx);
    this.setData({ banners: nextBanners, configChanged: true });
  },

  async onSaveConfig() {
    const session = getSession();
    if (!session?.token) return;
    if (!this.data.configChanged) return;

    const bannerIds = this.data.banners.map((b) => b.fileId).filter(Boolean);

    const r = await call('admin', {
      action: 'shop_setConfig',
      token: session.token,
      banners: bannerIds,
      waimaiMaxKm: Number(this.data.waimaiMaxKm),
      waimaiDeliveryFee: safeStr(this.data.waimaiDeliveryFee),
      kuaidiOn: !!this.data.kuaidiOn,
      kuaidiDeliveryFee: safeStr(this.data.kuaidiDeliveryFee),
      minOrderWaimai: safeStr(this.data.minOrderWaimai),
      minOrderKuaidi: safeStr(this.data.minOrderKuaidi),
    }, { loadingTitle: '保存中' }).catch(() => null);
    if (!r?.ok) return wx.showToast({ title: r?.message || '保存失败', icon: 'none' });
    this.setData({ configChanged: false });
    wx.showToast({ title: '已保存', icon: 'success' });
  },
};

