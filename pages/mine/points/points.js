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
  const head = list.slice(0, 12).map((x) => {
    const id = String(x?.id || x?._id || '');
    const points = Math.floor(toNum(x?.points, 0));
    const left = Math.floor(toNum(x?.leftQuantity, -1));
    const total = Math.floor(toNum(x?.totalQuantity, 0));
    const imageUrl = String(x?.imageUrl || x?.thumbUrl || x?.thumb || x?.img || '');
    return `${id}|${points}|${left}|${total}|${imageUrl}`;
  }).join(',');
  return `${list.length}:${head}`;
}

function pickArray(result) {
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.data)) return result.data.data;
  if (Array.isArray(result?.data?.list)) return result.data.list;
  if (Array.isArray(result?.list)) return result.list;
  return [];
}

Page({
  data: {
    points: 0,
    gifts: [],
    vouchers: [],
  },

  onLoad() {
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
    // 礼品列表独立拉取，不受其它接口影响
    this.fetchGiftsInBackground({ force: !!forceGifts });

    try {
      const u = await ensureLogin();
      if (!u) return;

      // 积分和兑换码分开容错，避免互相阻塞
      const [meRes, listRes] = await Promise.allSettled([
        callUser('getMe', {}),
        callUser('listPoints', {}),
      ]);

      const me = meRes.status === 'fulfilled' ? meRes?.value?.result?.data : null;
      const rawCodes = listRes.status === 'fulfilled' ? pickArray(listRes?.value?.result) : [];

      const vouchers = rawCodes.map((x) => {
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
      }).filter((v) => !!v.code);

      const next = { vouchers };
      if (me) {
        const nextPoints = toNum(me.points, 0);
        if (nextPoints !== this.data.points) next.points = nextPoints;
        refreshUserToStorage(me);
      }

      this.setData(next);
    } catch (e) {
      console.error('[points] refreshPage error', e);
    }
  },

  loadGiftsFromCache() {
    if ((this.data.gifts || []).length) return;
    const cachedRaw = wx.getStorageSync(KEY_GIFTS_CACHE) || [];
    const cached = this.normalizeGifts(cachedRaw);
    if (cached.length) this.setData({ gifts: cached });
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
      const totalQuantity = Math.max(0, Math.floor(toNum(g.totalQuantity, 0)));
      const redeemedQuantity = Math.max(0, Math.floor(toNum(g.redeemedQuantity, 0)));
      const rawLeft = toNum(g.leftQuantity, NaN);
      const leftQuantity = Number.isFinite(rawLeft)
        ? Math.floor(rawLeft)
        : (totalQuantity > 0 ? Math.max(0, totalQuantity - Math.min(totalQuantity, redeemedQuantity)) : -1);

      return {
        ...g,
        id,
        name: String(g.name || g.title || ''),
        desc: String(g.desc || g.description || ''),
        imageUrl: String(g.imageUrl || g.thumbUrl || g.thumb || g.img || '').trim(),
        points: Math.floor(toNum(g.points, 0)),
        totalQuantity,
        leftQuantity: totalQuantity > 0 ? Math.max(0, leftQuantity) : -1,
      };
    }).filter((g) => !!g.id);
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

        const raw = pickArray(res?.result);
        const gifts = this.normalizeGifts(raw);

        this.saveGiftsToCache(gifts);

        const newSig = giftSig(gifts);
        const oldSig = giftSig(this.data.gifts);
        if (newSig && newSig === oldSig) return;

        this.setGiftsProgressively(gifts);
      })
      .catch((e) => {
        console.error('[points] listGifts error', e);
      })
      .finally(() => {
        if (token === this._giftsReqToken) this._giftsFetching = false;
      });
  },

  setGiftsProgressively(fullList) {
    if (!this._alive) return;
    const list = Array.isArray(fullList) ? fullList : [];

    const total = list.length;
    if (!total) {
      if ((this.data.gifts || []).length) this.setData({ gifts: [] });
      return;
    }

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

  onRedeem(e) {
    const id = String(e.currentTarget.dataset.id || '');
    const item = (this.data.gifts || []).find((x) => x.id === id);
    if (!item) return;
    if (item.leftQuantity === 0) return wx.showToast({ title: '库存不足', icon: 'none' });
    if (this.data.points < toNum(item.points, 0)) return wx.showToast({ title: '积分不足', icon: 'none' });

    wx.showModal({
      title: '确认兑换',
      content: `确认兑换${item.name}，将消耗 ${toNum(item.points, 0)} 积分，是否继续？`,
      success: async (res) => {
        if (!res.confirm) return;

        wx.showLoading({ title: '兑换中', mask: true });
        const u = await ensureLogin().catch(() => null);
        if (!u) {
          wx.showToast({ title: '请先登录', icon: 'none' });
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
            wx.showToast({ title: '商品已下架', icon: 'none' });
            return;
          }
          if (r?.result?.error === 'gift_sold_out') {
            wx.showToast({ title: '已兑完', icon: 'none' });
            await this.refreshPage({ forceGifts: true });
            return;
          }
          if (r?.result?.error) throw new Error(r.result.message || r.result.error);

          const code = String(r?.result?.data?.code || '');
          await this.refreshPage({ forceGifts: true });

          wx.showModal({
            title: '兑换成功',
            content: `核销码：\n\n${code}\n\n请到店出示给商家核销`,
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

  onVoucherTap(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;

    wx.setClipboardData({
      data: id,
      success: () => wx.showToast({ title: '复制成功', icon: 'none', duration: 1200 }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none', duration: 1200 }),
    });
  },
});
