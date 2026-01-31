// packages/admin/pages/shop/index.js
const { requireLogin, getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { safeStr, pad2, toNum } = require('../../../../utils/common');
const { parseServiceHoursRanges, fmtMinOfDay } = require('../../../../utils/serviceHours');
const { getTempUrlMap } = require('../../../../utils/cloudFile');
// [修改] 引入统一上传与图像处理工具
const { uploadAndReplace, compressImage, generateThumbnail } = require('../../../../utils/uploader');

function toInt(v, d = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function emptyServiceHoursRange() { return { sh: '', sm: '', eh: '', em: '' }; }
function sanitizeDigits2(v) { return safeStr(v).replace(/[^\d]/g, '').slice(0, 2); }

function normalizeServiceHours(text) {
  const ranges = parseServiceHoursRanges(text);
  if (!ranges) return { ok: false, normalized: '' };
  return { ok: true, normalized: ranges.map(r => `${fmtMinOfDay(r.start)}-${fmtMinOfDay(r.end)}`).join(' ') };
}

function rangeToServiceHoursInput(r) {
  const start = Math.max(0, Math.floor(Number(r?.start || 0)));
  const end = Math.max(0, Math.floor(Number(r?.end || 0)));
  const sh = Math.floor(start / 60);
  const sm = start % 60;
  const eh = Math.floor(end / 60);
  const em = end % 60;
  return { sh: pad2(sh), sm: pad2(sm), eh: pad2(eh), em: pad2(em) };
}

function buildServiceHoursFromInputRanges(ranges) {
  const arr = Array.isArray(ranges) ? ranges : [];
  const out = [];

  const isValidHm = (h, m) => {
    if (!Number.isInteger(h) || !Number.isInteger(m)) return false;
    if (h === 24) return m === 0;
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  };

  for (let i = 0; i < arr.length; i += 1) {
    const r = arr[i] || {};
    const shStr = safeStr(r.sh);
    const smStr = safeStr(r.sm);
    const ehStr = safeStr(r.eh);
    const emStr = safeStr(r.em);

    const hasAny = shStr || smStr || ehStr || emStr;
    if (!hasAny) continue;

    // 分钟可不填，默认 00；小时必须填
    if (!shStr || !ehStr) return { ok: false, message: `请填写完整的时段${i + 1}` };

    const sh = parseInt(shStr, 10);
    const sm = smStr ? parseInt(smStr, 10) : 0;
    const eh = parseInt(ehStr, 10);
    const em = emStr ? parseInt(emStr, 10) : 0;

    if (![sh, sm, eh, em].every(Number.isFinite)) return { ok: false, message: `时段${i + 1}时间不正确` };
    if (!isValidHm(sh, sm) || !isValidHm(eh, em) || sh === 24) return { ok: false, message: `时段${i + 1}时间不正确` };

    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (end <= start) return { ok: false, message: `时段${i + 1}结束时间需大于开始时间` };

    out.push(`${pad2(sh)}:${pad2(sm)}-${pad2(eh)}:${pad2(em)}`);
  }

  return { ok: true, raw: out.join(' ') };
}

Page({
  data: {
    // 公告
    notice: '',
    noticeChanged: false,

    // 轮播图
    banners: [], // { fileId, preview }

    // 配送
    waimaiMaxKm: 10,
    waimaiDeliveryFee: '8',
    kuaidiOn: true,
    kuaidiDeliveryFee: '10',
    minOrderWaimai: '88',
    minOrderKuaidi: '88',
    configChanged: false,

    // 微信支付（子商户号）
    subMchId: '',
    payChanged: false,

    // 客服信息
    phone: '',
    serviceHours: '',
    serviceHoursOriginal: '',
    serviceHoursRanges: [emptyServiceHoursRange()],
    serviceHoursEdited: false,
    kefuQrFileId: '',
    kefuQrPreview: '',
    contactChanged: false,

    // 云打印配置
    cloudPrinterSn: '',
    cloudPrinterUser: '',
    cloudPrinterKey: '',
    cloudPrinterTimes: '',
    cloudPrintChanged: false,

    // 礼品
    giftForm: { name: '', points: '', stock: '', desc: '', thumbFileId: '', thumbPreview: '' },
    gifts: [],
    editingGiftId: '',
    editingGiftName: '',

    // 核销
    consumeCode: '',
    consumeTip: '',
     // 优惠券管理 
     coupons: [],
     couponSaving: false,
     editingCouponId: '',
     editingCouponTitle: '', 
     couponForm: {
       title: '',
       minSpend: '',
       discount: '',
       totalQuantity: '',
     },
  },

  onLoad() {
    requireLogin();
    this.init();
  },

  onShow() {
    const s = requireLogin();
    if (!s) return;
  },

  async init() {
    await Promise.allSettled([this.loadConfig(), this.loadGifts()]); 
    this.loadCoupons();
  },

  async onReload() {
    await this.init();
    wx.showToast({ title: '已刷新', icon: 'success' });
  },

  async loadConfig() {
    const session = getSession();
    if (!session?.token) return;

    const r = await call('admin', { action: 'shop_getConfig', token: session.token }).catch(() => null);
    if (!r?.ok) return;

    const cfg = r.data || {};
    
    // 处理图片资源
    const kefuQrFileId = safeStr(cfg.kefuQrUrl);
    const bannerIds = Array.isArray(cfg.banners) ? cfg.banners : [];
    
    // 批量换取临时链接
    const allIds = [...(kefuQrFileId ? [kefuQrFileId] : []), ...bannerIds];
    const urlMap = await getTempUrlMap(allIds);

    const kefuQrPreview = kefuQrFileId ? (urlMap[kefuQrFileId] || '') : '';
    const banners = bannerIds.map(fid => ({
        fileId: fid,
        preview: urlMap[fid] || ''
    }));

    const serviceHoursText = safeStr(cfg.serviceHours);
    const parsedServiceRanges = parseServiceHoursRanges(serviceHoursText);
    const serviceHoursRanges = (parsedServiceRanges && parsedServiceRanges.length)
      ? parsedServiceRanges.map(rangeToServiceHoursInput)
      : [emptyServiceHoursRange()];

    this.setData({
      notice: safeStr(cfg.notice),
      noticeChanged: false,

      banners,

      waimaiMaxKm: Number(cfg.waimaiMaxKm ?? 10),
      waimaiDeliveryFee: String(cfg.waimaiDeliveryFee ?? 8),
      kuaidiOn: cfg.kuaidiOn !== false,
      kuaidiDeliveryFee: String(cfg.kuaidiDeliveryFee ?? 10),
      minOrderWaimai: String(cfg.minOrderWaimai ?? 88),
      minOrderKuaidi: String(cfg.minOrderKuaidi ?? 88),
      configChanged: false,

      subMchId: safeStr(cfg.subMchId),
      payChanged: false,

      phone: safeStr(cfg.phone),
      serviceHours: serviceHoursText,
      serviceHoursOriginal: serviceHoursText,
      serviceHoursRanges,
      serviceHoursEdited: false,
      kefuQrFileId,
      kefuQrPreview,
      contactChanged: false,
      
      cloudPrinterSn: safeStr(cfg.cloudPrinterSn),
      cloudPrinterUser: safeStr(cfg.cloudPrinterUser),
      cloudPrinterKey: safeStr(cfg.cloudPrinterKey),
      cloudPrinterTimes: safeStr(cfg.cloudPrinterTimes),
      cloudPrintChanged: false,
    });
  },

  // --- 公告 ---
  onNoticeInput(e) { this.setData({ notice: safeStr(e.detail.value), noticeChanged: true }); },
  async onSaveNotice() {
    const session = getSession();
    if (!session?.token) return;
    if (!this.data.noticeChanged) return;
    const r = await call('admin', {
      action: 'shop_setNotice', token: session.token, notice: safeStr(this.data.notice),
    }, { loadingTitle: '保存中' }).catch(() => null);
    if (!r?.ok) return wx.showToast({ title: r?.message || '保存失败', icon: 'none' });
    this.setData({ noticeChanged: false });
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  // --- 配送 & 轮播图 ---
  onWaimaiMaxKmInput(e) { this.setData({ waimaiMaxKm: safeStr(e.detail.value), configChanged: true }); },
  onWaimaiDeliveryFeeInput(e) { this.setData({ waimaiDeliveryFee: safeStr(e.detail.value), configChanged: true }); },
  onKuaidiOnChange(e) { this.setData({ kuaidiOn: !!e.detail.value, configChanged: true }); },
  onKuaidiDeliveryFeeInput(e) { this.setData({ kuaidiDeliveryFee: safeStr(e.detail.value), configChanged: true }); },
  onMinOrderWaimaiInput(e) { this.setData({ minOrderWaimai: safeStr(e.detail.value), configChanged: true }); },
  onMinOrderKuaidiInput(e) { this.setData({ minOrderKuaidi: safeStr(e.detail.value), configChanged: true }); },
  
  // [修改] 轮播图管理 - 使用压缩
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
      
      const ok = await new Promise(res => wx.showModal({ title: '删除轮播图?', content: '确认删除这张图片吗？', success: r => res(r.confirm) }));
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
    // 允许仅保存轮播图，即使 configChanged 为 false (如果是直接删除操作可能需要优化，但这里 configChanged 会被置 true)
    if (!session?.token) return;
    if (!this.data.configChanged) return;
    
    const bannerIds = this.data.banners.map(b => b.fileId).filter(Boolean);

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

  // --- 微信支付 ---
  onSubMchIdInput(e) { this.setData({ subMchId: safeStr(e.detail.value), payChanged: true }); },
  async onSavePayConfig() {
    const session = getSession();
    if (!session?.token || !this.data.payChanged) return;

    const subMchId = safeStr(this.data.subMchId);
    if (!subMchId) return wx.showToast({ title: '请填写子商户号', icon: 'none' });

    const r = await call('admin', {
      action: 'shop_setConfig',
      token: session.token,
      subMchId,
    }, { loadingTitle: '保存中' }).catch(() => null);

    if (!r?.ok) return wx.showToast({ title: r?.message || '保存失败', icon: 'none' });
    this.setData({ payChanged: false });
    wx.showToast({ title: '已保存', icon: 'success' });
  },

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
  
  // [修改] 客服二维码上传 - 使用压缩
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

  // --- 云打印 ---
  onCloudPrintInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [field]: safeStr(e.detail.value),
      cloudPrintChanged: true
    });
  },
  async onSaveCloudPrint() {
    const session = getSession();
    if (!session?.token || !this.data.cloudPrintChanged) return;
    const { cloudPrinterSn, cloudPrinterUser, cloudPrinterKey, cloudPrinterTimes } = this.data;
    if (!cloudPrinterSn || !cloudPrinterUser || !cloudPrinterKey) {
      return wx.showToast({ title: 'SN、USER、UKEY均为必填项', icon: 'none' });
    }
    const r = await call('admin', {
      action: 'shop_setConfig',
      token: session.token,
      cloudPrinterSn,
      cloudPrinterUser,
      cloudPrinterKey,
      cloudPrinterTimes: toInt(cloudPrinterTimes, 1)
    }, { loadingTitle: '保存中' }).catch(() => null);
    if (!r?.ok) return wx.showToast({ title: r?.message || '保存失败', icon: 'none' });
    this.setData({ cloudPrintChanged: false });
    wx.showToast({ title: '打印机配置已保存', icon: 'success' });
  },

  // ===== 积分兑换商品（shop_config: points_gift）=====
  async loadGifts() {
    const session = getSession();
    if (!session?.token) return;

    const r = await call('admin', { action: 'redeem_gifts_list', token: session.token }).catch(() => null);
    if (!r?.ok) return;

    const list = Array.isArray(r.list) ? r.list : [];
    const fileIds = list.map(x => safeStr(x.thumbFileId)).filter(Boolean);
    const urlMap = await getTempUrlMap(fileIds);

    const gifts = list.map(x => {
      const stock = Number.isFinite(Number(x.stock)) ? parseInt(x.stock, 10) : 0;
      return {
        ...x,
        stock,
        stockText: stock === 0 ? '售罄' : String(stock),
        thumbUrl: x.thumbFileId ? (urlMap[x.thumbFileId] || '') : '',
      };
    });

    this.setData({ gifts });
  },

  onGiftNameInput(e) {
    this.setData({ giftForm: { ...this.data.giftForm, name: safeStr(e.detail.value) } });
  },
  onGiftPointsInput(e) {
    this.setData({ giftForm: { ...this.data.giftForm, points: safeStr(e.detail.value) } });
  },
  onGiftStockInput(e) {
    this.setData({ giftForm: { ...this.data.giftForm, stock: safeStr(e.detail.value) } });
  },
  onGiftDescInput(e) {
    this.setData({ giftForm: { ...this.data.giftForm, desc: safeStr(e.detail.value) } });
  },

  // [修改] 积分礼品图片上传 - 强制生成 300x300 缩略图
  async onUploadGiftThumb() {
    try {
      const r = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
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
    const g = (this.data.gifts || []).find(x => x.id === id);
    if (!g) return;

    this.setData({
      editingGiftId: g.id,
      editingGiftName: g.name,
      giftForm: {
        name: g.name,
        points: String(g.points || ''),
        stock: String(Number.isFinite(Number(g.stock)) ? parseInt(g.stock, 10) : 0),
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
      giftForm: { name: '', points: '', stock: '0', desc: '', thumbFileId: '', thumbPreview: '' },
    });
  },

  async onSaveGift() {
    const session = getSession();
    if (!session?.token) return;

    const name = safeStr(this.data.giftForm.name);
    const points = toInt(this.data.giftForm.points, 0);
    const stock = toInt(this.data.giftForm.stock, -1);
    const desc = safeStr(this.data.giftForm.desc);
    const thumbFileId = safeStr(this.data.giftForm.thumbFileId);

    if (!name) return wx.showToast({ title: '请输入商品名字', icon: 'none' });
    if (!points || points <= 0) return wx.showToast({ title: '所需积分必须大于0', icon: 'none' });
    if (stock < 0) return wx.showToast({ title: '库存必须>=0', icon: 'none' });
    if (desc.length > 200) return wx.showToast({ title: '描述最多200字', icon: 'none' });

    const r = await call('admin', {
      action: 'redeem_gifts_upsert',
      token: session.token,
      id: this.data.editingGiftId || '',
      name,
      points,
      stock,
      desc,
      thumbFileId,
    }, { loadingTitle: '保存中' }).catch(() => null);

    if (!r?.ok) return wx.showToast({ title: r?.message || '保存失败', icon: 'none' });

    wx.showToast({ title: '已保存', icon: 'success' });

    this.setData({
      editingGiftId: '',
      editingGiftName: '',
      giftForm: { name: '', points: '', stock: '0', desc: '', thumbFileId: '', thumbPreview: '' },
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

  // ===== 核销（6位码，核销后即消失）=====
  onConsumeCodeInput(e) {
    this.setData({ consumeCode: safeStr(e.detail.value), consumeTip: '' });
  },

  async onConsume() {
    const session = getSession();
    if (!session?.token) return;

    const code = safeStr(this.data.consumeCode);
    if (!/^\d{6}$/.test(code)) {
      this.setData({ consumeTip: '核销码必须是6位数字' });
      return wx.showToast({ title: '请输入6位核销码', icon: 'none' });
    }

    const r = await call('admin', { action: 'points_consumeCode', token: session.token, code }, { loadingTitle: '核销中' }).catch(() => null);

    if (!r?.ok) {
      const msg = r?.message || '核销失败';
      this.setData({ consumeTip: msg });
      return wx.showToast({ title: msg, icon: 'none' });
    }

    this.setData({ consumeCode: '', consumeTip: '核销成功' });

    wx.showModal({
      title: '核销成功',
      content: `礼品：${r.data?.giftName || ''}\n消耗积分：${r.data?.costPoints || ''}`,
      showCancel: false,
    });
  },
    // ===== 优惠券管理 (嵌入式表单逻辑) =====
    async loadCoupons() {
      const session = getSession();
      if (!session?.token) return;
      try {
        const res = await call('admin', { action: 'coupons_list', token: session.token });
        if (res && res.ok) {
          this.setData({ coupons: res.list || [] });
        }
      } catch (e) {
        console.error('[shop] loadCoupons failed', e);
      }
    },
  
    // 点击“编辑”按钮
    openEditCoupon(e) {
      const id = e.currentTarget.dataset.id;
      const coupon = this.data.coupons.find(c => c._id === id);
      if (!coupon) return;
  
      this.setData({
        editingCouponId: id,
        editingCouponTitle: coupon.title,
        couponForm: {
          title: coupon.title,
          minSpend: String(coupon.minSpend),
          discount: String(coupon.discount),
          totalQuantity: String(coupon.totalQuantity),
        }
      });
      // 滚动到页面顶部，方便编辑
      wx.pageScrollTo({ scrollTop: 0, duration: 300 });
    },
  
    // 点击“取消编辑”
    cancelCouponEdit() {
      this.setData({
        editingCouponId: '',
        editingCouponTitle: '',
        couponForm: { title: '', minSpend: '', discount: '', totalQuantity: '' },
      });
    },
  
    onCouponFormInput(e) {
      const field = e.currentTarget.dataset.field;
      this.setData({
        [`couponForm.${field}`]: e.detail.value
      });
    },
  
    async saveCouponForm() {
      if (this.data.couponSaving) return;
  
      const { couponForm, editingCouponId } = this.data;
      const data = {
        id: editingCouponId || '',
        title: safeStr(couponForm.title),
        minSpend: toNum(couponForm.minSpend),
        discount: toNum(couponForm.discount),
        totalQuantity: toInt(couponForm.totalQuantity),
      };
  
      if (!data.title) return wx.showToast({ title: '请输入优惠券标题', icon: 'none' });
      if (data.minSpend < 0) return wx.showToast({ title: '最低消费金额不合法', icon: 'none' });
      if (data.discount <= 0) return wx.showToast({ title: '减免金额必须大于0', icon: 'none' });
      if (data.minSpend > 0 && data.discount > data.minSpend) return wx.showToast({ title: '减免金额不能大于最低消费', icon: 'none' });
      if (data.totalQuantity <= 0) return wx.showToast({ title: '总数量必须大于0', icon: 'none' });
  
      this.setData({ couponSaving: true });
      
      try {
        const res = await call('admin', {
          action: 'coupons_upsert',
          token: getSession().token,
          data: data
        }, { loadingTitle: '保存中' });
  
        if (!res.ok) throw new Error(res.message || '保存失败');
        
        wx.showToast({ title: '已保存', icon: 'success' });
        this.cancelCouponEdit(); // 保存成功后清空表单
        await this.loadCoupons();
      } catch (e) {
        wx.showToast({ title: e.message || '保存失败', icon: 'none' });
      } finally {
        this.setData({ couponSaving: false });
      }
    },
  
    async toggleCouponStatus(e) {
      const { id, status } = e.currentTarget.dataset;
      const newStatus = status !== 'active';
      const confirmText = newStatus ? '上架' : '下架';
  
      const { confirm } = await new Promise(resolve => wx.showModal({
        title: `确认${confirmText}？`,
        content: newStatus ? '上架后用户即可领取。' : '下架后用户将无法领取。',
        success: resolve,
      }));
  
      if (!confirm) return;
  
      try {
        await call('admin', {
          action: 'coupons_toggle_status',
          token: getSession().token,
          id,
          status: newStatus
        }, { loadingTitle: '处理中' });
        
        wx.showToast({ title: `已${confirmText}`, icon: 'success' });
        await this.loadCoupons();
      } catch (e) {
        wx.showToast({ title: e.message || '操作失败', icon: 'none' });
      }
    },
  
    noop() {},
});