const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  console.log('[payCallback] received:', event);

  try {
    const res = await cloud.callFunction({
      name: 'user',
      data: {
        action: 'sys_pay_success',
        payEvent: event
      }
    });

    console.log('[payCallback] user func result:', res.result);

    if (res.result && res.result.errcode === 0) {
      return { errcode: 0, errmsg: 'OK' };
    }

    return { errcode: 0, errmsg: 'OK' };

  } catch (e) {
    console.error('[payCallback] call user func failed:', e);
    return { errcode: 0, errmsg: 'OK' };
  }
};
