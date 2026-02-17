const { callUser } = require('../../../utils/cloud');

const { ADDRESS: KEY_ADDRESS } = require('../../../utils/storageKeys');
const { normalizeAddressList, pickAddressForUpsert } = require('../../../utils/address');

Page({
  data: {
    list: [],
    mode: '',
    currentId: '',
  },

  _openerChannel: null,

  onLoad() {
    try {
      const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
      this._openerChannel = ch || null;

      if (ch && ch.on) {
        ch.on('initAddress', (payload) => {
          const mode = payload && payload.mode ? String(payload.mode) : '';
          const addr = payload && payload.address ? payload.address : null;
          const currentId = addr && (addr.id || addr._id) ? String(addr.id || addr._id) : '';
          this.setData({ mode, currentId });
        });
      }
    } catch (e) {
      this._openerChannel = null;
    }
  },

  async onShow() {
    const local = normalizeAddressList(wx.getStorageSync(KEY_ADDRESS) || []);
    this.setData({ list: local });

    try {
      const res = await callUser('listAddresses', {});
      const r = res && res.result ? res.result : null;
      if (r && r.error) throw new Error(r.error);

      const list = normalizeAddressList(r && r.data);
      wx.setStorageSync(KEY_ADDRESS, list);
      this.setData({ list });
    } catch (e) {
      console.warn('[address] listAddresses failed, fallback local', e);
    }
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/mine/address-edit/address-edit' });
  },

  onEdit() {
    wx.showModal({
      title: '提示',
      content: '地址不支持编辑，如需修改请删除后重新新增。',
      showCancel: false,
    });
  },

  onChoose(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim();
    if (!id) return;

    const item = (this.data.list || []).find((x) => String(x.id) === id);
    if (!item) return;

    const ch = this._openerChannel || (this.getOpenerEventChannel && this.getOpenerEventChannel());
    if (ch && ch.emit) ch.emit('addressChosen', item);
  },

  async onSetDefault(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim();
    if (!id) return;

    const oldList = normalizeAddressList(wx.getStorageSync(KEY_ADDRESS) || this.data.list || []);
    const hit = oldList.find((x) => String(x.id) === id);
    if (!hit) return;

    const nextList = oldList.map((x) => ({ ...x, isDefault: String(x.id) === id }));
    wx.setStorageSync(KEY_ADDRESS, nextList);
    this.setData({ list: nextList });
    wx.showToast({ title: '已设为默认', icon: 'success' });

    try {
      const payload = pickAddressForUpsert({ ...hit, isDefault: true });
      const res = await callUser('upsertAddress', { address: payload });
      const r = res && res.result ? res.result : null;
      if (r && r.error) throw new Error(r.error);

      await this.onShow();
    } catch (err) {
      console.warn('[address] set default failed', err);
      wx.showToast({ title: '云端同步失败', icon: 'none' });
      wx.setStorageSync(KEY_ADDRESS, oldList);
      this.setData({ list: oldList });
    }
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除地址',
      content: '确定要删除该地址吗？',
      confirmColor: '#111',
      success: async (res) => {
        if (!res.confirm) return;

        let list = normalizeAddressList(wx.getStorageSync(KEY_ADDRESS) || []);
        list = list.filter((item) => item.id !== id);
        wx.setStorageSync(KEY_ADDRESS, list);
        this.setData({ list });
        wx.showToast({ title: '已删除', icon: 'success' });

        try {
          const del = await callUser('deleteAddress', { id });
          const r = del && del.result ? del.result : null;
          if (r && r.error) throw new Error(r.error);
          await this.onShow();
        } catch (e) {
          wx.showToast({ title: '云端删除失败', icon: 'none' });
        }
      },
    });
  },
});
