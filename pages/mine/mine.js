// pages/mine/mine.js
const { ensureLogin, isLoginOK, refreshUserToStorage } = require('../../utils/auth');
const { callUser } = require('../../utils/cloud');
const { USER: KEY_USER } = require('../../utils/storageKeys');

function getMemberTag(memberLevel, totalRecharge) {
  const lv = Number(memberLevel || 0);
  if (lv >= 4) return 'Lv4 - 永久95折';
  if (lv > 0) return `Lv${lv} - 累计充值${Number(totalRecharge || 0)}元`;
  return '';
}

Page({
  data: {
    userInfo: null,
    isLogin: false,
    showProfilePopup: false,
    profileNickName: '',
    profileAvatarTmp: '',
    profileAvatarPreview: '',
    profileSaving: false,
    vipCardHeight: 140,
  },

  onLoad() {
    this.initVipCardHeight();
    this.refreshPageData(false);
  },

  onShow() {
    this.refreshPageData(false);
  },

  onPullDownRefresh() {
    this.refreshPageData(true).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async refreshPageData(forceCloud = false) {
    if (!isLoginOK()) {
      this.setData({ isLogin: false, userInfo: null });
      return;
    }

    if (!forceCloud) {
      const cachedUser = wx.getStorageSync(KEY_USER);
      if (cachedUser) {
        this.setData({
          isLogin: true,
          userInfo: this.mapUserToView(cachedUser),
        });
      }
    }

    try {
      const res = await callUser('getMe', {});
      const user = res?.result?.data;
      if (user) {
        wx.setStorageSync(KEY_USER, user);
        // Keep other cached fields (balance/points/memberLevel/...) in sync.
        refreshUserToStorage(user).catch(() => {});
        this.setData({
          isLogin: true,
          userInfo: this.mapUserToView(user),
        });
      }
    } catch (error) {
      console.error('[mine] 刷新用户信息失败:', error);
      if (!this.data.userInfo) {
        wx.showToast({ title: '信息加载失败', icon: 'none' });
      }
    }
  },

  mapUserToView(user) {
    if (!user) return null;
    const memberLevel = Number(user.memberLevel || 0);
    const totalRecharge = Number(user.totalRecharge || 0);
    const memberActive = memberLevel > 0;
    return {
      nickName: user.nickName || '未设置昵称',
      avatarUrl: user.avatarUrl || '',
      balance: Number(user.balance || 0).toFixed(2),
      points: Number(user.points || 0),
      memberActive: memberActive,
      memberLevel,
      memberTag: getMemberTag(memberLevel, totalRecharge),
      userSub: '欢迎回来'
    };
  },
  
  async loginAndNavigate(url, isSwitchTab = false) {
    try {
      await ensureLogin();
      await this.refreshPageData(true);
      if (url && isSwitchTab) {
        wx.switchTab({ url });
      } else if (url) {
        wx.navigateTo({ url });
      }
    } catch (error) {
      wx.showToast({ title: '登录失败', icon: 'none' });
    }
  },
  
  onTapUserCard() {
    if (!this.data.isLogin) {
      this.loginAndNavigate();
    } else {
      this.openProfilePopup();
    }
  },

  openProfilePopup() {
    const { userInfo } = this.data;
    if (!userInfo) return;
    this.setData({
      showProfilePopup: true,
      profileNickName: userInfo.nickName === '未设置昵称' ? '' : userInfo.nickName,
      profileAvatarTmp: '',
      profileAvatarPreview: userInfo.avatarUrl,
    });
  },

  closeProfilePopup() {
    if (this.data.profileSaving) return;
    this.setData({ showProfilePopup: false });
  },

  onNickInput(e) {
    this.setData({ profileNickName: e.detail.value || '' });
  },

  async onChangeAvatar() {
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'], 
        sizeType: ['compressed'], 
      });
      const tempFilePath = res.tempFiles[0].tempFilePath;
      if (tempFilePath) {
        this.setData({
          profileAvatarTmp: tempFilePath,
          profileAvatarPreview: tempFilePath,
        });
      }
    } catch (error) {
      if (error.errMsg && error.errMsg.includes('cancel')) return;
      wx.showToast({ title: '选择图片失败', icon: 'none' });
    }
  },

  async _cropAndCompressAvatar(filePath) {
    const canvasId = 'avatar-cropper';
    const ctx = wx.createCanvasContext(canvasId, this);
    try {
      const imgInfo = await wx.getImageInfo({ src: filePath });
      const { width, height } = imgInfo;
      const targetSize = 300;
      let drawSource = { path: filePath, sx: 0, sy: 0, sWidth: 0, sHeight: 0 };
      let drawTarget = { dx: 0, dy: 0, dWidth: targetSize, dHeight: targetSize };
      const cropSize = Math.min(width, height);
      drawSource.sx = (width - cropSize) / 2;
      drawSource.sy = (height - cropSize) / 2;
      drawSource.sWidth = cropSize;
      drawSource.sHeight = cropSize;
      if (cropSize < targetSize) {
        drawTarget.dWidth = cropSize;
        drawTarget.dHeight = cropSize;
      }
      ctx.drawImage(drawSource.path, drawSource.sx, drawSource.sy, drawSource.sWidth, drawSource.sHeight, drawTarget.dx, drawTarget.dy, drawTarget.dWidth, drawTarget.dHeight);
      await new Promise(resolve => ctx.draw(false, resolve));
      const res = await wx.canvasToTempFilePath({
        canvasId: canvasId,
        width: drawTarget.dWidth,   
        height: drawTarget.dHeight, 
        destWidth: drawTarget.dWidth,
        destHeight: drawTarget.dHeight,
        fileType: 'jpg',
        quality: 0.8, 
      }, this);
      return res.tempFilePath;
    } catch (e) {
        return filePath;
    }
  },

  async onSaveProfile() {
    if (this.data.profileSaving) return;
    const nickName = this.data.profileNickName.trim();
    if (!nickName) {
      return wx.showToast({ title: '请输入昵称', icon: 'none' });
    }
    this.setData({ profileSaving: true });
    try {
      let newFileID = '';
      if (this.data.profileAvatarTmp) {
        wx.showLoading({ title: '处理头像...', mask: true });
        const processedPath = await this._cropAndCompressAvatar(this.data.profileAvatarTmp);
        wx.showLoading({ title: '上传中...', mask: true });
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `avatars/${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`,
          filePath: processedPath,
        });
        newFileID = uploadRes.fileID;
      }
      wx.showLoading({ title: '保存中...', mask: true });
      const payload = { nickName };
      if (newFileID) {
        payload.avatarUrl = newFileID;
      }
      await callUser('updateProfile', payload);
      await this.refreshPageData(true);
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.closeProfilePopup();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ profileSaving: false });
    }
  },
  
  initVipCardHeight() {
    try {
      const systemInfo = wx.getSystemInfoSync();
      const totalHorizontalGap = (systemInfo.windowWidth / 750) * 148;
      const cardWidth = systemInfo.windowWidth - totalHorizontalGap;
      this.setData({ vipCardHeight: cardWidth / 2 });
    } catch (e) {}
  },

  onRecharge() { if(this.data.isLogin) wx.navigateTo({ url: '/pages/mine/recharge/recharge' }); else this.loginAndNavigate('/pages/mine/recharge/recharge'); },
  onPoints() { if(this.data.isLogin) wx.navigateTo({ url: '/pages/mine/points/points' }); else this.loginAndNavigate('/pages/mine/points/points'); },
  onTapMember() { if(this.data.isLogin) wx.navigateTo({ url: '/pages/mine/member/member' }); else this.loginAndNavigate('/pages/mine/member/member'); },
  onTapService() { if(this.data.isLogin) wx.navigateTo({ url: '/pages/mine/service/service' }); else this.loginAndNavigate('/pages/mine/service/service'); },
  onTapAddress() { if(this.data.isLogin) wx.navigateTo({ url: '/pages/mine/address/address' }); else this.loginAndNavigate('/pages/mine/address/address'); },
  onTapOrder() { wx.switchTab({ url: '/pages/trade/trade-list/trade-list' }); },

  onTapCoupon() {
    if(this.data.isLogin) {
      wx.navigateTo({ url: '/pages/mine/coupon/index' });
    } else {
      this.loginAndNavigate('/pages/mine/coupon/index');
    }
  },

  onShareAppMessage() {
    return {
      title: '',
      path: '/pages/home/home',
      imageUrl: '/assets/logo.jpg'
    };
  },

  noop() {},
});
