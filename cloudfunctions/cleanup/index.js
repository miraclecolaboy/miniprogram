const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * 主函数 - 定期执行清理任务
 */
exports.main = async (event, context) => {
  const now = Date.now();
  console.log(`[${new Date(now).toLocaleString()}] - Cleanup task started.`);

  try {
    // 任务1: 清理已过期的管理员会话 (admin_sessions)
    // 直接删除 expiresAt 早于当前时间的记录
    const sessionRes = await db.collection('admin_sessions').where({
      expiresAt: _.lt(now)
    }).remove();
    console.log(`Expired admin sessions cleaned: ${sessionRes.stats.removed} records.`);

    // 任务2: 直接删除旧订单 (orders)
    // 90天
    const NINETY_DAYS_AGO = now - 90 * 24 * 60 * 60 * 1000;
    
    // 云函数单次删除上限为1000条。如果的旧订单非常多，
    // 定时任务需要多次运行才能全部清理完，这是正常现象。
    const oldOrdersRes = await db.collection('orders').where({
      // 只删除已终结状态的订单
      status: _.in(['done', 'cancelled']),
      // 创建时间早于90天前
      createdAt: _.lt(NINETY_DAYS_AGO)
    }).remove();

    const ordersDeletedCount = oldOrdersRes.stats.removed || 0;
    if (ordersDeletedCount > 0) {
      console.log(`Successfully deleted ${ordersDeletedCount} old orders.`);
    } else {
      console.log('No old orders to delete in this run.');
    }

    // 任务3  直接删除旧的充值流水 (recharges)
    return {
      success: true,
      sessionsCleaned: sessionRes.stats.removed,
      ordersDeleted: ordersDeletedCount,
      message: "Cleanup task completed successfully."
    };

  } catch (err) {
    console.error('Cleanup task failed:', err);
    return { success: false, error: err.message };
  }
};
