
function maskPhone(p) {
  return String(p || '');
}

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

function buildStatusText(o) {
  const st = String(o?.status || '').toLowerCase();
  if (['paid', 'making', 'processing'].includes(st)) return '准备中';
  if (st === 'ready') return '待取餐';
  if (st === 'delivering') return '派送中';
  if (st === 'done') return '已完成';
  if (st === 'cancelled') return '已取消';
  return String(o?.statusText || st || '');
}

function getRefundStatus(o) {
  return String(o?.refund?.status || '').toLowerCase();
}

function needRefundHandle(o) {
  const s = getRefundStatus(o);
  return ['applied', 'applying', 'pending', 'request', 'requested'].includes(s);
}

module.exports = {
  buildStatusText,
  getRefundStatus,
  maskPhone,
  modeText,
  needRefundHandle,
};

