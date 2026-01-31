// app.js
const { IS_MERCHANT, MERCHANT_SESSION } = require('./utils/storageKeys');

App({
  globalData: {
    envId: 'cloud1-6gut1mbe9ce138cb',
    isRedirecting: false, //  增加一个全局标志位，防止重复跳转
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
    // --- 核心修改：将跳转逻辑放在 onShow 中 ---
    this.checkAndRedirectMerchant();
  },

  // 封装一个独立的检查和跳转函数
  checkAndRedirectMerchant() {
    // 如果正在跳转，则直接返回，避免重复执行
    if (this.globalData.isRedirecting) {
      return;
    }

    // 1. 检查本地是否存在“商家”标记
    const isMerchant = wx.getStorageSync(IS_MERCHANT);
    if (!isMerchant) {
      // 如果不是商家，则什么也不做
      return;
    }

    // 2. 获取当前页面的路径
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    const currentRoute = currentPage ? currentPage.route : '';

    // 3. 如果当前已经在商家后台的任何页面，则不需要跳转，直接返回
    if (currentRoute.startsWith('packages/admin/')) {
      return;
    }

    // 4. 确认是商家，并且当前在非商家页面，执行跳转
    const sess = wx.getStorageSync(MERCHANT_SESSION) || null;
    const hasToken = !!(sess && sess.token);
    const targetUrl = hasToken ? '/packages/admin/pages/goods/index' : '/packages/admin/pages/login/login';
    console.log(`App.onShow: 检测到商家身份，正在跳转到商家端... ${targetUrl}`);

    // 设置标志位，防止因页面生命周期问题导致的重复跳转
    this.globalData.isRedirecting = true;

    wx.reLaunch({
      url: targetUrl,
      complete: () => {
        // 跳转完成后，在短暂延迟后重置标志位
        setTimeout(() => {
          this.globalData.isRedirecting = false;
        }, 200);
      }
    });
  }
});
