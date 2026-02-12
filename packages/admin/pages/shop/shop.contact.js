// packages/admin/pages/shop/shop.contact.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { parseServiceHoursRanges } = require('../../../../utils/serviceHours');
const { compressImage } = require('../../../../utils/uploader');
const {
  buildServiceHoursFromInputRanges,
  emptyServiceHoursRange,
  normalizeServiceHours,
  rangeToServiceHoursInput,
  sanitizeDigits2,
} = require('./shop.helpers');

const MAX_SERVICE_HOURS_RANGES = 2;

function buildKefuCloudPath() {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `kefu_qr/${suffix}.jpg`;
}

module.exports = {
  onPhoneInput(e) {
    this.setData({ phone: safeStr(e.detail.value), contactChanged: true });
  },

  onServiceHoursInput(e) {
    this.setData({
      serviceHours: safeStr(e.detail.value),
      contactChanged: true,
      serviceHoursEdited: true,
    });
  },

  onServiceHourPartInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = String(e.currentTarget.dataset.field || '').trim();
    if (!Number.isFinite(index) || index < 0) return;
    if (!['sh', 'sm', 'eh', 'em'].includes(field)) return;

    const value = sanitizeDigits2(e.detail.value);
    this.setData({
      [`serviceHoursRanges[${index}].${field}`]: value,
      contactChanged: true,
      serviceHoursEdited: true,
    });
  },

  onAddServiceHoursRange() {
    const cur = Array.isArray(this.data.serviceHoursRanges) ? this.data.serviceHoursRanges : [];
    if (cur.length >= MAX_SERVICE_HOURS_RANGES) {
      return wx.showToast({ title: '最多2个营业时段', icon: 'none' });
    }
    this.setData({
      serviceHoursRanges: [...cur, emptyServiceHoursRange()],
      contactChanged: true,
      serviceHoursEdited: true,
    });
  },

  onRemoveServiceHoursRange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cur = Array.isArray(this.data.serviceHoursRanges) ? this.data.serviceHoursRanges : [];
    if (!Number.isFinite(index) || index < 0 || index >= cur.length) return;

    const next = cur.filter((_, i) => i !== index);
    this.setData({
      serviceHoursRanges: next.length ? next : [emptyServiceHoursRange()],
      contactChanged: true,
      serviceHoursEdited: true,
    });
  },

  async onUploadKefuQr() {
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
      const compressedPath = await compressImage(rawPath, 200);

      this.setData({
        kefuQrPreview: compressedPath,
        kefuQrLocalPath: compressedPath,
        kefuQrRemoved: false,
        contactChanged: true,
      });
      wx.hideLoading();
      wx.showToast({ title: '已选择', icon: 'success' });
    } catch (e) {
      if ((e?.errMsg || '').includes('cancel')) return;
      console.error('[shop] choose kefu qr error', e);
      wx.hideLoading();
      wx.showToast({ title: '选择图片失败', icon: 'none' });
    }
  },

  async onRemoveKefuQr() {
    const oldFileId = safeStr(this.data.kefuQrFileId);
    const localPath = safeStr(this.data.kefuQrLocalPath);
    if (!oldFileId && !localPath && !this.data.kefuQrPreview) return;

    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '删除客服图片',
        content: '确认删除当前客服二维码吗？',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    this.setData({
      kefuQrPreview: '',
      kefuQrLocalPath: '',
      kefuQrRemoved: true,
      contactChanged: true,
    });
  },

  async onSaveContact() {
    const session = getSession();
    if (!session?.token || !this.data.contactChanged) return;

    let serviceHoursToSave = safeStr(this.data.serviceHoursOriginal);
    if (this.data.serviceHoursEdited) {
      const ranges = (Array.isArray(this.data.serviceHoursRanges) ? this.data.serviceHoursRanges : [])
        .slice(0, MAX_SERVICE_HOURS_RANGES);
      const built = buildServiceHoursFromInputRanges(ranges);
      if (!built.ok) return wx.showToast({ title: built.message || '营业时间不正确', icon: 'none' });

      const rawServiceHours = safeStr(built.raw);
      if (rawServiceHours) {
        const norm = normalizeServiceHours(rawServiceHours);
        if (!norm.ok) return wx.showToast({ title: '营业时间不正确', icon: 'none' });
        serviceHoursToSave = norm.normalized;
      } else {
        serviceHoursToSave = '';
      }
    }

    const oldKefuFileId = safeStr(this.data.kefuQrFileId);
    let nextKefuFileId = oldKefuFileId;
    let uploadedKefuFileId = '';
    let contactSaved = false;

    try {
      wx.showLoading({ title: '保存中...', mask: true });

      if (safeStr(this.data.kefuQrLocalPath)) {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: buildKefuCloudPath(),
          filePath: safeStr(this.data.kefuQrLocalPath),
        });
        uploadedKefuFileId = safeStr(uploadRes?.fileID);
        if (!uploadedKefuFileId) throw new Error('上传客服图片失败');
        nextKefuFileId = uploadedKefuFileId;
      } else if (this.data.kefuQrRemoved) {
        nextKefuFileId = '';
      }

      const r = await call('admin', {
        action: 'shop_setConfig',
        token: session.token,
        phone: safeStr(this.data.phone),
        serviceHours: serviceHoursToSave,
        kefuQrUrl: nextKefuFileId,
      }).catch(() => null);
      if (!r?.ok) throw new Error(r?.message || '保存失败');
      contactSaved = true;

      if (oldKefuFileId && oldKefuFileId !== nextKefuFileId && oldKefuFileId.startsWith('cloud://')) {
        wx.cloud.deleteFile({ fileList: [oldKefuFileId] }).catch((e) => {
          console.error('[shop] delete old kefu qr error', e);
        });
      }

      const parsed = parseServiceHoursRanges(serviceHoursToSave);
      const serviceHoursRanges = (parsed && parsed.length)
        ? parsed.slice(0, MAX_SERVICE_HOURS_RANGES).map(rangeToServiceHoursInput)
        : [emptyServiceHoursRange()];

      this.setData({
        contactChanged: false,
        serviceHours: serviceHoursToSave,
        serviceHoursOriginal: serviceHoursToSave,
        serviceHoursRanges,
        serviceHoursEdited: false,
        kefuQrFileId: nextKefuFileId,
        kefuQrLocalPath: '',
        kefuQrRemoved: false,
        kefuQrPreview: nextKefuFileId ? this.data.kefuQrPreview : '',
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      if (!contactSaved && uploadedKefuFileId) {
        wx.cloud.deleteFile({ fileList: [uploadedKefuFileId] }).catch((err) => {
          console.error('[shop] rollback uploaded kefu qr error', err);
        });
      }
      wx.showToast({ title: e?.message || '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
};
