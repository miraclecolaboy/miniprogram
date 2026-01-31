// pages/order/order.shop.js
// 点单页：门店配置/模式切换/分享

const { callUser } = require('../../utils/cloud');
const { toNum } = require('../../utils/common');

module.exports = {
  async loadShopConfig() {
    try {
      const res = await callUser('getShopConfig');
      const cfg = res?.result?.data || {};

      const kuaidiOn = cfg.kuaidiOn !== false;
      const nextMode = (!kuaidiOn && this.data.mode === 'kuaidi') ? 'ziti' : this.data.mode;

      this.setData({
        storeName: cfg.storeName || '',
        notice: cfg.notice || '',
        storeLat: toNum(cfg.storeLat, 0),
        storeLng: toNum(cfg.storeLng, 0),
        kuaidiOn,
        mode: nextMode,
        minOrderMap: {
          ziti: toNum(cfg.minOrderZiti, 0),
          waimai: toNum(cfg.minOrderWaimai, 88),
          kuaidi: toNum(cfg.minOrderKuaidi, 100),
        },
      });
    } catch (e) {
      console.error('[order] loadShopConfig error', e);
    }
  },

  changeMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === 'kuaidi' && this.data.kuaidiOn === false) {
      wx.showToast({ title: '快递暂未开放', icon: 'none' });
      return;
    }

    if (mode && mode !== this.data.mode) {
      this.setData({ mode }, () => {
        this._filterAndRenderProducts();
        this._render();
      });
    }
  },

  onTapStoreLocation() {
    const { storeLat, storeLng, storeName } = this.data;
    const latitude = toNum(storeLat, 0);
    const longitude = toNum(storeLng, 0);

    if (latitude && longitude) {
      wx.openLocation({
        latitude,
        longitude,
        name: storeName || '门店位置',
      });
    } else {
      wx.showToast({ title: '暂未配置门店位置', icon: 'none' });
    }
  },

  onShareAppMessage() {
    return { title: this.data.storeName, path: '/pages/home/home', imageUrl: '/assets/logo.jpg' };
  },
};

