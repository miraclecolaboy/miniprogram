const FN_USER = 'user';

function callUser(action, data = {}) {
  return wx.cloud.callFunction({
    name: FN_USER,
    data: { action, ...data },
  });
}

module.exports = { callUser };
