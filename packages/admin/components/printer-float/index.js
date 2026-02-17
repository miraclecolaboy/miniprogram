const { getSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud');

const { PRINTER_FLOAT_POS: KEY_POS } = require('../../../../utils/storageKeys');

function loadPos() {
  try {
    const v = wx.getStorageSync(KEY_POS);
    if (!v || typeof v !== 'object') return null;
    const x = Number(v.x);
    const y = Number(v.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch (_) {
    return null;
  }
}

function savePos(x, y) {
  try { wx.setStorageSync(KEY_POS, { x, y }); } catch (_) {}
}

function calcDefaultPos() {
  try {
    const info = wx.getSystemInfoSync();
    const ww = Number(info.windowWidth || 375);
    const wh = Number(info.windowHeight || 667);
    const x = Math.max(0, ww - 140);
    const y = Math.max(0, wh - 140);
    return { x, y };
  } catch (_) {
    return { x: 220, y: 520 };
  }
}

function mapStatusToDot(statusText) {
  const s = String(statusText || '');
  return s.includes('在线') && s.includes('正常');
}

Component({
  options: { addGlobalClass: true },

  data: {
    x: 0,
    y: 0,
    bound: false,
    boundText: '云打印：检测中…',
  },

  lifetimes: {
    attached() {
      const pos = loadPos() || calcDefaultPos();
      this.setData({ x: pos.x, y: pos.y });
      this._refreshStatus({ silent: true });
    }
  },

  pageLifetimes: {
    show() {
    }
  },

  methods: {
    _setStatus(bound, text) {
      const boundText = String(text || '');
      if (this.data.bound !== bound || this.data.boundText !== boundText) {
        this.setData({ bound, boundText });
      }
    },

    async _refreshStatus({ silent } = {}) {
      const now = Date.now();
      if (this._reqing) return;
      if (this._lastReqAt && (now - this._lastReqAt) < 1500) return;
      this._lastReqAt = now;

      const session = getSession();
      if (!session || !session.token) {
        this._setStatus(false, '云打印：未登录');
        return;
      }

      this._reqing = true;
      try {
        const r = await call('cloudPrint', {
          action: 'status',
          token: session.token,
        });

        if (!r || !r.ok) {
          this._setStatus(false, '云打印：查询失败');
          if (!silent) wx.showToast({ title: r?.message || '查询失败', icon: 'none' });
          return;
        }

        const statusText = String(r.statusText || '未知');
        const okDot = mapStatusToDot(statusText);
        this._setStatus(okDot, `云打印：${statusText}`);
      } catch (e) {
        this._setStatus(false, '云打印：查询失败');
        if (!silent) wx.showToast({ title: e?.message || '查询失败', icon: 'none' });
      } finally {
        this._reqing = false;
      }
    },

    onMoveChange(e) {
      const d = e && e.detail ? e.detail : {};
      const x = Number(d.x);
      const y = Number(d.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      this._lastXY = { x, y };
      if (this._saveT) clearTimeout(this._saveT);
      this._saveT = setTimeout(() => {
        const last = this._lastXY;
        if (!last) return;
        savePos(last.x, last.y);
        this.setData({ x: last.x, y: last.y });
      }, 200);
    },

    async onTap() {
      if (this._tapLocked) return;
      this._tapLocked = true;
      setTimeout(() => { this._tapLocked = false; }, 180);

      const itemList = ['刷新状态', '测试打印'];

      try {
        const r = await new Promise((resolve, reject) => {
          wx.showActionSheet({ itemList, success: resolve, fail: reject });
        });
        const idx = r.tapIndex;

        if (idx === 0) return await this._refreshStatus({ silent: false });
        if (idx === 1) return await this._doTestPrint();
      } catch (_) {
      }
    },

    async _doTestPrint() {
      const session = getSession();
      if (!session || !session.token) return;

      wx.showLoading({ title: '测试打印', mask: true });
      try {
        const r = await call('cloudPrint', {
          action: 'test',
          token: session.token,
        });

        if (r && r.ok) {
          wx.showToast({ title: '已发送', icon: 'success' });

          this._refreshStatus({ silent: true });
          return;
        }

        wx.showToast({ title: r?.message || '测试失败', icon: 'none' });
      } catch (e) {
        wx.showToast({ title: e?.message || '测试失败', icon: 'none' });
      } finally {
        wx.hideLoading();
      }
    }
  }
});
