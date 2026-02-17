
const { safeStr, toNum } = require('./common');

function buildCouponGroupKey(c) {
  const couponId = safeStr(c?.couponId);
  if (!couponId) return '';
  const title = safeStr(c?.title);
  const minSpend = toNum(c?.minSpend, 0);
  const discount = toNum(c?.discount, 0);
  return `${couponId}|${minSpend}|${discount}|${title}`;
}

function _groupCouponInstances(list) {
  const arr = Array.isArray(list) ? list : [];
  const groups = [];
  const itemsMap = new Map();
  const groupMap = new Map();

  arr.forEach((c) => {
    const key = buildCouponGroupKey(c);
    if (!key) return;

    let g = groupMap.get(key);
    if (!g) {
      g = {
        groupKey: key,
        couponId: safeStr(c?.couponId),
        title: safeStr(c?.title),
        minSpend: toNum(c?.minSpend, 0),
        discount: toNum(c?.discount, 0),
        count: 0,
        lastClaimedAt: toNum(c?.claimedAt, 0),
      };
      groupMap.set(key, g);
      groups.push(g);
      itemsMap.set(key, []);
    }

    g.count += 1;
    g.lastClaimedAt = Math.max(g.lastClaimedAt, toNum(c?.claimedAt, 0));
    itemsMap.get(key).push(c);
  });

  return { groups, itemsMap };
}

function groupCouponInstancesForCheckout(list) {
  const { groups, itemsMap } = _groupCouponInstances(list);
  groups.sort((a, b) => (toNum(b.discount, 0) - toNum(a.discount, 0)) || (toNum(b.lastClaimedAt, 0) - toNum(a.lastClaimedAt, 0)));
  return { groups, itemsMap };
}

function groupUserCoupons(list) {
  const { groups } = _groupCouponInstances(list);
  return groups.sort((a, b) => (toNum(b.lastClaimedAt, 0) - toNum(a.lastClaimedAt, 0)) || (toNum(b.discount, 0) - toNum(a.discount, 0)));
}

module.exports = {
  buildCouponGroupKey,
  groupCouponInstancesForCheckout,
  groupUserCoupons,
};

