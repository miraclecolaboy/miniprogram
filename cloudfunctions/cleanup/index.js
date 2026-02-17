const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;
const KUAIDI_AUTO_DONE_DAYS = 7;
const BATCH_SIZE = 100;
const REFUND_ENDED_BUT_ORDER_CONTINUES = ['rejected', 'reject', 'cancelled', 'canceled'];

async function cleanExpiredSessions(nowTs) {
  const res = await db.collection('admin_sessions').where({
    expiresAt: _.lt(nowTs)
  }).remove().catch((e) => {
    console.error('[cleanup] cleanExpiredSessions failed:', e);
    return { stats: { removed: 0 } };
  });
  return Number(res?.stats?.removed || 0);
}

async function fetchKuaidiAutoDoneCandidates(cutoffTs, limit) {
  const base = {
    mode: 'kuaidi',
    status: 'delivering',
    updatedAt: _.lte(cutoffTs)
  };

  const picked = new Map();
  const push = (rows = []) => {
    rows.forEach((row) => {
      const id = row && row._id;
      if (!id || picked.has(id) || picked.size >= limit) return;
      picked.set(id, row);
    });
  };

  let noRefundRows = [];
  try {
    const noRefundRes = await db.collection('orders').where({
      ...base,
      refund: _.exists(false)
    }).limit(limit).get();
    noRefundRows = Array.isArray(noRefundRes?.data) ? noRefundRes.data : [];
  } catch (_) {
    const noRefundRes = await db.collection('orders').where({
      ...base,
      refund: _.eq(null)
    }).limit(limit).get().catch(() => ({ data: [] }));
    noRefundRows = Array.isArray(noRefundRes?.data) ? noRefundRes.data : [];
  }
  push(noRefundRows);

  if (picked.size < limit) {
    const remain = limit - picked.size;
    const withEndedRefundRes = await db.collection('orders').where(_.and([
      base,
      { refund: _.exists(true) },
      { 'refund.status': _.in(REFUND_ENDED_BUT_ORDER_CONTINUES) }
    ])).limit(remain).get().catch(() => ({ data: [] }));
    push(Array.isArray(withEndedRefundRes?.data) ? withEndedRefundRes.data : []);
  }

  return Array.from(picked.values());
}

async function autoDoneKuaidiOrders() {
  const runAt = Date.now();
  const cutoffTs = runAt - KUAIDI_AUTO_DONE_DAYS * DAY_MS;

  let scanned = 0;
  let updated = 0;
  let failed = 0;

  while (true) {
    const rows = await fetchKuaidiAutoDoneCandidates(cutoffTs, BATCH_SIZE);
    if (!rows.length) break;

    scanned += rows.length;
    const nowTs = Date.now();
    const updates = await Promise.allSettled(rows.map((row) => {
      return db.collection('orders').doc(row._id).update({
        data: {
          status: 'done',
          statusText: '已完成',
          doneAt: nowTs,
          updatedAt: nowTs
        }
      });
    }));

    updates.forEach((ret, index) => {
      if (ret.status === 'fulfilled') {
        updated += 1;
      } else {
        failed += 1;
        console.error('[cleanup] autoDone update failed:', rows[index]?._id, ret.reason);
      }
    });

    if (rows.length < BATCH_SIZE) break;
  }

  return {
    ok: true,
    task: 'autoDoneKuaidiOrders',
    runAt,
    cutoffTs,
    scanned,
    updated,
    failed
  };
}

async function pickPurgeIds(collectionName, cutoffTs, limit) {
  const res = await db.collection(collectionName).where(_.or([
    { createdAt: _.lt(cutoffTs) },
    { status: 'cancelled' }
  ])).field({
    _id: true
  }).limit(limit).get().catch(() => ({ data: [] }));

  const rows = Array.isArray(res?.data) ? res.data : [];
  return rows.map((x) => x && x._id).filter(Boolean);
}

async function purgeCollection(collectionName, cutoffTs) {
  let rounds = 0;
  let removed = 0;

  while (true) {
    const ids = await pickPurgeIds(collectionName, cutoffTs, BATCH_SIZE);
    if (!ids.length) break;

    const ret = await db.collection(collectionName).where({
      _id: _.in(ids)
    }).remove().catch((e) => {
      console.error(`[cleanup] purge ${collectionName} remove failed:`, e);
      return { stats: { removed: 0 } };
    });

    const n = Number(ret?.stats?.removed || 0);
    removed += n;
    rounds += 1;

    if (ids.length < BATCH_SIZE || n <= 0) break;
  }

  return { removed, rounds };
}

async function cleanupOldData() {
  const runAt = Date.now();
  const cutoffTs = runAt - YEAR_MS;

  const sessionsCleaned = await cleanExpiredSessions(runAt);
  const orders = await purgeCollection('orders', cutoffTs);
  const recharges = await purgeCollection('recharges', cutoffTs);

  return {
    ok: true,
    task: 'cleanupOldData',
    runAt,
    cutoffTs,
    sessionsCleaned,
    ordersDeleted: orders.removed,
    rechargesDeleted: recharges.removed,
    orderRounds: orders.rounds,
    rechargeRounds: recharges.rounds
  };
}

exports.main = async (event = {}) => {
  const action = String(event?.action || '').trim();
  const triggerName = String(event?.TriggerName || event?.triggerName || '').trim();
  const triggerType = String(event?.Type || event?.type || '').trim().toLowerCase();
  const isTimer = triggerType === 'timer';

  try {
    if (action === 'autoDoneKuaidiOrders') {
      return await autoDoneKuaidiOrders();
    }
    if (action === 'cleanupOldData') {
      return await cleanupOldData();
    }

    if (isTimer && triggerName === 'autoDoneTwiceDaily') {
      return await autoDoneKuaidiOrders();
    }
    if (isTimer && triggerName === 'dataCleanupDaily') {
      return await cleanupOldData();
    }

    if (isTimer) {
      console.warn('[cleanup] unknown timer trigger, fallback to cleanupOldData:', triggerName);
      return await cleanupOldData();
    }

    const autoDoneRet = await autoDoneKuaidiOrders();
    const cleanupRet = await cleanupOldData();
    return {
      ok: true,
      task: 'manualRunAll',
      autoDone: autoDoneRet,
      cleanup: cleanupRet
    };
  } catch (err) {
    console.error('[cleanup] task failed:', err);
    return { ok: false, error: err?.message || 'task_failed' };
  }
};
