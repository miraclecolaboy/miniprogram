// cloudfunctions/admin/services/productService.js
const cloud = require('wx-server-sdk');
const { COL_PRODUCTS, COL_CATEGORIES } = require('../config/constants');
const { now, isCollectionNotExists, safeStr, toNum, toInt, normalizeModes, sanitizeSpecs } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

// 内部辅助：安全删除云文件
async function deleteFileSafe(fileIDs) {
  const ids = (Array.isArray(fileIDs) ? fileIDs : [fileIDs]).filter(id => typeof id === 'string' && id.startsWith('cloud://'));
  if (!ids.length) return;
  try {
    // 增加日志，便于追踪
    console.log('[deleteFileSafe] Deleting files:', ids);
    await cloud.deleteFile({ fileList: ids });
  } catch (e) {
    console.error('[deleteFileSafe] error', e);
  }
}

// [修改] 内部辅助：将传入的商品数据清洗并标准化
function normalizeProductInput(data) {
  const input = data || {};
  const name = safeStr(input.name);
  if (!name) throw new Error('商品名不能为空');

  const categoryId = safeStr(input.categoryId);
  if (!categoryId) throw new Error('分类不能为空');
  
  const hasSpecs = !!input.hasSpecs;
  let price = 0;
  let skuList = [];

  if (hasSpecs) {
    skuList = Array.isArray(input.skuList) ? input.skuList : [];
    if (skuList.length === 0) throw new Error('规格商品必须至少有一个SKU');
    
    skuList = skuList.map((sku) => ({
      skuKey: safeStr(sku.skuKey),
      specText: safeStr(sku.specText),
      price: toNum(sku.price, NaN),
    }));

    skuList.forEach(sku => {
      if (!sku.skuKey) throw new Error('SKU 缺少 skuKey');
      if (toNum(sku.price, -1) < 0) throw new Error(`SKU "${sku.specText}" 的价格不合法`);
    });

    const minPrice = Math.min(...skuList.map(sku => toNum(sku.price, Infinity)));
    price = isFinite(minPrice) ? minPrice : 0;
  } else {
    price = toNum(input.price, NaN);
    if (!Number.isFinite(price) || price < 0) throw new Error('价格不合法');
  }

  return {
    name,
    categoryId,
    status: input.status === 1 ? 1 : 0,
    sort: toInt(input.sort, 0),
    modes: normalizeModes(input.modes),
    imgs: (Array.isArray(input.imgs) ? input.imgs : []).filter(Boolean).slice(0, 3),
    thumbFileID: safeStr(input.thumbFileID), // [新增]
    desc: safeStr(input.desc),
    detail: safeStr(input.detail),
    hasSpecs,
    price: Number(price.toFixed(2)),
    specs: hasSpecs ? sanitizeSpecs(input.specs) : [],
    skuList: hasSpecs ? skuList : _.remove()
  };
}

// --- 分类管理 (无变化) ---
async function listCategories() {
  try {
    const r = await db.collection(COL_CATEGORIES).orderBy('sort', 'asc').limit(200).get();
    return { ok: true, list: r.data || [] };
  } catch (e) {
    if (isCollectionNotExists(e)) return { ok: true, list: [] };
    throw e;
  }
}

async function addCategory(name, sort, username) {
  const doc = { 
    name: safeStr(name), 
    sort: toInt(sort, 0), 
    status: 1, 
    createdAt: now(), 
    updatedAt: now(),
    createdBy: username,
    updatedBy: username
  };
  const addRes = await db.collection(COL_CATEGORIES).add({ data: doc });
  return { ok: true, id: addRes._id };
}

async function removeCategory(id, role) {
  if (role !== 'admin') return { ok: false, message: '无权限：仅管理员可删除' };
  const countRes = await db.collection(COL_PRODUCTS).where({ categoryId: id }).count();
  if (countRes.total > 0) return { ok: false, message: '该分组下仍有商品，无法删除' };
  await db.collection(COL_CATEGORIES).doc(id).remove();
  return { ok: true };
}

// --- 商品管理 ---

