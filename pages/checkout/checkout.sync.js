// pages/checkout/checkout.sync.js
// 结算页：本地缓存/用户信息/地址选择等杂项方法

const { ensureLogin, refreshUserToStorage, isLoginOK } = require('../../utils/auth');
const { fmtMoney, toNum } = require('../../utils/common');
const {
  BALANCE: KEY_BALANCE,
  MEMBER_LEVEL: KEY_MEMBER_LEVEL,
  ADDRESS: KEY_ADDRESS,
} = require('../../utils/storageKeys');
const { normalizeAddressForView } = require('../../utils/address');

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
    this.setData({
      balance,
      balanceText: fmtMoney(balance),
      memberLevel,
      isVip: memberLevel >= 4,
    });
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

    this.setData({ address: addr });
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
        }, () => {
          this.recalcCart();
          this.applyDefaultPayMethod();
        });
      }
    } catch (e) {
      console.error('[checkout] syncUserAndCoupons failed', e);
    }
  },

  onRemarkInput(e) { this.setData({ remark: e.detail.value || '' }); },

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
          this.setData({ address: addr }, () => wx.navigateBack());
        }
      },
      success: (res) => {
        res.eventChannel.emit('initAddress', { address: this.data.address, mode: this.data.mode });
      }
    });
  },

  goOpenVip() { wx.navigateTo({ url: '/pages/mine/member/member' }); },
};

