// pages/checkout/checkout.shop.js
// 结算页：门店配置/取餐时间/到店方式相关方法

const { callUser } = require('../../utils/cloud');
const { toNum } = require('../../utils/common');
const { genPickupTimeSlotsByServiceHours, storeSubModeText } = require('./checkout.helpers');

const DEFAULT_WAIMAI_MAX_KM = 10;

module.exports = {
  async loadShopConfig() {
    try {
      const res = await callUser('getShopConfig', {});
      const cfg = res?.result?.data || {};
      this.setData({
        storeName: cfg.storeName || '',
        storeLat: Number(cfg.storeLat || 0),
        storeLng: Number(cfg.storeLng || 0),
        serviceHours: String(cfg.serviceHours || '').trim(),
        kuaidiOn: cfg.kuaidiOn !== false,
        waimaiMaxKm: Math.max(0, toNum(cfg.waimaiMaxKm, DEFAULT_WAIMAI_MAX_KM)),
        waimaiDeliveryFee: Math.max(0, toNum(cfg.waimaiDeliveryFee, 8)),
        kuaidiDeliveryFee: Math.max(0, toNum(cfg.kuaidiDeliveryFee, 10)),
        minOrderWaimai: Math.max(0, toNum(cfg.minOrderWaimai, 88)),
        minOrderKuaidi: Math.max(0, toNum(cfg.minOrderKuaidi, 88)),
      }, () => {
        if (this.data.mode === 'kuaidi' && this.data.kuaidiOn === false) {
          wx.showToast({ title: '快递暂未开放', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 300);
          return;
        }
        this.genPickupTimes();
      });
      this.recalcCart();
    } catch (e) {}
  },

  genPickupTimes() {
    const { mode } = this.data;

    if (mode === 'waimai') {
      this.setData({ timeList: ['尽快送达'], pickupTime: '尽快送达' });
      return;
    }
    if (mode === 'kuaidi') {
      this.setData({ timeList: ['尽快发货'], pickupTime: '尽快发货' });
      return;
    }

    const list = genPickupTimeSlotsByServiceHours(this.data.serviceHours);
    const cur = this.data.pickupTime;
    const nextPickup = list.includes(cur) ? cur : (list[0] || '立即取餐');
    this.setData({ timeList: list, pickupTime: nextPickup });
  },

  choosePickupTime(e) {
    const val = this.data.timeList[Number(e.detail.value)];
    if (val) this.setData({ pickupTime: val });
  },

  changeStoreSubMode(e) {
    const sub = e.currentTarget.dataset.submode;
    if (!['tangshi', 'ziti'].includes(sub)) return;
    if (this.data.storeSubMode === sub) return;
    this.setData({ storeSubMode: sub, modeText: storeSubModeText(sub) });
  },
};

