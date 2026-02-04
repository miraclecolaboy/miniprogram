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
    
    // UI状态
    memberCardExpanded: false, // 会员卡是否展开
    showProfilePopup: false,
    profileNickName: '',
    profileAvatarTmp: '',
    profileAvatarPreview: '',
    profileSaving: false,
  },

  onLoad() {
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
        refreshUserToStorage(user).catch(() => {});
        this.setData({
          isLogin: true,
          userInfo: this.mapUserToView(user),
        });
      }
    } catch (error) {
      console.error('[mine] 刷新用户信息失败:', error);
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

  // --- 交互逻辑 ---

  // 切换会员卡展开/收起
  toggleMemberCard() {
    if (!this.data.isLogin) {
      return this.loginAndNavigate();
    }
    this.setData({
      memberCardExpanded: !this.data.memberCardExpanded
    });
  },
  
  async loginAndNavigate(url, isSwitchTab = false) {
    try {
      await ensureLogin();
      await this.refreshPageData(true);
      if (url) {
        if (isSwitchTab) wx.switchTab({ url });
        else wx.navigateTo({ url });
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

  // --- 个人资料弹窗逻辑 ---
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
       // ignore cancel
    }
  },

  async _cropAndCompressAvatar(filePath) {
    // 简化版：直接返回路径，如需裁剪逻辑可保留原代码
    return filePath; 
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
        wx.showLoading({ title: '上传中...', mask: true });
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `avatars/${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`,
          filePath: this.data.profileAvatarTmp,
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
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ profileSaving: false });
    }
  },

  // --- 路由跳转 ---
  onRecharge() { if(this.data.isLogin) wx.navigateTo({ url: '/pages/mine/recharge/recharge' }); else this.loginAndNavigate('/pages/mine/recharge/recharge'); },
  onPoints() { if(this.data.isLogin) wx.navigateTo({ url: '/pages/mine/points/points' }); else this.loginAndNavigate('/pages/mine/points/points'); },
  // 点击会员权益文字跳转详情，点击卡片本身是展开
  onTapMemberDetail() { if(this.data.isLogin) wx.navigateTo({ url: '/pages/mine/member/member' }); else this.loginAndNavigate('/pages/mine/member/member'); },
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