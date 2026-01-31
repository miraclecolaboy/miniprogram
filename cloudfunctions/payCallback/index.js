const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  console.log('[payCallback] received:', event);

  // 微信支付回调的 event 结构中包含 outTradeNo, totalFee 等
  // 我们直接将其透传给 user 云函数
  try {
    const res = await cloud.callFunction({
      name: 'user',
      data: {
        action: 'sys_pay_success',
        payEvent: event
      }
    });

    console.log('[payCallback] user func result:', res.result);

    // 只要 user 函数正常返回（没有抛出未捕获异常），就告诉微信成功
    // 即使业务逻辑失败（如重复支付），user 函数也应该返回 {errcode:0} 格式
    if (res.result && res.result.errcode === 0) {
      return { errcode: 0, errmsg: 'OK' };
    }

    // 兜底返回 OK，避免微信侧无限重试导致资源浪费
    // 除非你确定需要重试（如数据库连接偶尔超时），否则一般都返回 OK
    return { errcode: 0, errmsg: 'OK' };

  } catch (e) {
    console.error('[payCallback] call user func failed:', e);
    // 调用失败，返回 OK 避免死循环
    return { errcode: 0, errmsg: 'OK' };
  }
};
