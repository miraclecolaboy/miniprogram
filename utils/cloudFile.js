// utils/cloudFile.js
// cloud:// fileID 与临时 URL 处理（前端）。

const { safeStr, isCloudFileId } = require('./common');

async function getTempUrlMap(fileIds) {
  try {
    const ids = (fileIds || []).map(safeStr).filter(Boolean);
    if (!ids.length) return {};
    if (!wx.cloud || !wx.cloud.getTempFileURL) return {};

    const r = await wx.cloud.getTempFileURL({ fileList: ids }).catch(() => null);
    const list = r && r.fileList ? r.fileList : [];
    const map = Object.create(null);
    list.forEach((x) => {
      const fileID = safeStr(x && x.fileID);
      if (!fileID) return;
      map[fileID] = safeStr(x.tempFileURL);
    });
    return map;
  } catch (_) {
    return {};
  }
}

async function getTempFileUrl(fileId) {
  const id = safeStr(fileId);
  if (!id) return '';
  const map = await getTempUrlMap([id]);
  return safeStr(map[id]);
}

async function resolveCloudFileList(list) {
  const arr = Array.isArray(list) ? list : [];
  const ids = arr.filter(isCloudFileId);
  if (!ids.length) return arr;
  const map = await getTempUrlMap(ids);
  return arr.map((s) => map[s] || s);
}

module.exports = {
  getTempFileUrl,
  getTempUrlMap,
  resolveCloudFileList,
};

