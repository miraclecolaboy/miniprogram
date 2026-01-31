// 数据库集合常量
const COL_USERS = 'admin_users';
const COL_SESS = 'admin_sessions';
const COL_PRODUCTS = 'products';
const COL_CATEGORIES = 'product_categories';  
const COL_ORDERS = 'orders';
const COL_CUSTOMERS = 'users'; 
const COL_SHOP_CONFIG = 'shop_config';
const COL_RECHARGES = 'recharges';

// 支付配置常量
// [修改] 移除了 SUB_MCH_ID，改为数据库动态读取
const REFUND_CALLBACK_FN = 'refundCallback'; // 退款回调云函数名

module.exports = {
  COL_USERS,
  COL_SESS,
  COL_PRODUCTS,
  COL_CATEGORIES,
  COL_ORDERS,
  COL_CUSTOMERS,
  COL_SHOP_CONFIG,
  COL_RECHARGES,
  REFUND_CALLBACK_FN
};
