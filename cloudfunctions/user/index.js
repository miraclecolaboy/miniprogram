const cloud = require('wx-server-sdk');
const userService = require('./services/userService');
const shopService = require('./services/shopService');
const tradeService = require('./services/tradeService');
const orderQueryService = require('./services/orderQueryService');
const couponService = require('./services/couponService');
const rechargeService = require('./services/rechargeService');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  let { action } = event;

  try {
    switch (action) {
      case 'loginOrRegister': return await userService.loginOrRegister(event, OPENID);
      case 'getMe': return await userService.getMe(OPENID);
      case 'updateProfile': return await userService.updateProfile(event, OPENID);
      case 'listAddresses': return await userService.listAddresses(OPENID);
      case 'upsertAddress': return await userService.upsertAddress(event, OPENID);
      case 'deleteAddress': return await userService.deleteAddress(event, OPENID);
      
      case 'getShopConfig': return await shopService.getShopConfig();
      case 'listCategories': return await shopService.listCategories();
      case 'listProducts': return await shopService.listProducts();
      case 'listPoints': return await shopService.listPoints(OPENID);
      case 'listGifts': return await shopService.listGifts();
      case 'redeemGift': return await shopService.redeemGift(event.giftId, OPENID);
      case 'listAvailableCoupons': return await shopService.listAvailableCoupons();

      case 'claimCoupon': return await couponService.claimCoupon(event.couponId, OPENID);

      case 'createRechargeOrder': return await rechargeService.createRechargeOrder(event, OPENID);
      case 'confirmRechargePaid': return await rechargeService.confirmRechargePaid(event.rechargeId, OPENID);
      case 'listRecharges': return await rechargeService.listRecharges(OPENID, event);
      case 'cancelRechargeOrder': return await rechargeService.cancelRechargeOrder(event.rechargeId, OPENID);

      case 'createOrder': return await tradeService.createOrder(event, OPENID);
      case 'cancelUnpaidOrder': return await tradeService.cancelUnpaidOrder(event.orderId, OPENID);
      case 'applyRefund': return await tradeService.applyRefund(event.orderId, OPENID, event.reason, event.remark);
      case 'cancelRefund': return await tradeService.cancelRefund(event.orderId, OPENID);
      
      case 'listMyOrders': return await orderQueryService.listMyOrders(OPENID, event);
      case 'getOrderDetail': return await orderQueryService.getOrderDetail(OPENID, event.orderId);
      
      case 'sys_pay_success':
        await Promise.allSettled([
          tradeService.sysHandlePaySuccess(event.payEvent),
          rechargeService.sysHandlePaySuccess(event.payEvent),
        ]);
        return { errcode: 0, errmsg: 'OK' };
      case 'sys_refund_success': return await tradeService.sysHandleRefundSuccess(event.refundEvent);
      
      default: return { error: `unknown_action: ${action}` };
    }
  } catch (e) {
    console.error(`[user] action=${action} error`, e);
    return { error: e.message || 'server_error' };
  }
};