// [修改] listProducts, 增加缩略图返回
async function listProducts(event) {
  const { keyword = '', categoryId = '', pageNum = 1, pageSize = 20 } = event;
  const skip = (pageNum - 1) * pageSize;

  const matchStage = {};
  if (keyword) matchStage.name = db.RegExp({ regexp: keyword, options: 'i' });
  if (categoryId) matchStage.categoryId = categoryId;
  
  try {
    const res = await db.collection(COL_PRODUCTS).aggregate()
      .match(matchStage)
      .sort({ sort: 1, updatedAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lookup({
        from: COL_CATEGORIES,
        localField: 'categoryId',
        foreignField: '_id',
        as: 'category'
      })
      .project({
        _id: 1, name: 1, price: 1, status: 1, modes: 1, hasSpecs: 1,
        thumbFileID: 1, // [新增]
        categoryName: $.arrayElemAt([$.ifNull(['$category.name', '']), 0])
      })
      .end();

    let list = res.list || [];
    const allFileIDs = new Set();
    // [修改] 同时收集缩略图ID
    list.forEach(item => {
      if (item.thumbFileID && item.thumbFileID.startsWith('cloud://')) {
        allFileIDs.add(item.thumbFileID);
      }
    });

    let tempUrlMap = {};
    if (allFileIDs.size > 0) {
      const urlRes = await cloud.getTempFileURL({ fileList: Array.from(allFileIDs) });
      urlRes.fileList.forEach(item => {
        if (item.tempFileURL) tempUrlMap[item.fileID] = item.tempFileURL;
      });
    }

    list = list.map(item => {
      // [修改] 生成 thumbUrl
      const thumbUrl = tempUrlMap[item.thumbFileID] || '';
      return { ...item, thumbUrl };
    });

    return { ok: true, list };
  } catch (e) {
    if (isCollectionNotExists(e)) return { ok: true, list: [] };
    console.error('[productService.listProducts] aggregate error', e);
    throw e;
  }
}

// [修改] getProductForEdit, 返回 FileID
async function getProductForEdit(id) {
  if (!id) return { ok: false, message: '缺少商品ID' };
  const doc = await db.collection(COL_PRODUCTS).doc(id).get().then(res => res.data).catch(() => null);
  if (!doc) return { ok: false, message: '商品不存在' };

  // [修改] 同时返回原始 fileID 和预览 URL
  const imgFileIDs = (doc.imgs || []).filter(img => typeof img === 'string' && img.startsWith('cloud://'));
  doc.imgFileIDs = imgFileIDs; // [新增]

  if (imgFileIDs.length > 0) {
    try {
      const urlRes = await cloud.getTempFileURL({ fileList: imgFileIDs });
      const tempUrlMap = {};
      urlRes.fileList.forEach(item => {
        if (item.tempFileURL) tempUrlMap[item.fileID] = item.tempFileURL;
      });
      doc.imgs = (doc.imgs || []).map(img => tempUrlMap[img] || img);
    } catch(e) { console.error("getTempFileURL failed", e); }
  }

  return { ok: true, data: doc };
}

// [修改] addProduct, 增加 thumbFileID
async function addProduct(data, tempId, username) {
  const input = normalizeProductInput(data);
  const doc = {
    ...input,
    skuList: [], 
    createdAt: now(),
    updatedAt: now(),
    createdBy: username,
    updatedBy: username
  };
  
  const addRes = await db.collection(COL_PRODUCTS).add({ data: doc });
  const realId = addRes._id;
  if (!realId) throw new Error('Failed to create product document.');

  let finalSkuList = input.skuList;
  if (Array.isArray(finalSkuList) && finalSkuList.length > 0) {
    finalSkuList = finalSkuList.map(sku => ({
      ...sku,
      skuKey: sku.skuKey.replace(tempId, realId)
    }));
  }
  
  await db.collection(COL_PRODUCTS).doc(realId).update({
    data: {
      skuList: finalSkuList,
      updatedAt: now()
    }
  });

  return { ok: true, id: realId };
}

// [修改] updateProduct, 增加 thumbFileID
async function updateProduct(id, data, deletedFileIDs, username) {
  if (!id || typeof id !== 'string') return { ok: false, message: '缺少商品ID' };
  
  if (id.startsWith('temp_')) {
    return await addProduct(data, id, username);
  }

  const input = normalizeProductInput(data);
  await db.collection(COL_PRODUCTS).doc(id).update({
    data: {
      ...input,
      // Inventory is no longer used; remove legacy fields to avoid confusion.
      stock: _.remove(),
      updatedAt: now(),
      updatedBy: username,
    }
  });

  if (Array.isArray(deletedFileIDs) && deletedFileIDs.length > 0) {
    await deleteFileSafe(deletedFileIDs);
  }

  return { ok: true };
}

// [修改] removeProduct, 增加删除缩略图
async function removeProduct(id, role) {
  if (role !== 'admin') return { ok: false, message: '无权限' };
  if (!id) return { ok: false, message: '缺少商品ID' };
  const old = await db.collection(COL_PRODUCTS).doc(id).get().then(res => res.data).catch(() => null);
  const oldImgs = old?.imgs || [];
  const oldThumb = old?.thumbFileID || ''; // [新增]
  await db.collection(COL_PRODUCTS).doc(id).remove();
  
  const filesToDelete = [...oldImgs];
  if (oldThumb) filesToDelete.push(oldThumb); // [新增]
  if (filesToDelete.length > 0) {
    deleteFileSafe(filesToDelete);
  }
  return { ok: true };
}

// toggleProductStatus, updateSkus 无变化
async function toggleProductStatus(id, onShelf, username) {
  if (!id) return { ok: false, message: '缺少商品ID' };
  await db.collection(COL_PRODUCTS).doc(id).update({
    data: {
      status: onShelf ? 1 : 0,
      updatedAt: now(),
      updatedBy: username
    }
  });
  return { ok: true };
}

async function updateSkus(productId, skus, username) {
  if (!productId) return { ok: false, message: '缺少商品ID' };
  const skuList = Array.isArray(skus) ? skus : [];
  if (skuList.length === 0) return { ok: false, message: 'SKU列表不能为空' };
  const normalized = skuList.map((sku) => ({
    skuKey: safeStr(sku.skuKey),
    specText: safeStr(sku.specText),
    price: toNum(sku.price, NaN),
  }));
  normalized.forEach((sku) => {
    if (!sku.skuKey) throw new Error('SKU 缺少 skuKey');
    if (!Number.isFinite(sku.price) || sku.price < 0) throw new Error(`SKU "${sku.specText}" 的价格不合法`);
  });

  const minPrice = Math.min(...normalized.map(sku => toNum(sku.price, Infinity)));
  const price = isFinite(minPrice) ? minPrice : 0;
  await db.collection(COL_PRODUCTS).doc(productId).update({
    data: {
      skuList: normalized,
      stock: _.remove(),
      price: Number(price.toFixed(2)),
      updatedAt: now(),
      updatedBy: username
    }
  });
  return { ok: true };
}

module.exports = {
  listCategories, addCategory, removeCategory,
  listProducts, getProductForEdit, addProduct, updateProduct, removeProduct,
  toggleProductStatus, updateSkus
};
