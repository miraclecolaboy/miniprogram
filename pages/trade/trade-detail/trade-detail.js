const { callUser } = require('../../../utils/cloud');
const { toNum } = require('../../../utils/common');

Page({
  data: {
    orderId: '',
    order: null,
    shopCfg: {},
    
    // UI状态
    isInfoExpanded: false, // 控制底部信息折叠
    
    // 售后弹窗
    refundSheetVisible: false,
    refundReasonList: ['不想要了', '商品有问题', '信息填写错误', '其他原因'],
    refundReasonIndex: 0,
    refundRemark: ''
  },

  onLoad(options) {
    const orderId = options.orderId; 
    if (orderId) this.setData({ orderId });

    this.loadShopConfig();

    // 尝试从 EventChannel 获取预加载数据
    const eventChannel = this.getOpenerEventChannel();
    if (eventChannel && eventChannel.on) {
       eventChannel.on('initOrder', ({ order }) => {
         if (order) this.setData({ order });
         this.refreshOrderDetail(); // 静默刷新
       });
    }
    
    if (!this.data.order && orderId) {
        this.refreshOrderDetail();
    }
  },

  onShow() {
    // 每次显示都刷新最新状态
    if(this.data.orderId || (this.data.order && this.data.order._id)) {
        this.refreshOrderDetail();
    }
  },

  async loadShopConfig() {
    try {
      const res = await callUser('getShopConfig');
      const cfg = res?.result?.data || {};
      this.setData({
        shopCfg: {
          storeName: cfg.storeName || '',
          storeAddress: cfg.storeAddress || '',
          storeLat: toNum(cfg.storeLat, 0),
          storeLng: toNum(cfg.storeLng, 0),
        }
      });
    } catch (e) {
      console.error('[trade-detail] loadShopConfig error', e);
    }
  },

  // 获取订单详情
  async refreshOrderDetail() {
    const orderId = this.data.orderId || this.data.order?._id;
    if (!orderId) return;
    
    wx.showNavigationBarLoading();
    try {
      const res = await callUser('getOrderDetail', { orderId });
      const orderData = res?.result?.data;
      if (orderData) {
        this.setData({ order: orderData });
      }
    } catch (e) {
      console.error(e);
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  // [新增] 切换底部信息展开/收起
  toggleInfoExpand() {
    this.setData({
      isInfoExpanded: !this.data.isInfoExpanded
    });
  },

  // 导航
  openNavigate() {
    const { order } = this.data;
    if (!order) return;
    
    if (order.mode === 'ziti') {
      const latitude = toNum(this.data.shopCfg.storeLat, 0);
      const longitude = toNum(this.data.shopCfg.storeLng, 0);

      if (!latitude || !longitude) {
        wx.showToast({ title: '暂未配置门店位置', icon: 'none' });
        return;
      }

      wx.openLocation({
        latitude,
        longitude,
        name: this.data.shopCfg.storeName || '门店位置',
        address: this.data.shopCfg.storeAddress || '',
      });
    }
  },

  // 复制订单号
  copyOrderId() {
    if (this.data.order?.orderNo) {
      wx.setClipboardData({ data: this.data.order.orderNo });
    }
  },

  // 联系商家/客服
  contactShop() {
    wx.makePhoneCall({ phoneNumber: '13800138000' }); // 请替换为真实配置
  },

  // --- 售后逻辑 ---
  openRefundSheet() {
    if (!this.data.order?.canApplyRefund) return;
    this.setData({
      refundSheetVisible: true,
      refundReasonIndex: 0,
      refundRemark: ''
    });
  },
  
  closeRefundSheet() { this.setData({ refundSheetVisible: false }); },
  
  chooseRefundReason(e) { 
      const index = e.currentTarget.dataset.index;
      this.setData({ refundReasonIndex: index }); 
  },
  
  onRefundRemarkInput(e) { this.setData({ refundRemark: e.detail.value }); },

  async submitRefund() {
    const { order, refundReasonIndex, refundReasonList, refundRemark } = this.data;
    if (!order?._id) return;

    const reason = refundReasonList[refundReasonIndex] || '其他原因';

    this.closeRefundSheet();
    wx.showLoading({ title: '提交中', mask: true });

    try {
      const res = await callUser('applyRefund', {
        orderId: order._id,
        reason: reason,
        remark: refundRemark
      });

      if (!res?.result?.ok) {
        throw new Error(res?.result?.message || '提交失败');
      }

      wx.showToast({ title: '售后申请已提交', icon: 'success' });
      this.refreshOrderDetail();

    } catch (e) {
      wx.showToast({ title: e.message || '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async cancelRefund() {
      const { order } = this.data;
      if (!order) return;
      const { confirm } = await new Promise(resolve => wx.showModal({
          title: '提示', content: '确定要取消本次售后申请吗？', success: resolve
      }));
      if (!confirm) return;
      
      wx.showLoading({ title: '处理中...', mask: true });
      try {
          const res = await callUser('cancelRefund', { orderId: order._id });
          if (!res?.result?.ok) throw new Error(res?.result?.message || '取消失败');
          wx.showToast({ title: '已取消', icon: 'none' });
          this.refreshOrderDetail();
      } catch (e) {
          wx.showToast({ title: e.message || '取消失败', icon: 'none' });
      } finally {
          wx.hideLoading();
      }
  },

  goRefundDetail() {
    if (!this.data.order?._id) return;
    wx.navigateTo({
      url: `/pages/trade/trade-refund-detail/trade-refund-detail?orderId=${this.data.order._id}`,
    });
  },
});
