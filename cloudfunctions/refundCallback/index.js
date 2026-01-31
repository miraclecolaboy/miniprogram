const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  console.log('[refundCallback] received:', event);

  try {
    const res = await cloud.callFunction({
      name: 'user',
      data: {
        action: 'sys_refund_success',
        refundEvent: event
      }
    });

    console.log('[refundCallback] user func result:', res.result);

    if (res.result && res.result.errcode === 0) {
      return { errcode: 0, errmsg: 'OK' };
    }
    
    return { errcode: 0, errmsg: 'OK' };

  } catch (e) {
    console.error('[refundCallback] call user func failed:', e);
    return { errcode: 0, errmsg: 'OK' };
  }
};
