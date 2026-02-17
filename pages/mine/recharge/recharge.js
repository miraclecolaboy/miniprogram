const { ensureLogin, refreshUserToStorage } = require('../../../utils/auth');
const { callUser } = require('../../../utils/cloud');
const { fmtMoney, fmtTime, sleep } = require('../../../utils/common');
const { requestPaymentAsync, isUserCancelPay } = require('../../../utils/wxPay');

const { BALANCE: KEY_BALANCE } = require('../../../utils/storageKeys');

function sceneText(scene) {
  const s = String(scene || '');
  if (s === 'recharge') return '余额充值';
  if (s === 'order_pay') return '余额支付';
  if (s === 'refund_balance') return '售后退款';
  return '余额变动';
}

Page({
  data: {
    amount: 0,
    presetAmount: 0,
    customAmount: '',
    balanceText: '0.00',

    showLogPopup: false,
    logScene: '',
    logList: [],
  },

  _paying: false,

  onShow: async function () {
    this.syncBalanceFromStorage();

    try {
      const u = await ensureLogin();
      if (!u) return;

      await refreshUserToStorage();
      this.syncBalanceFromStorage();
    } catch (e) {
      console.error('[recharge] onShow error', e);
    }
  },

  syncBalanceFromStorage() {
    const b = wx.getStorageSync(KEY_BALANCE);
    const txt = fmtMoney(b);
    if (txt !== this.data.balanceText) {
      this.setData({ balanceText: txt });
    }
  },

  noop() {},

  openLogPopup() {
    if (this.data.showLogPopup) return;
    this.setData({ showLogPopup: true });
    this.loadLogs();
  },

  closeLogPopup() {
    if (!this.data.showLogPopup) return;
    this.setData({ showLogPopup: false });
  },

  changeLogScene(e) {
    const scene = String(e.currentTarget.dataset.scene || '');
    if (scene === this.data.logScene) return;
    this.setData({ logScene: scene, logList: [] });
    this.loadLogs();
  },

  async loadLogs() {
    try {
      const u = await ensureLogin();
      if (!u) return;

      const scene = this.data.logScene;
      const res = await callUser('listRecharges', { scene, limit: 100 });
      const out = res?.result;
      if (out?.error) return;

      const list = Array.isArray(out?.data) ? out.data : [];
      const mapped = list.map((it) => {
        const amt = Number(it.amount || 0);
        return {
          _id: it._id,
          scene: it.scene,
          sceneText: sceneText(it.scene),
          timeText: fmtTime(it.createdAt),
          amount: amt,
          amountText: amt < 0 ? `-${fmtMoney(Math.abs(amt))}` : fmtMoney(amt),
          amountClass: amt >= 0 ? 'plus' : 'minus',
        };
      });

      this.setData({ logList: mapped });
    } catch (e) {
      console.error('[recharge] loadLogs error', e);
    }
  },

  selectAmount(e) {
    const amt = Number(e.currentTarget.dataset.amount || 0);
    this.setData({ presetAmount: amt, amount: amt, customAmount: '' });
  },

  onCustomInput(e) {
    const raw = String(e.detail.value || '');
    const amt = Number(raw || 0);
    this.setData({ presetAmount: 0, customAmount: raw, amount: amt });
  },

  onCustomFocus() {
    if (this.data.presetAmount) {
      const amt = Number(this.data.customAmount || 0);
      this.setData({ presetAmount: 0, amount: amt });
    }
  },

  async onPay() {
    const amount = Number(this.data.amount || 0);
    if (!amount || amount <= 0) return wx.showToast({ title: '请选择金额', icon: 'none' });
    if (this._paying) return;

    this._paying = true;

    try {
      const u = await ensureLogin();
      if (!u) return;

      wx.showLoading({ title: '发起支付...', mask: true });

      const createRes = await callUser('createRechargeOrder', { amount, body: '会员充值' });
      const out = createRes?.result;
      if (out?.error) throw new Error(out.message || out.error);

      const { rechargeId, payment } = out?.data || {};
      if (!rechargeId || !payment) throw new Error(out?.message || 'bad_pay_params');

      wx.hideLoading();

      try {
        await requestPaymentAsync(payment);
      } catch (ePay) {
        if (isUserCancelPay(ePay)) {
          callUser('cancelRechargeOrder', { rechargeId }).catch(() => {});
          wx.showToast({ title: '已取消支付', icon: 'none' });
          return;
        }
        throw ePay;
      }

      wx.showLoading({ title: '确认到账...', mask: true });

      let lastErr = null;
      const delays = [0, 800, 1600, 2500, 3500, 5000];

      for (let i = 0; i < delays.length; i++) {
        if (delays[i]) await sleep(delays[i]);

        const res2 = await callUser('confirmRechargePaid', { rechargeId });
        const out2 = res2?.result;

        if (!out2?.error) {
          lastErr = null;
          break;
        }

        if (out2.error === 'not_paid') {
          lastErr = out2;
          continue;
        }

        lastErr = out2;
        break;
      }

      wx.hideLoading();

      const pending = !!(lastErr && lastErr.error === 'not_paid');
      if (pending) {
        wx.showToast({ title: '支付成功，余额到账中', icon: 'none' });
      } else if (lastErr) {
        throw new Error(lastErr.message || lastErr.error || 'confirm_failed');
      } else {
        wx.showToast({ title: '充值成功', icon: 'success' });
      }
      this.setData({ amount: 0, presetAmount: 0, customAmount: '' });

      await refreshUserToStorage();
      this.syncBalanceFromStorage();

      if (pending) {
        setTimeout(() => {
          refreshUserToStorage()
            .then(() => this.syncBalanceFromStorage())
            .catch(() => {});
        }, 2000);
      }
    } catch (e) {
      try { wx.hideLoading(); } catch (_) {}

      const msg = String(e?.errMsg || e?.message || '');

      if (msg.includes('子商户号') || msg.includes('subMchId')) {
        wx.showModal({ title: '未配置支付', content: msg, showCancel: false });
      } else {
        wx.showToast({ title: msg || '充值失败', icon: 'none' });
      }

      console.error('[recharge] pay error', e);
    } finally {
      this._paying = false;
      try { wx.hideLoading(); } catch (_) {}
    }
  },
});
