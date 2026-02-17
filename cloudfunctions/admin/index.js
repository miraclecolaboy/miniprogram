const cloud = require('wx-server-sdk');
const authService = require('./services/authService');
const initService = require('./services/initService');
const productService = require('./services/productService');
const orderService = require('./services/orderService');
const shopService = require('./services/shopService');
const analyticsService = require('./services/analyticsService');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event = {}) => {
  const action = event.action || '';
  const { OPENID } = cloud.getWXContext();

  try {
    await initService.ensureCollections();

    if (action === 'login') {
      return await authService.login(event.username, event.password, OPENID);
    }

    if (action === 'auth_check_session') {
      const sess = await authService.verifySession(event.token);
      return { ok: !!sess };
    }

    const sess = await authService.verifySession(event.token);
    if (!sess) return { ok: false, code: 'AUTH_EXPIRED', message: '未登录或登录已过期' };

    switch (action) {
      case 'categories_list':
        return await productService.listCategories();
      case 'categories_add':
        return await productService.addCategory(event.name, event.sort);
      case 'categories_remove':
        return await productService.removeCategory(event.id);

      case 'products_list':
        return await productService.listProducts(event);
      case 'product_get_for_edit':
        return await productService.getProductForEdit(event.id);
      case 'products_add':
        return await productService.addProduct(event.data, event.id);
      case 'products_update':
        return await productService.updateProduct(event.id, event.data, event.deletedFileIDs);
      case 'products_remove':
        return await productService.removeProduct(event.id);
      case 'products_toggle':
        return await productService.toggleProductStatus(event.id, event.onShelf);
      case 'product_update_skus':
        return await productService.updateSkus(event.productId, event.skus);

      case 'orders_list':
        return await orderService.listOrders(event.tab, event.pageNum, event.pageSize);
      case 'orders_get':
        return await orderService.getOrder(event.key || event.id || event.orderId || event.orderNo);
      case 'orders_updateStatus':
        return await orderService.updateOrderStatus(event.id, event.status, event.note, sess);
      case 'orders_setExpressNo':
        return await orderService.orderUpdateWithLog({
          id: event.id,
          patch: { expressNo: event.expressNo, expressNoAt: Date.now() },
          sess,
          action: 'order:setExpressNo',
          note: event.expressNo,
        }).then(() => ({ ok: true }));
      case 'orders_applyRefund':
        return await orderService.applyRefund(event.id || event.orderId, event.reason, event.remark, sess);
      case 'orders_refundHandle':
        return await orderService.handleRefund(event.id, event.decision, event.remark, sess);
      case 'orders_refundQuery': {
        const db = cloud.database();
        const o = await orderService.getOrder(event.id);
        if (!o) return { ok: true, data: null };

        const outRefundNo = o.refund && (o.refund.outRefundNo || o.refund.out_refund_no);
        if (!outRefundNo) return { ok: false, message: '无退款单号' };

        try {
          const res = await cloud.cloudPay.queryRefund({ outRefundNo });
          await db.collection('orders').doc(o._id).update({
            data: { 'refund.refundStatus': res.resultCode === 'SUCCESS' ? 'SUCCESS' : res.errCode },
          });
          return { ok: true, data: res };
        } catch (e) {
          return { ok: true, data: null };
        }
      }

      case 'shop_getConfig':
        return await shopService.getConfig();
      case 'shop_setNotice':
        return await shopService.setNotice(event.notice);
      case 'shop_setConfig':
        return await shopService.setConfig(event);
      case 'redeem_gifts_list':
        return await shopService.listGifts();
      case 'redeem_gifts_upsert':
        return await shopService.upsertGift(event);
      case 'redeem_gifts_disable':
        return await shopService.disableGift(event.id);
      case 'points_consumeCode':
        return await shopService.consumeCode(event.code);

      case 'coupons_list':
        return await shopService.listCoupons();
      case 'coupons_upsert':
        return await shopService.upsertCoupon(event.data);
      case 'coupons_delete':
        return await shopService.deleteCoupon(event.id);
      case 'coupons_toggle_status':
        return await shopService.toggleCouponStatus(event.id, event.status);

      case 'analytics_overview':
        return await analyticsService.getOverview(event);
      case 'analytics_balance_logs':
        return await analyticsService.getBalanceLogs(event.openid, event.limit);

      default:
        return { ok: false, message: `未知 action: ${action}` };
    }
  } catch (e) {
    console.error('[admin] main error', e);
    return { ok: false, message: e.message || '系统繁忙，请稍后重试' };
  }
};
