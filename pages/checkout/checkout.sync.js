// pages/checkout/checkout.sync.js
// 结算页：本地缓存/用户信息/地址选择等杂项方法

const { ensureLogin, refreshUserToStorage, isLoginOK } = require('../../utils/auth');
const { fmtMoney, toNum } = require('../../utils/common');
const { callUser } = require('../../utils/cloud');
const {
  USER: KEY_USER,
  BALANCE: KEY_BALANCE,
  MEMBER_LEVEL: KEY_MEMBER_LEVEL,
  ADDRESS: KEY_ADDRESS,
} = require('../../utils/storageKeys');
const { normalizeAddressForView } = require('../../utils/address');

function normalizePhone(v) {
  return String(v == null ? '' : v).replace(/\D+/g, '').slice(0, 11);
}

function isValidPhone(v) {
  return /^1\d{10}$/.test(String(v || ''));
}

module.exports = {
  safeSetData(patch) {
    const next = {};
    let changed = false;
    Object.keys(patch || {}).forEach((k) => {
      if (this.data[k] !== patch[k]) {
        next[k] = patch[k];
        changed = true;
      }
    });
    if (changed) this.setData(next);
  },

  syncUserFromStorage() {
    const balance = toNum(wx.getStorageSync(KEY_BALANCE), 0);
    const memberLevel = toNum(wx.getStorageSync(KEY_MEMBER_LEVEL), 0);
    const cachedUser = wx.getStorageSync(KEY_USER) || {};
    const reservePhone = normalizePhone(cachedUser.reservePhone || '');
    this.setData({
      balance,
      balanceText: fmtMoney(balance),
      memberLevel,
      isVip: memberLevel >= 4,
      reservePhone,
    });
    this._lastSavedReservePhone = reservePhone;
  },

  syncDefaultAddressFromStorage(force = false) {
    if (!force && this.data.address) return;

    const list = wx.getStorageSync(KEY_ADDRESS) || [];
    if (!list.length) return;

    const def = list.find(x => x && x.isDefault) || list[0];
    if (!def) return;

    const addr = normalizeAddressForView(def);
    if (this.data.mode === 'waimai' && !this.validateWaimaiAddress(addr, false)) {
      if (force) this.setData({ address: null });
      return;
    }

    this.setData({ address: addr }, () => {
      this.recalcCart();
      if (typeof this.applyDefaultPayMethod === 'function') this.applyDefaultPayMethod();
    });
  },

  async syncUserAndCoupons() {
    if (!isLoginOK()) return;
    try {
      const user = await refreshUserToStorage();
      if (user) {
        this.setData({
          userCoupons: user.coupons || [],
          memberLevel: Number(user.memberLevel || 0),
          isVip: Number(user.memberLevel || 0) >= 4,
          balance: toNum(user.balance, 0),
          balanceText: fmtMoney(user.balance),
          reservePhone: normalizePhone(user.reservePhone || ''),
        }, () => {
          this.recalcCart();
          this.applyDefaultPayMethod();
        });
        this._lastSavedReservePhone = normalizePhone(user.reservePhone || '');
      }
    } catch (e) {
      console.error('[checkout] syncUserAndCoupons failed', e);
    }
  },

  onRemarkInput(e) { this.setData({ remark: e.detail.value || '' }); },

  onReservePhoneInput(e) {
    const reservePhone = normalizePhone(e?.detail?.value);
    this.setData({ reservePhone });
  },

  async onReservePhoneBlur(e) {
    const reservePhone = normalizePhone(e?.detail?.value || this.data.reservePhone || '');
    if (reservePhone !== this.data.reservePhone) this.setData({ reservePhone });
    if (!reservePhone || !isValidPhone(reservePhone)) return;
    await this.persistReservePhone(reservePhone, { silent: true });
  },

  async persistReservePhone(rawPhone, opts = {}) {
    const { silent = false } = opts;
    const reservePhone = normalizePhone(rawPhone);
    if (!reservePhone) return true;
    if (!isValidPhone(reservePhone)) {
      if (!silent) wx.showToast({ title: '请输入11位手机号', icon: 'none' });
      return false;
    }
    if (!isLoginOK()) return true;
    if (reservePhone === this._lastSavedReservePhone) return true;

    this._pendingReservePhone = reservePhone;
    if (this._savingReservePhone) return true;

    while (this._pendingReservePhone) {
      const phoneToSave = this._pendingReservePhone;
      this._pendingReservePhone = '';
      this._savingReservePhone = true;
      try {
        const res = await callUser('updateProfile', { reservePhone: phoneToSave });
        const out = res?.result || {};
        if (out.error) throw new Error(out.message || out.error);
        const me = out?.data || null;
        const savedPhone = normalizePhone((me && me.reservePhone) || phoneToSave);
        this._lastSavedReservePhone = savedPhone;
        if (me) refreshUserToStorage(me).catch(() => {});
        if (savedPhone && this.data.reservePhone !== savedPhone) this.setData({ reservePhone: savedPhone });
      } catch (e) {
        if (!silent) wx.showToast({ title: '电话保存失败，请重试', icon: 'none' });
        this._savingReservePhone = false;
        return false;
      }
      this._savingReservePhone = false;
    }
    return true;
  },

  async chooseAddress() {
    await ensureLogin();
    this._chooseAddrToken = `${Date.now()}`;

    wx.navigateTo({
      url: '/pages/mine/address/address',
      events: {
        addressChosen: (data) => {
          if (!data) return;
          const addr = normalizeAddressForView(data);
          if (this.data.mode === 'waimai' && !this.validateWaimaiAddress(addr, true, 'modal')) return;

          this._chooseAddrEventToken = this._chooseAddrToken;
          this.setData({ address: addr }, () => {
            this.recalcCart();
            if (typeof this.applyDefaultPayMethod === 'function') this.applyDefaultPayMethod();
            wx.navigateBack();
          });
        }
      },
      success: (res) => {
        res.eventChannel.emit('initAddress', { address: this.data.address, mode: this.data.mode });
      }
    });
  },

  goOpenVip() { wx.navigateTo({ url: '/pages/mine/member/member' }); },
};
