const { getSession, setSession } = require('../../utils/auth');
const { call } = require('../../utils/cloud'); 
const { IS_MERCHANT } = require('../../../../utils/storageKeys');

Page({
  data: {
    username: '',
    password: '',
    logging: false
  },

  onLoad() {
    wx.setStorageSync(IS_MERCHANT, true);
    
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