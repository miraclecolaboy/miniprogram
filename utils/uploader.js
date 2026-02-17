const uploadAndReplace = async (filePath, oldFileID, folder = 'common') => {
  const suffix = (filePath.match(/\.[^.]+?$/) || ['.jpg'])[0];
  const cloudPath = `${folder}/${Date.now()}-${Math.random().toString(36).slice(-6)}${suffix}`;

  const { fileID: newFileID } = await wx.cloud.uploadFile({
    cloudPath,
    filePath,
  });

  if (oldFileID && oldFileID.startsWith('cloud://')) {
    wx.cloud.deleteFile({ fileList: [oldFileID] }).catch(err => console.error('Failed to delete old file:', err));
  }

  return newFileID;
};

const compressImage = async (srcPath, maxKB = 500) => {
  try {
    const info = await wx.getImageInfo({ src: srcPath });
    const sizeKB = info.size / 1024;
    
    if (sizeKB <= maxKB) return srcPath;

    const ratio = sizeKB / maxKB;
    let qualities = [];

    if (ratio < 1.5) {
      qualities = [90, 80]; 
    } else if (ratio < 3.0) {
      qualities = [70, 60, 50];
    } else {
      qualities = [50, 40, 30];
    }

    let bestPath = srcPath;

    for (const q of qualities) {
      const r = await wx.compressImage({ src: srcPath, quality: q });
      bestPath = r.tempFilePath;
      
      const newInfo = await wx.getImageInfo({ src: bestPath });
      
      if ((newInfo.size / 1024) <= maxKB) {
        break; 
      }
    }
    
    return bestPath;

  } catch (e) {
    console.error('compressImage error:', e);
    return srcPath;
  }
};

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

const generateThumbnail43 = async (filePath) => {
  if (!filePath) return '';
  const TARGET_W = 300;
  const TARGET_H = 225;
  const TARGET_RATIO = 4 / 3;

  return new Promise(async (resolve, reject) => {
    try {
      const ctx = wx.createCanvasContext('image-cropper');
      if (!ctx) {
        return reject(new Error('Canvas context "image-cropper" not found.'));
      }

      const info = await wx.getImageInfo({ src: filePath });
      const { width, height } = info;
      if (!width || !height) return reject(new Error('Invalid image size.'));

      let cropW = width;
      let cropH = height;
      if (width / height > TARGET_RATIO) {
        cropH = height;
        cropW = height * TARGET_RATIO;
      } else {
        cropW = width;
        cropH = width / TARGET_RATIO;
      }

      const x = (width - cropW) / 2;
      const y = (height - cropH) / 2;

      ctx.drawImage(filePath, x, y, cropW, cropH, 0, 0, TARGET_W, TARGET_H);
      ctx.draw(false, () => {
        setTimeout(async () => {
          try {
            const res = await wx.canvasToTempFilePath({
              canvasId: 'image-cropper',
              width: TARGET_W,
              height: TARGET_H,
              destWidth: TARGET_W,
              destHeight: TARGET_H,
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
  generateThumbnail,
  generateThumbnail43
};
