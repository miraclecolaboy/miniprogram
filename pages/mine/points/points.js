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

      // 2) 礼品列表：每次进页都后台拉最新库存，但不阻塞首屏
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
      return {
        ...g,
        id,
        points: Math.floor(toNum(g.points, 0)),
        stock: Math.floor(toNum(g.stock, 0)),
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

    wx.showModal({
      title: '确认兑换',
      content: `兑换「${item.name}」需要消耗 ${toNum(item.points, 0)} 积分，是否继续？`,
      success: async (res) => {
        if (!res.confirm) return;

        wx.showLoading({ title: '兑换中', mask: true });
        const u = await ensureLogin().catch(() => null);
        if (!u) {
          wx.showToast({ title: '\u8bf7\u5148\u767b\u5f55', icon: 'none' });
          try { wx.hideLoading(); } catch (_) {}
          return;
        }
        try {
          const r = await callUser('redeemGift', { giftId: item.id });

          if (r?.result?.error === 'not_enough_points') {
            wx.showToast({ title: '积分不足', icon: 'none' });
            return;
          }
          if (r?.result?.error === 'gift_offline') {
            wx.showToast({ title: '该商品已下架', icon: 'none' });
            return;
          }
          if (r?.result?.error === 'out_of_stock') {
            wx.showToast({ title: '库存不足', icon: 'none' });
            return;
          }
          if (r?.result?.error) throw new Error(r.result.message || r.result.error);

          const code = String(r?.result?.data?.code || '');

          // 先做一次乐观库存更新，提升体感（后台会再拉最新库存）
          const idx = (this.data.gifts || []).findIndex(x => x.id === item.id);
          if (idx >= 0) {
            const cur = toNum(this.data.gifts[idx].stock, 0);
            const nextStock = Math.max(0, cur - 1);
            this.setData({ [`gifts[${idx}].stock`]: nextStock });
          }

          // 兑换成功后刷新积分/兑换码，同时后台刷新礼品库存
          await this.refreshPage({ forceGifts: true });

          wx.showModal({
            title: '兑换成功',
            content: `核销码：\n\n${code}\n\n（交给商家核销）`,
            confirmText: '复制',
            cancelText: '关闭',
            success: (rr) => {
              if (!rr.confirm) return;
              wx.setClipboardData({
                data: code,
                success: () => wx.showToast({ title: '已复制', icon: 'success' }),
              });
            },
          });
        } catch (err) {
          console.error('[points] redeem error', err);
          wx.showToast({ title: '兑换失败', icon: 'none' });
        } finally {
          try { wx.hideLoading(); } catch (_) {}
        }
      },
    });
  },

  // 核销码：点击整条记录复制
  onVoucherTap(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;

    wx.setClipboardData({
      data: id,
      success: () => wx.showToast({ title: '已复制', icon: 'none', duration: 1200 }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none', duration: 1200 }),
    });
  },
});
