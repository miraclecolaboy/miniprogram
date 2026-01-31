// [新文件] cloudfunctions/user/services/couponService.js
const cloud = require('wx-server-sdk');
const { COL_USERS, COL_SHOP_CONFIG } = require('../config/constants');
const { now, toNum } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * 用户领取优惠券
 */
async function claimCoupon(couponId, openid) {
  if (!couponId) throw new Error('缺少优惠券ID');

  const tNow = now();

  try {
    return await db.runTransaction(async tx => {
      // 1. 检查优惠券模板
      const couponRef = tx.collection(COL_SHOP_CONFIG).doc(couponId);
      const couponDoc = await couponRef.get();
      const coupon = couponDoc.data;

      if (!coupon || coupon.type !== 'coupon_template' || coupon.status !== 'active') {
        throw new Error('优惠券不存在或已下架');
      }
      if (coupon.claimable === false) {
        throw new Error('该优惠券不可领取');
      }
      if (toNum(coupon.claimedQuantity, 0) >= toNum(coupon.totalQuantity, 0)) {
        throw new Error('优惠券已被领完');
      }

      // 2. 检查用户是否已领取
      const userRef = tx.collection(COL_USERS).doc(openid);
      const userDoc = await userRef.get();
      const user = userDoc.data;
      if (!user) throw new Error('用户不存在');

      const userCoupons = Array.isArray(user.coupons) ? user.coupons : [];
      const hasClaimed = userCoupons.some(c => c.couponId === couponId);
      if (hasClaimed) {
        throw new Error('您已领取过该优惠券');
      }

      // 3. 更新优惠券模板的领取数量
      await couponRef.update({
        data: {
          claimedQuantity: _.inc(1),
          updatedAt: tNow,
        }
      });

      // 4. 在用户文档中添加优惠券
      const userCouponId = `${couponId}_${tNow}`;
      const newUserCoupon = {
        userCouponId,
        couponId: coupon._id,
        title: coupon.title,
        minSpend: coupon.minSpend,
        discount: coupon.discount,
        claimedAt: tNow,
      };
      
      const couponsPatch = Array.isArray(user.coupons)
        ? { coupons: _.push([newUserCoupon]) }
        : { coupons: [newUserCoupon] };

      await userRef.update({
        data: {
          ...couponsPatch,
          updatedAt: tNow,
        }
      });

      return { ok: true, data: newUserCoupon };
    });
  } catch (e) {
    // 将事务中的错误 message 传递出去
    return { error: e.message || '领取失败' };
  }
}

module.exports = {
  claimCoupon,
};
