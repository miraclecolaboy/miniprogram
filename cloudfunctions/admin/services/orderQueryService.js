const cloud = require('wx-server-sdk');
const { COL_ORDERS } = require('../config/constants');
const { now, formatTimeText, getTempUrlMap } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

async function _mapOrderForView(order) {
  if (!order) return null;

  const type = order.mode || 'ziti';
  const rawStoreSubMode = String(order.storeSubMode || '').trim();
  const storeSubMode = type === 'ziti'
    ? (['tangshi', 'ziti'].includes(rawStoreSubMode) ? rawStoreSubMode : 'ziti')
    : '';
  const storeSubModeText = storeSubMode === 'tangshi' ? '堂食' : (storeSubMode === 'ziti' ? '自提' : '');
  let statusText = order.statusText || '准备中';

  switch (order.status) {
    case 'pending_payment': statusText = '待支付'; break;
    case 'processing': statusText = '准备中'; break;
    case 'ready': statusText = '待取餐'; break;
    case 'delivering': statusText = '派送中'; break;
    case 'done': statusText = '已完成'; break;
    case 'cancelled': statusText = '已取消'; break;
  }
  
  const amount = order.amount || {};
  const fee = {
    goods: Number(amount.goods || 0).toFixed(2),
    delivery: Number(amount.delivery || 0).toFixed(2),
    discount: Number(amount.discount || 0).toFixed(2),
    total: Number(amount.total || 0).toFixed(2),
  };

  const allImageFileIds = (order.items || []).map(it => it.image).filter(Boolean);
  const tempUrlMap = await getTempUrlMap(allImageFileIds);

  const itemsView = (order.items || []).map(it => ({
    ...it,
    image: tempUrlMap[it.image] || it.image || '',
    price: Number(it.price || 0).toFixed(2)
  }));
  
  const isPaid = order.payment?.status === 'paid';
  const isCancelled = order.status === 'cancelled';
  const doneAt = order.doneAt || 0;
  const isDone = order.status === 'done';
  const over3Days = isDone && doneAt > 0 && (now() - doneAt) > 3 * 24 * 60 * 60 * 1000;
  
  const refund = order.refund || null;
  const refundStatus = refund ? (refund.status || 'pending').toLowerCase() : '';
  const canReapplyRefund = refund && ['rejected', 'cancelled'].includes(refundStatus);
  
  const canApplyRefund = isPaid && !isCancelled && !over3Days && (!refund || canReapplyRefund);
  const canCancelPayment = order.status === 'pending_payment';

  return {
    _id: order._id,
    orderNo: order.orderNo,
    status: order.status,
    statusText,
    mode: type,
    storeSubMode,
    storeSubModeText,
    modeText: type === 'ziti' ? (storeSubModeText || '自提') : (type === 'waimai' ? '外卖' : '快递'),
    items: itemsView,
    goodsView: itemsView.map(it => ({ productName: it.productName, count: it.count, image: it.image })),
    amount: fee,
    totalPrice: fee.total,
    totalCount: (order.items || []).reduce((sum, item) => sum + item.count, 0),
    canApplyRefund,
    canCancelPayment,
    isVip: !!order.isVip,
    refund,
    pickupInfo: order.pickupInfo || {},
    shippingInfo: order.shippingInfo || {},
    remark: order.remark || '',
    storeName: order.storeName || '',
    storeLat: order.storeLat || 0,
    storeLng: order.storeLng || 0,
    pointsEarn: order.pointsEarn || 0,
    createdAt: order.createdAt,
    createdAtText: formatTimeText(order.createdAt),
    paidAt: order.paidAt || 0,
    paidAtText: formatTimeText(order.paidAt),
    doneAt: doneAt,
    doneAtText: formatTimeText(doneAt),
  };
}

async function listMyOrders(openid, { tab = 'doing', pageNum = 1, pageSize = 10 }) {
  const skip = (pageNum - 1) * pageSize;
  let query = db.collection(COL_ORDERS).where({ _openid: openid });

  if (tab === 'doing') {
    query = query.where({ status: _.in(['processing', 'ready', 'delivering']) });
  } else if (tab === 'done') {
    query = query.where({ status: _.in(['done', 'cancelled']) });
  } else if (tab === 'refund') {
    query = query.where({ refund: _.exists(true) });
  } else {
    query = query.where({ status: _.neq('pending_payment') });
  }

  const res = await query.orderBy('createdAt', 'desc').skip(skip).limit(pageSize).get();
  
  const list = await Promise.all(res.data.map(order => _mapOrderForView(order)));
  return { data: list.filter(Boolean) };
}

async function getOrderDetail(openid, orderId) {
  if (!orderId) throw new Error('Missing orderId');
  
  const res = await db.collection(COL_ORDERS).doc(orderId).get();
  
  if (!res.data || res.data._openid !== openid) {
    return { error: 'order_not_found', message: 'Order not found or permission denied' };
  }
  
  const mappedOrder = await _mapOrderForView(res.data);
  return { data: mappedOrder };
}

module.exports = {
  listMyOrders,
  getOrderDetail,
};
