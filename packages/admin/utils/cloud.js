const { clearSession } = require('./auth');

let _authRedirecting = false;

function isOnLoginPage() {
  try {
    const pages = getCurrentPages();
    const cur = pages && pages.length ? pages[pages.length - 1] : null;
    return cur && cur.route === 'packages/admin/pages/login/login';
  } catch (e) {
    return false;
  }
}

function redirectToLoginOnce() {
  if (_authRedirecting) return;
  _authRedirecting = true;

  clearSession();

  if (!isOnLoginPage()) {
    wx.reLaunch({ url: '/packages/admin/pages/login/login' });
  }

  setTimeout(() => {
    _authRedirecting = false;
  }, 1200);
}

function call(fnName, data = {}, { loadingTitle = '' } = {}) {
  if (loadingTitle) wx.showLoading({ title: loadingTitle, mask: true });

  return wx.cloud.callFunction({
    name: fnName,
    data
  }).then(res => {
    const result = res?.result;

    if (result?.code === 'AUTH_EXPIRED') {
      redirectToLoginOnce();
      return Promise.reject(result);
    }

    return result;
  }).finally(() => {
    if (loadingTitle) wx.hideLoading();
  });
}

module.exports = { call };
