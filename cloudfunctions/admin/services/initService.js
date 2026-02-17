const cloud = require('wx-server-sdk');
const {
  COL_USERS,
  COL_SESS,
  COL_PRODUCTS,
  COL_CATEGORIES,
  COL_ORDERS,
  COL_CUSTOMERS,
  COL_SHOP_CONFIG,
  COL_RECHARGES,
} = require('../config/constants');
const { isCollectionNotExists, now } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const REQUIRED_COLLECTIONS = [
  COL_USERS,
  COL_SESS,
  COL_PRODUCTS,
  COL_CATEGORIES,
  COL_ORDERS,
  COL_CUSTOMERS,
  COL_SHOP_CONFIG,
  COL_RECHARGES,
];

let _bootstrapped = false;
let _bootstrapPromise = null;

function isSafeToIgnoreCreateCollectionError(err) {
  const msg = String(err?.errMsg || err?.message || '').toLowerCase();
  return msg.includes('exist') || msg.includes('exists') || msg.includes('already');
}

async function ensureCollectionExists(name) {
  if (!name) return;

  try {
    await db.collection(name).limit(1).get();
    return;
  } catch (e) {
    if (!isCollectionNotExists(e)) throw e;
  }

  if (typeof db.createCollection === 'function') {
    try {
      await db.createCollection(name);
      return;
    } catch (e) {
      if (isSafeToIgnoreCreateCollectionError(e)) return;
      try {
        await db.collection(name).limit(1).get();
        return;
      } catch (_) {}
      throw e;
    }
  }

  const tmp = await db.collection(name).add({ data: { _init: true, createdAt: now() } });
  if (tmp && tmp._id) await db.collection(name).doc(tmp._id).remove().catch(() => {});
}

async function ensureCollections() {
  if (_bootstrapped) return;
  if (_bootstrapPromise) return _bootstrapPromise;

  _bootstrapPromise = (async () => {
    for (const name of REQUIRED_COLLECTIONS) {
      await ensureCollectionExists(name);
    }
    _bootstrapped = true;
  })();

  try {
    await _bootstrapPromise;
  } catch (e) {
    _bootstrapPromise = null;
    throw e;
  }
}

module.exports = {
  ensureCollectionExists,
  ensureCollections,
};
