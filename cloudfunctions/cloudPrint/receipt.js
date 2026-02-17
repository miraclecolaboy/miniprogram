
function fmtTime(ts) {
  if (!ts) return '';
  if (typeof ts === 'string') return ts;

  let t = Number(ts || 0);
  if (!t) return '';
  if (t < 1e12) t *= 1000;

  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function fmtHM(v) {
  if (!v) return '';

  if (typeof v === 'number') {
    let t = v;
    if (t < 1e12) t *= 1000;
    const d = new Date(t);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  const s = String(v).trim();
  if (!s) return '';
  if (s === '\u7acb\u5373\u53d6\u9910' || s === '\u7acb\u523b\u53d6\u9910') return '\u7acb\u523b\u53d6\u9910';

  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    const hh = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  return s;
}

function modeLabel(mode, storeSubMode) {
  const m = String(mode || '').trim();
  if (m === 'ziti') {
    const sub = String(storeSubMode || '').trim() === 'tangshi' ? '\u5802\u98df' : '\u81ea\u63d0';
    return sub;
  }
  if (m === 'waimai') return '\u5916\u5356';
  if (m === 'kuaidi') return '\u5feb\u9012';
  return m;
}

function buildItemLines(order) {
  if (Array.isArray(order?.itemsView) && order.itemsView.length) {
    return order.itemsView
      .map((x) => String(x?.line || '').trim())
      .filter(Boolean)
      .map((x) => `- ${x.replace(/^\-\s*/, '')}`);
  }

  const items = Array.isArray(order?.items) ? order.items : [];
  const lines = [];

  for (const it of items) {
    const name = String(it?.productName || it?.name || '').trim();
    if (!name) continue;

    const count = Number(it?.count || 0) || 0;
    const spec = String(it?.specText || '').trim();
    lines.push(`- ${name} x ${count}${spec ? `\uff08${spec}\uff09` : ''}`);
  }

  return lines.length ? lines : ['- \uff08\u65e0\u5546\u54c1\u660e\u7ec6\uff09'];
}

function getReceiver(order) {
  const receiverName = String(order?.receiverName || '').trim();
  const receiverPhone = String(order?.receiverPhone || '').trim();
  const addrText = String(order?.addrText || '').trim();

  if (receiverName || receiverPhone || addrText) {
    return { name: receiverName, phone: receiverPhone, addrText };
  }

  const shipping = order?.shippingInfo || order?.address || null;
  const name = String(shipping?.name || '').trim();
  const phone = String(shipping?.phone || '').trim();
  const fullAddress = String(shipping?.address || shipping?.fullAddress || '').trim();
  const region = String(shipping?.region || '').trim();
  const detail = String(shipping?.detail || '').trim();
  const addressText = fullAddress || `${region}${detail}`.trim();
  return { name, phone, addrText: addressText };
}

function getAmountText(order) {
  if (order?.payAmountText != null) return String(order.payAmountText);
  const n = Number(order?.payAmount != null ? order.payAmount : (order?.amount?.total || 0));
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function getBalanceAfterPayText(order) {
  const candidates = [
    order?.payment?.balanceAfterPay,
    order?.balanceAfterPay,
    order?.payment?.balanceAfter,
    order?.balanceAfter,
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n.toFixed(2);
  }
  return '';
}

function getPayMethodText(order) {
  const method = String(order?.payment?.method || '').trim();
  if (method === 'balance') {
    const balanceAfterPayText = getBalanceAfterPayText(order);
    if (balanceAfterPayText) return `\u4f59\u989d\u652f\u4ed8\uff08\u5269\u4f59\u4f59\u989d\uffe5${balanceAfterPayText}\uff09`;
    return '\u4f59\u989d\u652f\u4ed8';
  }
  if (order?.payMethodText) return String(order.payMethodText).trim();
  if (method === 'free') return '\u65e0\u9700\u652f\u4ed8';
  return '\u5fae\u4fe1\u652f\u4ed8';
}

function getAmountDetailText(order) {
  const amount = order?.amount || {};
  const goods = Number(order?.amountGoodsText != null ? order.amountGoodsText : (amount.goods || 0));
  const delivery = Number(order?.amountDeliveryText != null ? order.amountDeliveryText : (amount.delivery || 0));
  const vip = Number(order?.amountVipDiscountText != null
    ? order.amountVipDiscountText
    : (amount.vipDiscount != null ? amount.vipDiscount : (amount.discount || 0)));
  const coupon = Number(order?.amountCouponDiscountText != null ? order.amountCouponDiscountText : (amount.couponDiscount || 0));

  const goodsText = Number.isFinite(goods) ? goods.toFixed(2) : '0.00';
  const deliveryText = Number.isFinite(delivery) ? delivery.toFixed(2) : '0.00';
  const vipText = Number.isFinite(vip) ? vip.toFixed(2) : '0.00';
  const couponText = Number.isFinite(coupon) ? coupon.toFixed(2) : '0.00';

  return `\u91d1\u989d\u660e\u7ec6\uff1a\u5546\u54c1${goodsText} + \u8fd0\u8d39${deliveryText} - \u4f1a\u5458${vipText} - \u4f18\u60e0\u5238${couponText}`;
}

function getPickupCode(order) {
  if (order?.pickupCodeText) return String(order.pickupCodeText).trim();
  if (order?.pickupInfo?.code) return String(order.pickupInfo.code).trim();
  if (order?.pickupCode != null) return String(order.pickupCode).trim();
  return '';
}

function buildReceiptText(order, storeName) {
  const o = order || {};
  const modeKey = String(o.mode || '').trim();
  const mode = modeLabel(o.mode, o.storeSubMode);
  const isStoreOrder = modeKey === 'ziti';
  const shopTitle = String(storeName || '').trim();
  const pickupCode = isStoreOrder ? getPickupCode(o) : '';

  const lines = [];
  lines.push(`<CB>${shopTitle ? `${shopTitle}\u8ba2\u5355\u5c0f\u7968` : '\u8ba2\u5355\u5c0f\u7968'}</CB>`);

  if (pickupCode) {
    lines.push(`<CB>${pickupCode}</CB>`);
  }

  const createdAtText = o.createdAtText ? String(o.createdAtText) : fmtTime(o.createdAt);
  if (createdAtText) lines.push(`\u4e0b\u5355\uff1a${createdAtText}`);

  const orderNo = String(o.orderNo || o._id || '').trim();
  if (orderNo) lines.push(`\u8ba2\u5355\u53f7\uff1a${orderNo}`);

  if (mode) lines.push(`\u65b9\u5f0f\uff1a${mode}`);

  if (isStoreOrder) {
    const raw = (o.pickupAtText != null && String(o.pickupAtText).trim())
      ? String(o.pickupAtText).trim()
      : (o.pickupAt != null ? o.pickupAt : (o.pickupTime || ''));

    const pickupShow = fmtHM(raw) || '\u7acb\u523b\u53d6\u9910';
    lines.push(`\u53d6\u9910\u65f6\u95f4\uff1a${pickupShow}`);

    const pickupPhone = String(
      (o.pickupInfo && o.pickupInfo.phone)
      || o.reservePhone
      || o.receiverPhone
      || ''
    ).trim();

    if (pickupPhone) lines.push(`\u9884\u7559\u7535\u8bdd\uff1a${pickupPhone}`);
  }

  if (isStoreOrder && pickupCode) {
    lines.push(`\u53d6\u9910\u7801\uff1a${pickupCode}`);
  }

  lines.push('----------------');
  lines.push('\u5546\u54c1');
  lines.push(...buildItemLines(o));

  const remark = (o.remarkText != null) ? String(o.remarkText).trim() : String(o.remark || '').trim();
  if (remark) {
    lines.push('----------------');
    lines.push(`\u5907\u6ce8\uff1a${remark}`);
  }

  if (!isStoreOrder) {
    const r = getReceiver(o);
    const contact = [r.name, r.phone].filter(Boolean).join(' ');

    lines.push('----------------');
    if (contact) lines.push(`\u6536\u8d27\uff1a${contact}`);
    if (r.addrText) lines.push(`\u5730\u5740\uff1a${r.addrText}`);
  }

  lines.push('----------------');
  lines.push(`\u5b9e\u4ed8\uff1a\uffe5${getAmountText(o)} \u652f\u4ed8\u65b9\u5f0f\uff1a${getPayMethodText(o)}`);
  lines.push(getAmountDetailText(o));

  return lines.join('\n') + '\n\n';
}

module.exports = { buildReceiptText };
