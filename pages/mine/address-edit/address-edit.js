const { ADDRESS: KEY_ADDRESS } = require('../../../utils/storageKeys');
const { callUser } = require('../../../utils/cloud');
const { normalizeAddressList } = require('../../../utils/address');

function genId() {
  return `a_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}
function s(v) { return String(v == null ? '' : v).trim(); }
function toNum(v, d = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
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
    if (['北京市', '天津市', '上海市', '重庆市'].includes(prov)) {
      city = prov;
    }
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

  let detail = text;
  if (parts.length) {
    let tmp = text;
    parts.forEach(p => { tmp = tmp.replace(p, ''); });
    detail = s(tmp).replace(/^[,，\s]+/, '');
  }

  return { region, detail };
}

Page({
  data: {
    pageTitle: '新增地址',
    form: {
      id: null,
      name: '',
      phone: '',

      // 内部仍保存 region/detail，兼容你其它页面逻辑
      region: '',
      detail: '',

      // 展示用：地图选点后直接写到“所在地区”那一行
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
        const full = s(a.fullAddress || a.address || `${region} ${detail}`.trim());

        this.setData({
          pageTitle: '编辑地址',
          form: {
            id: a.id || a._id || null,
            name: a.name || '',
            phone: a.phone || '',
            region,
            detail,
            poiAddress: full,
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

  /** 点击“所在地区”：授权 + 地图选点，并把结果直接显示在该行 */
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
          content: '用于地图选址与外卖快递地址编辑，请在设置中开启定位权限。',
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
      return; // 用户取消
    }

    const lat = toNum(res.latitude, null);
    const lng = toNum(res.longitude, null);
    const addr = s(res.address);
    const name = s(res.name);

    // 展示：完整地址 + 地点名（name 可选）
    const poiAddress = s([addr, name].filter(Boolean).join(' '));

    // 内部：继续拆 region/detail，兼容原数据结构
    const parsed = parseRegionDetailFromAddress(addr);
    const region = parsed.region || addr;
    const detailFromAddr = parsed.detail;

    const patch = {
      'form.poiAddress': poiAddress || addr || name || '',
      'form.region': region,
    };

    if (lat != null && lng != null) {
      patch['form.lat'] = lat;
      patch['form.lng'] = lng;
    }

    // detail：仅在用户还没填时自动填，避免覆盖
    if (!s(this.data.form.detail)) {
      const autoDetail = s((name && detailFromAddr) ? `${name} ${detailFromAddr}` : (detailFromAddr || name || ''));
      if (autoDetail) patch['form.detail'] = autoDetail;
    }

    this.setData(patch);
  },

  async onSave() {
    if (this._saving) return;
    this._saving = true;

    const name = s(this.data.form.name);
    const phone = s(this.data.form.phone);
    const region = s(this.data.form.region);
    const detail = s(this.data.form.detail);

    if (!name || !phone || !detail) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      this._saving = false;
      return;
    }

    if (!region) {
      wx.showToast({ title: '请点击地图选择定位', icon: 'none' });
      this._saving = false;
      return;
    }

    const id = this.data.form.id || genId();

    const fullAddress = s(this.data.form.poiAddress) || `${region} ${detail}`.trim();

    const payload = {
      id,
      name,
      phone,
      region,
      detail,
      address: `${region} ${detail}`.trim(),
      fullAddress, // 给其他页面优先展示用
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

      let list = normalizeAddressList(wx.getStorageSync(KEY_ADDRESS) || []);

      list = list.filter(x => s(x.id) !== s(id));
      if (payload.isDefault) list = list.map(x => ({ ...x, isDefault: false }));
      list.unshift(payload);
      list = normalizeAddressList(list);
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
