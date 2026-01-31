const cloud = require('wx-server-sdk');
const authService = require('./services/authService');
const productService = require('./services/productService');
const orderService = require('./services/orderService');
const shopService = require('./services/shopService');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const action = event.action || '';
  const { OPENID } = cloud.getWXContext();

  // 定时触发器
  const triggerName = String(event?.TriggerName || '').trim();
  if (!action && (event?.Type === 'Timer' || event?.type === 'timer') && triggerName === 'autoDoneTwiceDaily') {
    return await orderService.autoDoneKuaidiOrders();
  }

  try {
    // 登录与会话检查接口
    if (action === 'login') {
      return await authService.login(event.username, event.password, OPENID);
    }
    if (action === 'auth_check_session') {
      const sess = await authService.verifySession(event.token);
      return { ok: !!sess };
    }

    // 统一鉴权
    const sess = await authService.verifySession(event.token);
    if (!sess) return { ok: false, code: 'AUTH_EXPIRED', message: '未登录或登录已过期' };
    
    const user = sess.user;

    // 业务路由分发
    switch (action) {
      // --- 商品与分类 ---
      case 'categories_list': return await productService.listCategories();
      case 'categories_add': return await productService.addCategory(event.name, event.sort, user.username);
      case 'categories_remove': return await productService.removeCategory(event.id, user.role);
      
      case 'products_list': return await productService.listProducts(event);
      case 'product_get_for_edit': return await productService.getProductForEdit(event.id);

      case 'products_add': return await productService.addProduct(event.data, event.id, user.username);
      
      case 'products_update': return await productService.updateProduct(event.id, event.data, event.deletedFileIDs, user.username);
      case 'products_remove': return await productService.removeProduct(event.id, user.role);
      case 'products_toggle': return await productService.toggleProductStatus(event.id, event.onShelf, user.username);
      case 'product_update_skus': return await productService.updateSkus(event.productId, event.skus, user.username);

      // --- 订单管理 ---
      case 'orders_list': return await orderService.listOrders(event.tab, event.pageNum, event.pageSize);
      case 'orders_get': return await orderService.getOrder(event.key || event.id || event.orderId || event.orderNo);
      case 'orders_updateStatus': return await orderService.updateOrderStatus(event.id, event.status, event.note, sess);
      case 'orders_setExpressNo': 
        return await orderService.orderUpdateWithLog({
           id: event.id, 
           patch: { expressNo: event.expressNo, expressNoAt: Date.now() }, 
           sess, 
           action: 'order:setExpressNo', 
           note: event.expressNo 
        }).then(() => ({ok: true}));
      case 'orders_applyRefund': 
        return await orderService.applyRefund(event.id || event.orderId, event.reason, event.remark, sess);
      case 'orders_refundHandle': 
        return await orderService.handleRefund(event.id, event.decision, event.remark, sess);
      case 'orders_refundQuery':
        const db = cloud.database();
        const o = await orderService.getOrder(event.id);
        if(!o) return { ok: true, data: null };
        const outRefundNo = o.refund && (o.refund.outRefundNo || o.refund.out_refund_no);
        if(!outRefundNo) return { ok: false, message: '无退款单号' };
        
        try {
          const res = await cloud.cloudPay.queryRefund({ outRefundNo });
          await db.collection('orders').doc(o._id).update({
             data: { 'refund.refundStatus': res.resultCode==='SUCCESS'?'SUCCESS':res.errCode } 
          });
          return { ok: true, data: res };
        } catch(e) { return { ok: true, data: null }; }
        
      // --- 店铺与积分 ---
      case 'shop_getConfig': return await shopService.getConfig();
      case 'shop_setNotice': return await shopService.setNotice(event.notice);
      case 'shop_setConfig': return await shopService.setConfig(event);
      case 'redeem_gifts_list': return await shopService.listGifts();
      case 'redeem_gifts_upsert': return await shopService.upsertGift(event, user.username);
      case 'redeem_gifts_disable': return await shopService.disableGift(event.id);
      case 'points_consumeCode': return await shopService.consumeCode(event.code);
        
      // --- [新增] 优惠券管理 ---
      case 'coupons_list': return await shopService.listCoupons();
      case 'coupons_upsert': return await shopService.upsertCoupon(event.data, user.username);
      case 'coupons_toggle_status': return await shopService.toggleCouponStatus(event.id, event.status, user.username);

      default:
        return { ok: false, message: `未知 action: ${action}` };
    }

  } catch (e) {
    console.error('[admin] main error', e);
    return { ok: false, message: e.message || '系统繁忙，请稍后重试' };
  }
};
