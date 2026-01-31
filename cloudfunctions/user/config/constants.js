// 数据库集合
const COL_USERS = 'users';
const COL_PRODUCTS = 'products';
const COL_CATEGORIES = 'product_categories';
const COL_SHOP_CONFIG = 'shop_config';
const COL_ORDERS = 'orders';
const COL_RECHARGES = 'recharges';

// 支付配置
// 微信支付回调云函数名（= 云函数目录名）
const WX_PAY_CALLBACK_FN = 'payCallback';

// 环境 ID (可选)
const FORCE_ENV_ID = ''; 

// 会员规则
const VIP_RECHARGE_THRESHOLD_FEN = 100000; // 1000元
const VIP_VALID_DAYS = 365;
const VIP_VALID_MS = VIP_VALID_DAYS * 24 * 60 * 60 * 1000;

module.exports = {
  COL_USERS,
  COL_PRODUCTS,
  COL_CATEGORIES,
  COL_SHOP_CONFIG,
  COL_ORDERS,
  COL_RECHARGES,
  WX_PAY_CALLBACK_FN,
  FORCE_ENV_ID,
  VIP_RECHARGE_THRESHOLD_FEN,
  VIP_VALID_MS
};
