// pages/mine/points/points.js
const { ensureLogin, refreshUserToStorage } = require('../../../utils/auth');
const { callUser } = require('../../../utils/cloud');
const { toNum, fmtTime } = require('../../../utils/common');

const {
  POINTS: KEY_POINTS,
  POINTS_GIFTS_CACHE: KEY_GIFTS_CACHE,
  POINTS_GIFTS_CACHE_AT: KEY_GIFTS_CACHE_AT,
} = require('../../../utils/storageKeys');


function giftSig(list) {
  if (!Array.isArray(list)) return '';
  const head = list.slice(0, 12).map(x => String(x?.id || x?._id || '')).join(',');
  return `${list.length}:${head}`;
}

Page({
  data: {
    points: 0,
    gifts: [],
    vouchers: [],
  },

  onLoad() {
    // 首屏优先：先用缓存值渲染，避免进页“卡一下/空一下”
    const cachedPoints = toNum(wx.getStorageSync(KEY_POINTS), 0);
    if (cachedPoints !== this.data.points) this.setData({ points: cachedPoints });

    this.loadGiftsFromCache();
    this._alive = true;
    this._giftsReqToken = 0;
    this._giftsFetching = false;
    this._giftRenderTimer = null;
  },

  onHide() {
    this._alive = false;
    if (this._giftRenderTimer) {
      clearTimeout(this._giftRenderTimer);
      this._giftRenderTimer = null;
    }
  },

  onUnload() {
    this._alive = false;
    if (this._giftRenderTimer) {
      clearTimeout(this._giftRenderTimer);
      this._giftRenderTimer = null;
    }
  },

  async onShow() {
    this._alive = true;
    await this.refreshPage({ forceGifts: false });
  },

  async refreshPage({ forceGifts } = {}) {
    try {
      const u = await ensureLogin();
      if (!u) return;

      // 1) 优先刷新积分 + 兑换码（不被礼品列表阻塞）
      const [meRes, listRes] = await Promise.all([
        callUser('getMe', {}),
        // listPoints: [{ code, giftName, costPoints, createdAt }]
        callUser('listPoints', {}),
      ]);

      const me = meRes?.result?.data;

      // vouchers: [{ code, giftName, costPoints, createdAt }]
      const rawCodes = listRes?.result?.data || [];
      const vouchers = (rawCodes || []).map((x) => {
        const code = String(x.code || '');
        const giftName = String(x.giftName || '兑换礼品');
        const costPoints = Math.floor(toNum(x.costPoints, 0));
        const createdAt = toNum(x.createdAt, 0);
        return {
          id: code,
          code,
          giftName,
          costPoints,
          createdAt,
          timeText: fmtTime(createdAt),
        };
      }).filter(v => !!v.code);

      const next = {};
      if (me) {
        const nextPoints = toNum(me.points, 0);
        if (nextPoints !== this.data.points) next.points = nextPoints;

        // 后台写缓存（不 await，避免阻塞）
        refreshUserToStorage(me);
      }

      // 兑换码可能变化频繁，这里直接更新（长度不大）
      next.vouchers = vouchers;

      // 合并一次 setData，减少渲染次数
      this.setData(next);

      // 2) 礼品列表：每次进页都后台拉最新数据，但不阻塞首屏
      this.fetchGiftsInBackground({ force: !!forceGifts });
    } catch (e) {
      console.error('[points] refreshPage error', e);
    }
  },

  loadGiftsFromCache() {
    if ((this.data.gifts || []).length) return;
    const cached = wx.getStorageSync(KEY_GIFTS_CACHE) || [];
    if (Array.isArray(cached) && cached.length) {
      this.setData({ gifts: cached });
    }
  },

  saveGiftsToCache(list) {
    const data = Array.isArray(list) ? list : [];
    wx.setStorage({ key: KEY_GIFTS_CACHE, data });
    wx.setStorage({ key: KEY_GIFTS_CACHE_AT, data: Date.now() });
  },

  normalizeGifts(list) {
    const arr = Array.isArray(list) ? list : [];
    return arr.map((g) => {
      const id = String(g.id || g._id || '');
      const totalQuantity = Math.floor(toNum(g.totalQuantity, 0));
      const leftQuantity = Number.isFinite(Number(g.leftQuantity))
        ? Math.floor(toNum(g.leftQuantity, 0))
        : -1;
      return {
        ...g,
        id,
        points: Math.floor(toNum(g.points, 0)),
        totalQuantity,
        leftQuantity: totalQuantity > 0 ? Math.max(0, leftQuantity) : -1,
      };
    }).filter(g => !!g.id);
  },

  fetchGiftsInBackground({ force } = {}) {
    if (!this._alive) return;
    if (this._giftsFetching && !force) return;

    this._giftsFetching = true;
    const token = ++this._giftsReqToken;

    callUser('listGifts', {})
      .then((res) => {
        if (!this._alive) return;
        if (token !== this._giftsReqToken) return;

        const raw = res?.result?.data;
        if (!Array.isArray(raw)) return;

        const gifts = this.normalizeGifts(raw);

        // 先落缓存（不阻塞 UI）
        this.saveGiftsToCache(gifts);

        // 如果数据没变化，不触发 setData（避免无意义抖动）
        const newSig = giftSig(gifts);
        const oldSig = giftSig(this.data.gifts);
        if (newSig && newSig === oldSig) return;

        this.setGiftsProgressively(gifts);
      })
      .catch(() => {
        // 忽略：保持缓存/旧数据
      })
      .finally(() => {
        if (token === this._giftsReqToken) this._giftsFetching = false;
      });
  },

  setGiftsProgressively(fullList) {
    if (!this._alive) return;
    const list = Array.isArray(fullList) ? fullList : [];

    // 渐进渲染：减少一次性大 setData 导致的进页卡顿
    const total = list.length;
    if (!total) {
      if ((this.data.gifts || []).length) this.setData({ gifts: [] });
      return;
    }

    // 3 段更新：20 -> 80 -> 全量（最多 200）
    const s1 = Math.min(20, total);
    const s2 = Math.min(80, total);

    this.setData({ gifts: list.slice(0, s1) });

    if (s1 === total) return;

    this._giftRenderTimer && clearTimeout(this._giftRenderTimer);
    this._giftRenderTimer = setTimeout(() => {
      if (!this._alive) return;
      this.setData({ gifts: list.slice(0, s2) });

      if (s2 === total) return;

      this._giftRenderTimer && clearTimeout(this._giftRenderTimer);
      this._giftRenderTimer = setTimeout(() => {
        if (!this._alive) return;
        this.setData({ gifts: list });
      }, 16);
    }, 16);
  },

  // 兑换礼品
  onRedeem(e) {
    const id = String(e.currentTarget.dataset.id || '');
    const item = (this.data.gifts || []).find(x => x.id === id);
    if (!item) return;
    if (item.leftQuantity === 0) return wx.showToast({ title: '\u5e93\u5b58\u4e0d\u8db3', icon: 'none' });
    if (this.data.points < toNum(item.points, 0)) return wx.showToast({ title: '\u79ef\u5206\u4e0d\u8db3', icon: 'none' });

    wx.showModal({
      title: '\u786e\u8ba4\u5151\u6362',
      content: `\u786e\u8ba4\u5151\u6362${item.name}\uff0c\u5c06\u6d88\u8017 ${toNum(item.points, 0)} \u79ef\u5206\uff0c\u662f\u5426\u7ee7\u7eed\uff1f`,
      success: async (res) => {
        if (!res.confirm) return;

        wx.showLoading({ title: '\u5151\u6362\u4e2d', mask: true });
        const u = await ensureLogin().catch(() => null);
        if (!u) {
          wx.showToast({ title: '\u8bf7\u5148\u767b\u5f55', icon: 'none' });
          try { wx.hideLoading(); } catch (_) {}
          return;
        }
        try {
          const r = await callUser('redeemGift', { giftId: item.id });

          if (r?.result?.error === 'not_enough_points') {
            wx.showToast({ title: '\u79ef\u5206\u4e0d\u8db3', icon: 'none' });
            return;
          }
          if (r?.result?.error === 'gift_offline') {
            wx.showToast({ title: '\u5546\u54c1\u5df2\u4e0b\u67b6', icon: 'none' });
            return;
          }
          if (r?.result?.error === 'gift_sold_out') {
            wx.showToast({ title: '\u5df2\u5151\u5b8c', icon: 'none' });
            await this.refreshPage({ forceGifts: true });
            return;
          }
          if (r?.result?.error) throw new Error(r.result.message || r.result.error);

          const code = String(r?.result?.data?.code || '');

          await this.refreshPage({ forceGifts: true });

          wx.showModal({
            title: '\u5151\u6362\u6210\u529f',
            content: `\u6838\u9500\u7801\uff1a\n\n${code}\n\n\u8bf7\u5230\u5e97\u51fa\u793a\u7ed9\u5546\u5bb6\u6838\u9500`,
            confirmText: '\u590d\u5236',
            cancelText: '\u5173\u95ed',
            success: (rr) => {
              if (!rr.confirm) return;
              wx.setClipboardData({
                data: code,
                success: () => wx.showToast({ title: '\u5df2\u590d\u5236', icon: 'success' }),
              });
            },
          });
        } catch (err) {
          console.error('[points] redeem error', err);
          wx.showToast({ title: '\u5151\u6362\u5931\u8d25', icon: 'none' });
        } finally {
          try { wx.hideLoading(); } catch (_) {}
        }
      },
    });
  },

  // Tap voucher card to copy redeem code
  onVoucherTap(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;

    wx.setClipboardData({
      data: id,
      success: () => wx.showToast({ title: '\u590d\u5236\u6210\u529f', icon: 'none', duration: 1200 }),
      fail: () => wx.showToast({ title: '\u590d\u5236\u5931\u8d25', icon: 'none', duration: 1200 }),
    });
  },
});
