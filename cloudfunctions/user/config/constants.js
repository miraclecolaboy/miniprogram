const COL_USERS = 'users';
const COL_PRODUCTS = 'products';
const COL_CATEGORIES = 'product_categories';
const COL_SHOP_CONFIG = 'shop_config';
const COL_ORDERS = 'orders';
const COL_RECHARGES = 'recharges';

const WX_PAY_CALLBACK_FN = 'payCallback';

const FORCE_ENV_ID = ''; 

const VIP_RECHARGE_THRESHOLD_FEN = 100000;
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
