// cloudfunctions/cloudPrint/receipt.js
// [修改] 移除了 const SHOP_NAME = '蘭来居';

function fmtTime(ts) {
  if (!ts) return '';
  if (typeof ts === 'string') return ts;

  let t = Number(ts || 0);
  if (!t) return '';
  if (t < 1e12) t *= 1000; // 兼容秒级时间戳

  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

// 只显示 HH:mm（并兼容 "立即取餐/立刻取餐"）
function fmtHM(v) {
  if (!v) return '';

  // number: timestamp
  if (typeof v === 'number') {
    let t = v;
    if (t < 1e12) t *= 1000; // 兼容秒级时间戳
    const d = new Date(t);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  const s = String(v).trim();
  if (!s) return '';

  // 统一“立即/立刻取餐”
  if (s === '立即取餐' || s === '立刻取餐') return '立刻取餐';

  // 提取 HH:mm（兼容 "2026-01-13 13:10" / "13:10" / ISO 等）
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    const hh = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // 不是时间就原样返回（比如后端直接传了“立刻取餐”以外的文案）
  return s;
}

function modeLabel(mode, storeSubMode) {
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

function buildItemLines(order) {
  // 优先使用已装饰好的 itemsView
  if (Array.isArray(order?.itemsView) && order.itemsView.length) {
    return order.itemsView
      .map(x => String(x?.line || '').trim())
      .filter(Boolean)
      .map(x => `- ${x.replace(/^\-\s*/, '')}`);
  }

  const items = Array.isArray(order?.items) ? order.items : [];
  const lines = [];
  for (const it of items) {
    const name = String(it?.name || '').trim();
    if (!name) continue;
    const c = Number(it?.count || 0) || 0;
    const spec = String(it?.specText || '').trim();
    lines.push(`- ${name} × ${c}${spec ? `（${spec}）` : ''}`);
  }
  return lines.length ? lines : ['- （无商品明细）'];
}

function getReceiver(order) {
  const receiverName = String(order?.receiverName || '').trim();
  const receiverPhone = String(order?.receiverPhone || '').trim();
  const addrText = String(order?.addrText || '').trim();
  if (receiverName || receiverPhone || addrText) return { name: receiverName, phone: receiverPhone, addrText };

  const addr = order?.address || null;
  const name = String(addr?.name || '').trim();
  const phone = String(addr?.phone || '').trim();
  const region = String(addr?.region || '').trim();
  const detail = String(addr?.detail || '').trim();
  return { name, phone, addrText: `${region}${detail}`.trim() };
}

function getAmountText(order) {
  if (order?.payAmountText) return String(order.payAmountText);
  const n = Number(order?.payAmount || 0);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function getPickupCode(order) {
  if (order?.pickupCodeText) return String(order.pickupCodeText).trim();
  if (order?.pickupCode != null) return String(order.pickupCode).trim();
  return '';
}

// [修改] 增加 storeName 参数
function buildReceiptText(order, storeName) {
  const o = order || {};
  const modeKey = String(o.mode || '').trim();
  const mode = modeLabel(o.mode, o.storeSubMode);
  const isStoreOrder = modeKey === 'ziti';
  
  // [修改] 使用传入的 storeName
  const shopTitle = storeName || '';

  // 到店：提前取一次取餐码，后面复用
  const pickupCode = isStoreOrder ? getPickupCode(o) : '';

  const lines = [];
  lines.push(`<CB>${shopTitle}订单小票</CB>`); // [修改] 动态店名

  // 自提：顶部额外放大显示“xxx”（只显示码）
  if (pickupCode) {
    lines.push(`<CB>${pickupCode}</CB>`);
  }

  const createdAtText = o.createdAtText ? String(o.createdAtText) : fmtTime(o.createdAt);
  if (createdAtText) lines.push(`下单：${createdAtText}`);

  const orderNo = String(o.orderNo || o._id || '').trim();
  if (orderNo) lines.push(`订单号：${orderNo}`);

  if (mode) lines.push(`方式：${mode}`);

  // 到店取餐时间：优先 pickupAtText/pickupAt，其次 pickupTime；都没有就显示“立刻取餐”
  if (isStoreOrder) {
    const raw =
      (o.pickupAtText != null && String(o.pickupAtText).trim())
        ? String(o.pickupAtText).trim()
        : (o.pickupAt != null ? o.pickupAt : (o.pickupTime || ''));

    const pickupShow = fmtHM(raw) || '立刻取餐';
    lines.push(`取餐时间：${pickupShow}`);
    const pickupPhone = String((o.pickupInfo && o.pickupInfo.phone) || o.reservePhone || o.receiverPhone || '').trim();
    if (pickupPhone) lines.push(`预留电话：${pickupPhone}`);
  }

  // 保留原来的“取餐码：xxx”
  if (isStoreOrder) {
    if (pickupCode) lines.push(`取餐码：${pickupCode}`);
  }

  lines.push('----------------');
  lines.push('商品');
  lines.push(...buildItemLines(o));

  const remark = (o.remarkText != null) ? String(o.remarkText).trim() : String(o.remark || '').trim();
  if (remark) {
    lines.push('----------------');
    lines.push(`备注：${remark}`);
  }

  if (!isStoreOrder) {
    const r = getReceiver(o);
    // 手机号不打码：原样输出
    const contact = [r.name, r.phone ? String(r.phone).trim() : ''].filter(Boolean).join(' ');

    lines.push('----------------');
    if (contact) lines.push(`收货：${contact}`);
    if (r.addrText) lines.push(`地址：${r.addrText}`);
  }

  lines.push('----------------');
  lines.push(`合计：¥${getAmountText(o)}`);

  return lines.join('\n') + '\n\n';
}

module.exports = { buildReceiptText };
