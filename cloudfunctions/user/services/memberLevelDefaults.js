// cloudfunctions/user/services/memberLevelDefaults.js
// Default level membership rules + coupons. This keeps the mini program usable
// without any merchant-side configuration. When needed, data can be edited
// manually in the DB.

const { COL_SHOP_CONFIG } = require('../config/constants');

// Deterministic IDs so other code can reference them safely.
const DEFAULT_MEMBER_COUPON_TEMPLATES = [
  { id: 'coupon_member_5', title: '会员无门槛5元券', minSpend: 0, discount: 5 },
  { id: 'coupon_member_10', title: '会员无门槛10元券', minSpend: 0, discount: 10 },
  { id: 'coupon_member_20', title: '会员无门槛20元券', minSpend: 0, discount: 20 },
];

// 每个等级礼包仅发放一次（跨级时补发缺失等级礼包）
// Lv1: 2张5元
// Lv2: 3张5元 + 1张10元
// Lv3: 5张5元 + 1张20元
// Lv4: 5张10元 + 2张20元
const DEFAULT_MEMBER_LEVELS = [
  { level: 1, threshold: 100, coupons: [{ couponId: 'coupon_member_5', count: 2 }] },
  { level: 2, threshold: 300, coupons: [{ couponId: 'coupon_member_5', count: 3 }, { couponId: 'coupon_member_10', count: 1 }] },
  { level: 3, threshold: 500, coupons: [{ couponId: 'coupon_member_5', count: 5 }, { couponId: 'coupon_member_20', count: 1 }] },
  { level: 4, threshold: 1000, coupons: [{ couponId: 'coupon_member_10', count: 5 }, { couponId: 'coupon_member_20', count: 2 }] },
];

function _isSeededV1MemberLevels(levels) {
  const arr = Array.isArray(levels) ? levels : [];
  if (arr.length !== 4) return false;

  const expect = [
    { level: 1, threshold: 100, couponId: 'coupon_member_lv1', count: 1 },
    { level: 2, threshold: 300, couponId: 'coupon_member_lv2', count: 1 },
    { level: 3, threshold: 500, couponId: 'coupon_member_lv3', count: 1 },
    { level: 4, threshold: 1000, couponId: 'coupon_member_lv4', count: 1 },
  ];

  for (const e of expect) {
    const it = arr.find(x => Number(x?.level) === e.level);
    if (!it) return false;
    if (Number(it.threshold) !== e.threshold) return false;
    const cs = Array.isArray(it.coupons) ? it.coupons : [];
    if (cs.length !== 1) return false;
    const c0 = cs[0] || {};
    if (String(c0.couponId || '') !== e.couponId) return false;
    if (Number(c0.count) !== e.count) return false;
  }

  return true;
}

function _clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function getDefaultMemberLevels() {
  return _clone(DEFAULT_MEMBER_LEVELS);
}

function getDefaultMemberCoupons() {
  return _clone(DEFAULT_MEMBER_COUPON_TEMPLATES);
}

async function ensureMemberLevelDefaults(db, nowTs) {
  const tNow = Number(nowTs || Date.now());
  if (!db) throw new Error('missing_db');

  // 1) Ensure member gift coupon templates exist (hidden / not claimable in coupon center).
  for (const tpl of DEFAULT_MEMBER_COUPON_TEMPLATES) {
    const id = String(tpl.id || '').trim();
    if (!id) continue;

    const ref = db.collection(COL_SHOP_CONFIG).doc(id);
    const got = await ref.get().catch(() => null);
    if (got && got.data) {
      // Backward compatible rename (only patch when it still matches the legacy seeded title).
      const cur = got.data || {};
      const curTitle = String(cur.title || '').trim();
      const legacyTitle = `等级会员无门槛${Number(tpl.discount || 0)}元券`;
      const nextTitle = String(tpl.title || '').trim();
      if (
        cur &&
        cur.type === 'coupon_template' &&
        cur.claimable === false &&
        curTitle === legacyTitle &&
        nextTitle &&
        curTitle !== nextTitle
      ) {
        await ref.update({ data: { title: nextTitle, updatedAt: tNow } }).catch(() => {});
      }
      continue; // Keep manual edits.
    }

    await ref.set({
      data: {
        type: 'coupon_template',
        status: 'active',
        claimable: false, // Not shown/claimable in coupon center; only granted by upgrade.
        title: String(tpl.title || '').trim(),
        minSpend: Number(tpl.minSpend || 0),
        discount: Number(tpl.discount || 0),
        totalQuantity: 999999,
        claimedQuantity: 0,
        createdAt: tNow,
        updatedAt: tNow,
      }
    }).catch(() => {});
  }

  // 2) Ensure shop_config/main has memberLevels.
  const mainRef = db.collection(COL_SHOP_CONFIG).doc('main');
  const mainGot = await mainRef.get().catch(() => null);
  const main = mainGot && mainGot.data ? mainGot.data : null;
  const hasLevels = !!(main && Array.isArray(main.memberLevels) && main.memberLevels.length > 0);

  // If main already has our old (v1) default, upgrade it to the new default.
  const shouldPatchLevels = !hasLevels || _isSeededV1MemberLevels(main && main.memberLevels);
  if (shouldPatchLevels) {
    const patch = { memberLevels: getDefaultMemberLevels(), updatedAt: tNow };
    if (main) {
      await mainRef.update({ data: patch }).catch(() => {});
    } else {
      await mainRef.set({ data: { ...patch, createdAt: tNow } }).catch(() => {});
    }
  }

  return { ok: true };
}

module.exports = {
  DEFAULT_MEMBER_LEVELS,
  DEFAULT_MEMBER_COUPON_TEMPLATES,
  getDefaultMemberLevels,
  getDefaultMemberCoupons,
  ensureMemberLevelDefaults,
};
