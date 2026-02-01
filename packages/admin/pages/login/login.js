// packages/admin/pages/login/login.js
const { getSession, setSession } = require('../../utils/auth');
// [修复] 引入 missing 的 call 方法
const { call } = require('../../utils/cloud'); 
const { IS_MERCHANT } = require('../../../../utils/storageKeys');

Page({
  data: {
    username: '',
    password: '',
    logging: false
  },

  onLoad() {
    // 标记用户为商家，用于 app.js 中的全局跳转逻辑
    wx.setStorageSync(IS_MERCHANT, true);
    
    // 启动时，如本地已有 token 直接进入后台，避免额外的云端校验造成“进入慢/闪一下登录页”
    const session = getSession();
    if (session && session.token) {
      wx.reLaunch({ url: '/packages/admin/pages/goods/index' });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [field]: value });
  },

  async onLogin() {
    const username = (this.data.username || '').trim();
    const password = (this.data.password || '').trim();

    if (!username || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' });
      return;
    }

    this.setData({ logging: true });

    try {
      // 这里的 call 之前未定义，现在已在顶部引入
      const result = await call(
        'admin',
        { action: 'login', username, password },
        { loadingTitle: '登录中' }
      );

      if (!result || !result.ok) {
        wx.showToast({ title: result?.message || '登录失败', icon: 'none' });
        return;
      }

      setSession({
        token: result.token,
        user: result.user,
        expiresAt: result.expiresAt
      });

      wx.showToast({ title: '登录成功', icon: 'success' });
      wx.reLaunch({ url: '/packages/admin/pages/goods/index' });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '登录异常', icon: 'none' });
    } finally {
      this.setData({ logging: false });
    }
  }
});