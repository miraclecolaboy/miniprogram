// packages/admin/pages/shop/shop.contact.js

const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr } = require('../../../../utils/common');
const { parseServiceHoursRanges } = require('../../../../utils/serviceHours');
const { uploadAndReplace, compressImage } = require('../../../../utils/uploader');
const {
  buildServiceHoursFromInputRanges,
  emptyServiceHoursRange,
  normalizeServiceHours,
  rangeToServiceHoursInput,
  sanitizeDigits2,
} = require('./shop.helpers');

module.exports = {
  // --- 客服 ---
  onPhoneInput(e) { this.setData({ phone: safeStr(e.detail.value), contactChanged: true }); },
  onServiceHoursInput(e) { this.setData({ serviceHours: safeStr(e.detail.value), contactChanged: true, serviceHoursEdited: true }); },

  onServiceHourPartInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = String(e.currentTarget.dataset.field || '').trim();
    if (!Number.isFinite(index) || index < 0) return;
    if (!['sh', 'sm', 'eh', 'em'].includes(field)) return;

    const v = sanitizeDigits2(e.detail.value);
    this.setData({
      [`serviceHoursRanges[${index}].${field}`]: v,
      contactChanged: true,
      serviceHoursEdited: true,
    });
  },

  onAddServiceHoursRange() {
    const cur = Array.isArray(this.data.serviceHoursRanges) ? this.data.serviceHoursRanges : [];
    if (cur.length >= 4) return wx.showToast({ title: '最多 4 个时段', icon: 'none' });
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

  // 客服二维码上传 - 使用压缩
  async onUploadKefuQr() {
    try {
      const r = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] });
      const rawPath = r?.tempFiles?.[0]?.tempFilePath;
      if (!rawPath) return;

      wx.showLoading({ title: '处理中...', mask: true });

      // 1. 压缩 (二维码 200KB 足够)
      const compressedPath = await compressImage(rawPath, 200);

      // 2. 上传，传入旧ID自动清理
      const fileID = await uploadAndReplace(compressedPath, this.data.kefuQrFileId, 'kefu_qr');

      this.setData({ kefuQrFileId: fileID, kefuQrPreview: compressedPath, contactChanged: true });

      wx.hideLoading();
      wx.showToast({ title: '已上传', icon: 'success' });
    } catch (e) {
      if (!(e?.errMsg || '').includes('cancel')) {
        console.error('[shop] upload kefu qr error', e);
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    }
  },

  async onSaveContact() {
    const session = getSession();
    if (!session?.token || !this.data.contactChanged) return;

    let serviceHoursToSave = safeStr(this.data.serviceHoursOriginal);

    if (this.data.serviceHoursEdited) {
      const built = buildServiceHoursFromInputRanges(this.data.serviceHoursRanges);
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

    const r = await call('admin', {
      action: 'shop_setConfig',
      token: session.token,
      phone: safeStr(this.data.phone),
      serviceHours: serviceHoursToSave,
      kefuQrUrl: safeStr(this.data.kefuQrFileId),
    }, { loadingTitle: '保存中' }).catch(() => null);
    if (!r?.ok) return wx.showToast({ title: r?.message || '保存失败', icon: 'none' });

    const parsed = parseServiceHoursRanges(serviceHoursToSave);
    const serviceHoursRanges = (parsed && parsed.length) ? parsed.map(rangeToServiceHoursInput) : [emptyServiceHoursRange()];

    this.setData({
      contactChanged: false,
      serviceHours: serviceHoursToSave,
      serviceHoursOriginal: serviceHoursToSave,
      serviceHoursRanges,
      serviceHoursEdited: false,
    });
    wx.showToast({ title: '已保存', icon: 'success' });
  },
};

