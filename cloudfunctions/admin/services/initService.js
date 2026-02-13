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
  // Different cloud DB versions may use different errCodes/messages when the
  // collection already exists or gets created concurrently.
  const msg = String(err?.errMsg || err?.message || '').toLowerCase();
  return msg.includes('exist') || msg.includes('exists') || msg.includes('already');
}

async function ensureCollectionExists(name) {
  if (!name) return;

  // Fast path: read anything. Missing collection throws -502005.
  try {
    await db.collection(name).limit(1).get();
    return;
  } catch (e) {
    if (!isCollectionNotExists(e)) throw e;
  }

  // Create collection if supported.
  if (typeof db.createCollection === 'function') {
    try {
      await db.createCollection(name);
      return;
    } catch (e) {
      // If it's a race or "already exists", re-check and continue.
      if (isSafeToIgnoreCreateCollectionError(e)) return;
      try {
        await db.collection(name).limit(1).get();
        return;
      } catch (_) {}
      throw e;
    }
  }

  // Fallback (older SDKs): try to create by adding/removing a temp doc.
  // This is best-effort and may still fail if the platform requires explicit creation.
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
    // Allow retry on next invocation.
    _bootstrapPromise = null;
    throw e;
  }
}

module.exports = {
  ensureCollectionExists,
  ensureCollections,
};
