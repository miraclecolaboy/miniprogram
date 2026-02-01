const KEY_ADDRESS = 'LLJ_ADDRESS';
const { callUser } = require('../../../utils/cloud');

function genId() {
  return `a_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}
function s(v) { return String(v == null ? '' : v).trim(); }
function toNum(v, d = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function norm(v) {
  // 归一化用于去重：去空格/常见分隔符
  return s(v).replace(/[\s,，;；\-—_]+/g, '').toLowerCase();
}

function getSettingAsync() {
  return new Promise((resolve) => {
    wx.getSetting({
      success: resolve,
      fail: () => resolve({ authSetting: {} }),
    });
  });
}
function getLocationAsync() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      success: resolve,
      fail: reject,
    });
  });
}
function chooseLocationAsync() {
  return new Promise((resolve, reject) => {
    wx.chooseLocation({
      success: resolve,
      fail: reject,
    });
  });
}

/**
 * 从地图返回的 address 尽量解析出 region（省市区）与 detail（剩余部分）
 * 你原来的逻辑我保留了，但我们不会自动把 detail 写进表单，避免“默认就带一堆街道”
 */
function parseRegionDetailFromAddress(addr) {
  const text = s(addr);
  if (!text) return { region: '', detail: '' };

  let rest = text;
  let prov = '';
  let city = '';
  let dist = '';

  const mProv = rest.match(/^(北京市|天津市|上海市|重庆市|.+?(?:省|自治区|特别行政区))/);
  if (mProv) {
    prov = mProv[1];
    rest = rest.slice(prov.length);
    if (['北京市', '天津市', '上海市', '重庆市'].includes(prov)) city = prov;
  }

  if (!city) {
    const mCity = rest.match(/^(.+?(?:市|自治州|地区|盟))/);
    if (mCity) {
      city = mCity[1];
      rest = rest.slice(city.length);
    }
  }

  const mDist = rest.match(/^(.+?(?:区|县|旗|市))/);
  if (mDist) {
    dist = mDist[1];
    rest = rest.slice(dist.length);
  }

  if (!prov && !city) {
    const mCity2 = text.match(/^(.+?(?:市|自治州|地区|盟))/);
    if (mCity2) {
      city = mCity2[1];
      rest = text.slice(city.length);
      const mDist2 = rest.match(/^(.+?(?:区|县|旗|市))/);
      if (mDist2) {
        dist = mDist2[1];
        rest = rest.slice(dist.length);
      }
    }
  }

  const parts = [prov, city, dist].filter(Boolean);
  const region = parts.join(' ');

  // 剩余作为 detail（仅解析，不自动写入表单）
  let detail = text;
  if (parts.length) {
    let tmp = text;
    parts.forEach(p => { tmp = tmp.replace(p, ''); });
    detail = s(tmp).replace(/^[,，\s]+/, '');
  }

  return { region, detail };
}

/**
 * 清理用户手填 detail 的重复：
 * - detail 如果包含 base 或 region 的大部分信息，则尝试去掉这些前缀重复
 */
function cleanupDetail(detail, base, region) {
  detail = s(detail);
  if (!detail) return '';

  const dN = norm(detail);
  const baseN = norm(base);
  const regionN = norm(region);

  // 如果用户直接把完整地址粘贴到了 detail：那我们就把 base 当空（避免重复拼）
  // 这里返回 detail 原文，交给 buildFullAddress 决定。
  if (baseN && dN.includes(baseN)) {
    return detail;
  }

  // 如果 detail 以 region 开头（很多人会复制“省市区xx楼xx号”到 detail），去掉 region
  if (regionN && dN.startsWith(regionN)) {
    // 粗暴去掉原文中 region 的出现（更稳的做法需要对齐字符，这里保持简单可用）
    const regionRaw = s(region).replace(/\s+/g, '');
    const detailRaw = detail.replace(/\s+/g, '');
    if (detailRaw.startsWith(regionRaw)) {
      const cut = detailRaw.slice(regionRaw.length);
      return s(cut);
    }
  }

  return detail;
}

/**
 * 拼“完整地址”，但 detail 为空则不追加。
 * 去重逻辑：
 * 1) detail 空 -> base
 * 2) base 空 -> detail
 * 3) detail 已经包含 base（常见于用户粘贴全地址）-> 直接用 detail（避免重复）
 * 4) base 已经包含 detail -> 用 base
 * 5) 否则 base + detail
 */
function buildFullAddress(base, detail) {
  base = s(base);
  detail = s(detail);

  if (!detail) return base;
  if (!base) return detail;

  const baseN = norm(base);
  const detailN = norm(detail);

  if (detailN.includes(baseN)) return detail;   // 用户在 detail 里包含了 base（全地址粘贴）
  if (baseN.includes(detailN)) return base;     // detail 是 base 的子串（比如只写了小区名）
  if (base.includes(detail) || norm(base).endsWith(norm(detail))) return base;

  return `${base} ${detail}`.trim();
}

Page({
  data: {
    pageTitle: '新增地址',
    form: {
      id: null,
      name: '',
      phone: '',

      region: '',
      detail: '',

      // 地图选点：基础地址（街道/小区/POI）
      poiAddress: '',

      isDefault: false,
      lat: null,
      lng: null,
    }
  },

  onLoad() {
    const ec = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ec && ec.on) {
      ec.on('initAddress', (payload) => {
        const a = (payload && payload.address) || null;
        if (!a) return;

        const region = s(a.region);
        const detail = s(a.detail);

        const base = s(a.poiAddress || a.baseAddress || a.fullAddress || a.address || region);

        this.setData({
          pageTitle: '编辑地址',
          form: {
            id: a.id || a._id || null,
            name: a.name || '',
            phone: a.phone || '',
            region,
            detail, // ✅ 保留用户真实补充的 detail（可能为空）
            poiAddress: base,
            isDefault: !!a.isDefault,
            lat: toNum(a.lat ?? a.latitude ?? a.location?.lat, null),
            lng: toNum(a.lng ?? a.longitude ?? a.location?.lng, null),
          }
        });
      });
    }
  },

  onInputName(e) { this.setData({ 'form.name': e.detail.value }); },
  onInputPhone(e) { this.setData({ 'form.phone': e.detail.value }); },
  onInputDetail(e) { this.setData({ 'form.detail': e.detail.value }); },
  onToggleDefault(e) { this.setData({ 'form.isDefault': !!e.detail.value }); },

  async chooseLocation() {
    const setting = await getSettingAsync();
    const authed = !!(setting.authSetting && setting.authSetting['scope.userLocation']);

    if (!authed) {
      try {
        await getLocationAsync();
      } catch (err) {
        console.error('[address-edit] getLocation auth fail', err);
        wx.showModal({
          title: '需要定位权限',
          content: '用于地图选址与地址编辑，请在设置中开启定位权限。',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) wx.openSetting({});
          }
        });
        return;
      }
    }

    let res;
    try {
      res = await chooseLocationAsync();
    } catch (_) {
      return;
    }

    const lat = toNum(res.latitude, null);
    const lng = toNum(res.longitude, null);
    const addr = s(res.address);
    const name = s(res.name);

    const poiAddress = s([addr, name].filter(Boolean).join(' '));

    const parsed = parseRegionDetailFromAddress(addr);
    const region = parsed.region || addr;

    const patch = {
      'form.poiAddress': poiAddress || addr || name || '',
      'form.region': region,
    };

    if (lat != null && lng != null) {
      patch['form.lat'] = lat;
      patch['form.lng'] = lng;
    }

    // ✅ 核心：不再自动填 detail，默认留空，让用户需要时再补充
    // 如果你希望“编辑时切换定位不清空 detail”，这段不动即可。

    this.setData(patch);
  },

  async onSave() {
    if (this._saving) return;
    this._saving = true;

    const name = s(this.data.form.name);
    const phone = s(this.data.form.phone);
    const region = s(this.data.form.region);
    const detailRaw = s(this.data.form.detail);
    const poiAddress = s(this.data.form.poiAddress);

    // ✅ detail 不再强制
    if (!name || !phone) {
      wx.showToast({ title: '请填写收货人和手机号', icon: 'none' });
      this._saving = false;
      return;
    }
    if (!region) {
      wx.showToast({ title: '请点击地图选择定位', icon: 'none' });
      this._saving = false;
      return;
    }

    const id = this.data.form.id || genId();

    const base = poiAddress || region;

    // ✅ detail 去重清理（防止用户把省市区/基础地址重复写进 detail）
    const detail = cleanupDetail(detailRaw, base, region);

    // ✅ 最终展示地址：detail 空就只用 base
    const fullAddress = buildFullAddress(base, detail);

    const payload = {
      id,
      name,
      phone,

      region,
      detail,          // ✅ 可能为空

      poiAddress,      // ✅ 基础地址
      address: fullAddress,
      fullAddress: fullAddress,

      isDefault: !!this.data.form.isDefault,
    };

    const lat = toNum(this.data.form.lat, null);
    const lng = toNum(this.data.form.lng, null);
    if (lat != null && lng != null) {
      payload.lat = lat;
      payload.lng = lng;
    }

    wx.showLoading({ title: '保存中', mask: true });

    try {
      const res = await callUser('upsertAddress', { address: payload });
      const out = res && res.result;
      if (out && out.error) throw new Error(out.error);

      let list = wx.getStorageSync(KEY_ADDRESS) || [];
      if (!Array.isArray(list)) list = [];

      list = list.filter(x => s(x.id || x._id) !== s(id));
      if (payload.isDefault) list = list.map(x => ({ ...x, isDefault: false }));
      list.unshift(payload);
      list.sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));

      wx.setStorageSync(KEY_ADDRESS, list);
      wx.navigateBack();
    } catch (e) {
      console.error('[address-edit] onSave error', e);
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this._saving = false;
    }
  }
});
