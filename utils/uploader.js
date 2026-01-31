/**
 * 上传并替换文件，自动清理旧文件
 * @param {string} filePath - 本地文件路径
 * @param {string} oldFileID - (可选) 旧文件的 File ID，用于删除
 * @param {string} folder - 云存储目录名 (默认: 'common')
 * @returns {Promise<string>} - 新的 File ID
 */
const uploadAndReplace = async (filePath, oldFileID, folder = 'common') => {
  const suffix = (filePath.match(/\.[^.]+?$/) || ['.jpg'])[0];
  const cloudPath = `${folder}/${Date.now()}-${Math.random().toString(36).slice(-6)}${suffix}`;

  const { fileID: newFileID } = await wx.cloud.uploadFile({
    cloudPath,
    filePath,
  });

  if (oldFileID && oldFileID.startsWith('cloud://')) {
    // 异步删除旧文件，不阻塞后续流程
    wx.cloud.deleteFile({ fileList: [oldFileID] }).catch(err => console.error('Failed to delete old file:', err));
  }

  return newFileID;
};

/**
 * 智能温和压缩图片
 * 根据体积超出比例，动态选择压缩强度，避免“一刀切”导致画质损失。
 * * @param {string} srcPath - 本地图片路径
 * @param {number} maxKB - 目标最大体积 (KB)
 * @returns {Promise<string>} - 压缩后的图片路径（如果无法压缩则返回原路径）
 */
const compressImage = async (srcPath, maxKB = 500) => {
  try {
    const info = await wx.getImageInfo({ src: srcPath });
    const sizeKB = info.size / 1024;
    
    // 1. 如果已经在目标大小之内，直接返回，不进行任何处理
    if (sizeKB <= maxKB) return srcPath;

    // 2. 计算超出倍数 (ratio)
    const ratio = sizeKB / maxKB;
    let qualities = [];

    // 3. 制定“阶梯式”压缩策略
    if (ratio < 1.5) {
      // [轻微超标] (< 1.5倍): 只有一点点大，非常温和地压缩
      // 90质量通常肉眼无损，但能减小体积
      qualities = [90, 80]; 
    } else if (ratio < 3.0) {
      // [中度超标] (1.5 - 3倍): 标准压缩
      qualities = [70, 60, 50];
    } else {
      // [严重超标] (> 3倍): 需要大幅缩减，直接上强度
      qualities = [50, 40, 30];
    }

    let bestPath = srcPath;

    // 4. 按策略尝试压缩
    for (const q of qualities) {
      const r = await wx.compressImage({ src: srcPath, quality: q });
      bestPath = r.tempFilePath;
      
      const newInfo = await wx.getImageInfo({ src: bestPath });
      
      // 如果达标，立即停止，不再尝试更低质量
      if ((newInfo.size / 1024) <= maxKB) {
        break; 
      }
    }
    
    // 返回最后一次尝试的结果（即使未完全达标，也是当前能做到的最接近结果）
    return bestPath;

  } catch (e) {
    console.error('compressImage error:', e);
    // 发生错误（如文件格式不支持），降级返回原图
    return srcPath;
  }
};

/**
 * 生成 300x300 居中裁剪缩略图 (用于积分商品、列表图)
 * 【前置要求】WXML 中必须包含: <canvas canvas-id="image-cropper" ... />
 */
const generateThumbnail = async (filePath) => {
  if (!filePath) return '';
  return new Promise(async (resolve, reject) => {
    try {
      const ctx = wx.createCanvasContext('image-cropper');
      if (!ctx) {
        return reject(new Error('Canvas context "image-cropper" not found.'));
      }

      const info = await wx.getImageInfo({ src: filePath });
      const { width, height } = info;
      
      const size = Math.min(width, height);
      const x = (width - size) / 2;
      const y = (height - size) / 2;

      ctx.drawImage(filePath, x, y, size, size, 0, 0, 300, 300);
      
      ctx.draw(false, () => {
        setTimeout(async () => {
          try {
            const res = await wx.canvasToTempFilePath({
              canvasId: 'image-cropper',
              width: 300,
              height: 300,
              destWidth: 300,
              destHeight: 300,
              fileType: 'jpg',
              quality: 0.85
            });
            resolve(res.tempFilePath);
          } catch (err) {
            reject(err);
          }
        }, 100);
      });
    } catch (e) {
      reject(e);
    }
  });
};

module.exports = {
  uploadAndReplace,
  compressImage,
  generateThumbnail
};