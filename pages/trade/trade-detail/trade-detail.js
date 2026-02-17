const { callUser } = require('../../../utils/cloud');
const { toNum } = require('../../../utils/common');
const { setShopConfigCache } = require('../../../utils/shopConfigCache');

Page({
  data: {
    orderId: '',
    order: null,
    shopCfg: {},
    
    isInfoExpanded: false,
    
    refundSheetVisible: false,
    refundReasonList: ['不想要了', '商品有问题', '信息填写错误', '其他原因'],
    refundReasonIndex: 0,
    refundRemark: ''
  },

  onLoad(options) {
    const orderId = options.orderId; 
    if (orderId) this.setData({ orderId });

    this.loadShopConfig();

    const eventChannel = this.getOpenerEventChannel();
    if (eventChannel && eventChannel.on) {
       eventChannel.on('initOrder', ({ order }) => {
         if (order) this.setData({ order });
         this.refreshOrderDetail();
       });
    }
    
    if (!this.data.order && orderId) {
        this.refreshOrderDetail();
    }
  },

  onShow() {
    if(this.data.orderId || (this.data.order && this.data.order._id)) {
        this.refreshOrderDetail();
    }
  },

  async loadShopConfig() {
    try {
      const res = await callUser('getShopConfig');
      const cfg = res?.result?.data || {};

      setShopConfigCache(cfg);

      this.setData({
        shopCfg: {
          storeName: cfg.storeName || '',
          storeAddress: cfg.storeAddress || '',
          storeLat: toNum(cfg.storeLat, 0),
          storeLng: toNum(cfg.storeLng, 0),
          phone: String(cfg.phone || '').trim(),
        }
      });
    } catch (e) {
      console.error('[trade-detail] loadShopConfig error', e);
    }
  },

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

  toggleInfoExpand() {
    this.setData({
      isInfoExpanded: !this.data.isInfoExpanded
    });
  },

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

  copyOrderId() {
    const orderNo = String(this.data.order?.orderNo || '').trim();
    if (!orderNo) return;
    wx.setClipboardData({ data: orderNo });
  },

  copyExpressNo() {
    const expressNo = String(this.data.order?.expressNo || '').trim();
    if (!expressNo) {
      wx.showToast({ title: '暂无快递单号', icon: 'none' });
      return;
    }
    wx.setClipboardData({ data: expressNo });
  },

  contactShop() {
    const phone = String(this.data.shopCfg?.phone || '').trim();
    if (!phone) return wx.showToast({ title: '暂未配置联系电话', icon: 'none' });
    wx.makePhoneCall({ phoneNumber: phone });
  },

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
