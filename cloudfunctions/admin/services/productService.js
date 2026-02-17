const cloud = require('wx-server-sdk');
const { COL_PRODUCTS, COL_CATEGORIES } = require('../config/constants');
const { now, isCollectionNotExists, safeStr, toNum, toInt, normalizeModes, sanitizeSpecs } = require('../utils/common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

async function deleteFileSafe(fileIDs) {
  const ids = (Array.isArray(fileIDs) ? fileIDs : [fileIDs]).filter(id => typeof id === 'string' && id.startsWith('cloud://'));
  if (!ids.length) return;
  try {
    console.log('[deleteFileSafe] Deleting files:', ids);
    await cloud.deleteFile({ fileList: ids });
  } catch (e) {
    console.error('[deleteFileSafe] error', e);
  }
}

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
    thumbFileID: safeStr(input.thumbFileID),
    desc: safeStr(input.desc),
    detail: safeStr(input.detail),
    hasSpecs,
    price: Number(price.toFixed(2)),
    specs: hasSpecs ? sanitizeSpecs(input.specs) : [],
    skuList: hasSpecs ? skuList : _.remove()
  };
}

async function listCategories() {
  try {
    const r = await db.collection(COL_CATEGORIES).orderBy('sort', 'asc').limit(200).get();
    return { ok: true, list: r.data || [] };
  } catch (e) {
    if (isCollectionNotExists(e)) return { ok: true, list: [] };
    throw e;
  }
}

async function addCategory(name, sort) {
  const doc = { 
    name: safeStr(name), 
    sort: toInt(sort, 0), 
    status: 1, 
    createdAt: now(), 
    updatedAt: now(),
  };
  const addRes = await db.collection(COL_CATEGORIES).add({ data: doc });
  return { ok: true, id: addRes._id };
}

async function removeCategory(id) {
  const countRes = await db.collection(COL_PRODUCTS).where({ categoryId: id }).count();
  if (countRes.total > 0) return { ok: false, message: '该分组下仍有商品，无法删除' };
  await db.collection(COL_CATEGORIES).doc(id).remove();
  return { ok: true };
}

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
        thumbFileID: 1,
        categoryName: $.arrayElemAt([$.ifNull(['$category.name', '']), 0])
      })
      .end();

    let list = res.list || [];
    const allFileIDs = new Set();
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

async function getProductForEdit(id) {
  if (!id) return { ok: false, message: '缺少商品ID' };
  const doc = await db.collection(COL_PRODUCTS).doc(id).get().then(res => res.data).catch(() => null);
  if (!doc) return { ok: false, message: '商品不存在' };

  const imgFileIDs = (doc.imgs || []).filter(img => typeof img === 'string' && img.startsWith('cloud://'));
  doc.imgFileIDs = imgFileIDs;

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

async function addProduct(data, tempId) {
  const input = normalizeProductInput(data);
  const doc = {
    ...input,
    skuList: [], 
    createdAt: now(),
    updatedAt: now()
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

async function updateProduct(id, data, deletedFileIDs) {
  if (!id || typeof id !== 'string') return { ok: false, message: '缺少商品ID' };
  
  if (id.startsWith('temp_')) {
    return await addProduct(data, id);
  }

  const input = normalizeProductInput(data);
  await db.collection(COL_PRODUCTS).doc(id).update({
    data: {
      ...input,
      stock: _.remove(),
      updatedAt: now()
    }
  });

  if (Array.isArray(deletedFileIDs) && deletedFileIDs.length > 0) {
    await deleteFileSafe(deletedFileIDs);
  }

  return { ok: true };
}

async function removeProduct(id) {
  if (!id) return { ok: false, message: '缺少商品ID' };
  const old = await db.collection(COL_PRODUCTS).doc(id).get().then(res => res.data).catch(() => null);
  const oldImgs = old?.imgs || [];
  const oldThumb = old?.thumbFileID || '';
  await db.collection(COL_PRODUCTS).doc(id).remove();
  
  const filesToDelete = [...oldImgs];
  if (oldThumb) filesToDelete.push(oldThumb);
  if (filesToDelete.length > 0) {
    deleteFileSafe(filesToDelete);
  }
  return { ok: true };
}

async function toggleProductStatus(id, onShelf) {
  if (!id) return { ok: false, message: '缺少商品ID' };
  await db.collection(COL_PRODUCTS).doc(id).update({
    data: {
      status: onShelf ? 1 : 0,
      updatedAt: now()
    }
  });
  return { ok: true };
}

async function updateSkus(productId, skus) {
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
      updatedAt: now()
    }
  });
  return { ok: true };
}

module.exports = {
  listCategories, addCategory, removeCategory,
  listProducts, getProductForEdit, addProduct, updateProduct, removeProduct,
  toggleProductStatus, updateSkus
};
