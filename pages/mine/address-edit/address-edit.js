const KEY_ADDRESS = 'LLJ_ADDRESS';
const { callUser } = require('../../../utils/cloud');

function genId() {
  return `a_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function s(v) {
  return String(v == null ? '' : v).trim();
}

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

function pickFullAddressFromLocation(res) {
  const addr = s(res && res.address);
  const name = s(res && res.name);
  return s([addr, name].filter(Boolean).join(' ')) || addr || name;
}

function removeSuffix(text, suffix) {
  const t = s(text);
  const sfx = s(suffix);
  if (!t || !sfx) return t;
  if (t === sfx) return '';
  if (!t.endsWith(sfx)) return t;
  return s(t.slice(0, t.length - sfx.length));
}

Page({
  data: {
    pageTitle: '新增地址',
    form: {
      id: null,
      name: '',
      phone: '',
      baseAddress: '',
      detail: '',
      isDefault: false,
      lat: null,
      lng: null,
    },
  },

  onLoad() {
    const ec = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (!ec || !ec.on) return;

    ec.on('initAddress', (payload) => {
      const a = (payload && payload.address) || null;
      if (!a) return;

      const legacyRegion = s(a.region);
      const legacyDetail = s(a.detail);
      const legacyFull = s([legacyRegion, legacyDetail].filter(Boolean).join(' '));
      const fullAddress = s(a.address || a.fullAddress || a.poiAddress || a.baseAddress || legacyFull);
      const detail = s(a.detail);
      const baseAddress = s(
        a.baseAddress
          || a.poiAddress
          || a.region
          || removeSuffix(fullAddress, detail)
          || fullAddress
      );

      this.setData({
        pageTitle: '编辑地址',
        form: {
          id: a.id || a._id || null,
          name: s(a.name),
          phone: s(a.phone),
          baseAddress,
          detail,
          isDefault: !!a.isDefault,
          lat: toNum(a.lat ?? a.latitude ?? a.location?.lat, null),
          lng: toNum(a.lng ?? a.longitude ?? a.location?.lng, null),
        },
      });
    });
  },

  onInputName(e) {
    this.setData({ 'form.name': e.detail.value });
  },

  onInputPhone(e) {
    this.setData({ 'form.phone': e.detail.value });
  },

  onInputDetail(e) {
    this.setData({ 'form.detail': e.detail.value });
  },

  onToggleDefault(e) {
    this.setData({ 'form.isDefault': !!e.detail.value });
  },

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
          content: '用于地图选址，请在设置中开启定位权限。',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) wx.openSetting({});
          },
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

    const baseAddress = pickFullAddressFromLocation(res);
    const patch = {
      'form.baseAddress': baseAddress,
    };

    const lat = toNum(res && res.latitude, null);
    const lng = toNum(res && res.longitude, null);
    if (lat != null && lng != null) {
      patch['form.lat'] = lat;
      patch['form.lng'] = lng;
    }

    this.setData(patch);
  },

  async onSave() {
    if (this._saving) return;
    this._saving = true;

    const id = this.data.form.id || genId();
    const name = s(this.data.form.name);
    const phone = s(this.data.form.phone);
    const baseAddress = s(this.data.form.baseAddress);
    const detail = s(this.data.form.detail);
    const address = s([baseAddress, detail].filter(Boolean).join(' '));

    if (!name || !phone) {
      wx.showToast({ title: '请填写收货人和手机号', icon: 'none' });
      this._saving = false;
      return;
    }
    if (!baseAddress) {
      wx.showToast({ title: '请先选择定位位置', icon: 'none' });
      this._saving = false;
      return;
    }

    const payload = {
      id,
      name,
      phone,
      address,
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

      list = list.filter((x) => s(x.id || x._id) !== s(id));
      if (payload.isDefault) list = list.map((x) => ({ ...x, isDefault: false }));
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
  },
});