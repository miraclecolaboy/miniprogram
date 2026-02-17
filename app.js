const { IS_MERCHANT, MERCHANT_SESSION } = require('./utils/storageKeys');

App({
  globalData: {
    envId: 'cloud1-6gut1mbe9ce138cb',
    isRedirecting: false,
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持 wx.cloud');
      return;
    }
    wx.cloud.init({
      env: this.globalData.envId || undefined,
      traceUser: true,
    });
  },

  onShow() {
    this.checkAndRedirectMerchant();
  },

  checkAndRedirectMerchant() {
    if (this.globalData.isRedirecting) {
      return;
    }

    const isMerchant = wx.getStorageSync(IS_MERCHANT);
    if (!isMerchant) {
      return;
    }

    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    const currentRoute = currentPage ? currentPage.route : '';

    if (currentRoute.startsWith('packages/admin/')) {
      return;
    }

    if (currentRoute === 'pages/mine/mine') {
      return;
    }

    const sess = wx.getStorageSync(MERCHANT_SESSION) || null;
    const hasToken = !!(sess && sess.token);
    const targetUrl = hasToken ? '/packages/admin/pages/goods/index' : '/packages/admin/pages/login/login';
    console.log(`App.onShow: 检测到商家身份，正在跳转到商家端... ${targetUrl}`);

    this.globalData.isRedirecting = true;

    wx.reLaunch({
      url: targetUrl,
      complete: () => {
        setTimeout(() => {
          this.globalData.isRedirecting = false;
        }, 200);
      }
    });
  }
});
