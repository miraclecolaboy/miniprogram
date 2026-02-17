
function modeText(mode, storeSubMode) {
  const m = String(mode || '').trim();
  if (m === 'ziti') {
    const raw = String(storeSubMode || '').trim();
    const sub = ['tangshi', 'ziti'].includes(raw) ? raw : 'ziti';
    const subText = sub === 'tangshi' ? '堂食' : '自提';
    return subText;
  }
  if (m === 'waimai') return '外卖';
  if (m === 'kuaidi') return '快递';
  return m;
}

function pickKey(options) {
  const o = options || {};
  return String(o.key || o.id || o.orderId || o.orderNo || o._id || '').trim();
}

function shouldQueryRefund(order) {
  const refund = order?.refund || {};
  const outRefundNo = String(refund?.outRefundNo || refund?.out_refund_no || '').trim();
  const st = String(refund?.status || '').trim().toLowerCase();
  if (!outRefundNo) return false;
  return ['approved', 'approving', 'processing'].includes(st);
}

function mergeApplyReasonText(reason, remark) {
  const r = String(reason || '').trim();
  const m = String(remark || '').trim();
  return [r, m].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

module.exports = {
  mergeApplyReasonText,
  modeText,
  pickKey,
  shouldQueryRefund,
};

