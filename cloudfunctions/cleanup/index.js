const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const now = Date.now();
  console.log(`[${new Date(now).toLocaleString()}] - Cleanup task started.`);

  try {
    const sessionRes = await db.collection('admin_sessions').where({
      expiresAt: _.lt(now)
    }).remove();
    console.log(`Expired admin sessions cleaned: ${sessionRes.stats.removed} records.`);

    const NINETY_DAYS_AGO = now - 90 * 24 * 60 * 60 * 1000;
    
    const oldOrdersRes = await db.collection('orders').where({
      status: _.in(['done', 'cancelled']),
      createdAt: _.lt(NINETY_DAYS_AGO)
    }).remove();

    const ordersDeletedCount = oldOrdersRes.stats.removed || 0;
    if (ordersDeletedCount > 0) {
      console.log(`Successfully deleted ${ordersDeletedCount} old orders.`);
    } else {
      console.log('No old orders to delete in this run.');
    }

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
