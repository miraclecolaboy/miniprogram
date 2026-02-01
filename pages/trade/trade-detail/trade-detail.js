const { callUser } = require('../../../utils/cloud');

function s(v) { return String(v == null ? '' : v).trim(); }

function buildShippingAddressText(shippingInfo) {
  if (!shippingInfo) return '';
  const full = s(shippingInfo.address || shippingInfo.fullAddress || shippingInfo.poiAddress);
  if (full) return full;
  return [s(shippingInfo.region), s(shippingInfo.detail)].filter(Boolean).join(' ');
}

function mapOrderToView(order) {
  if (!order || typeof order !== 'object') return order;
  return { ...order, shippingAddressText: buildShippingAddressText(order.shippingInfo) };
}

Page({
  data: {
    orderId: '',
    order: null,
    refundSheetVisible: false,
    refundReasonList: ['不想要了', '商品有问题', '信息填写错误', '其他原因'],
    refundReasonIndex: 0,
    refundRemark: ''
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: '订单详情' });

    const orderId = options.orderId || options.id || '';
    if (orderId) this.setData({ orderId });

    const eventChannel = this.getOpenerEventChannel();
    eventChannel.on('initOrder', ({ order }) => {
      if (order) this.setData({ order: mapOrderToView(order) });
      this.refreshOrderDetail();
    });
  },

  onShow() {
    this.refreshOrderDetail();
  },

  async refreshOrderDetail() {
    const orderId = this.data.orderId || this.data.order?._id;
    if (!orderId) return;
    
    wx.showNavigationBarLoading();
    try {
      const res = await callUser('getOrderDetail', { orderId });
      const orderData = res?.result?.data;
      if (orderData) {
        this.setData({ order: mapOrderToView(orderData) });
      } else {
        throw new Error(res?.result?.message || '加载订单失败');
      }
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  openNavigate() {
    const { order } = this.data;
    if (!order) return;
    const isZiti = order.mode === 'ziti';
    const lat = isZiti ? order.storeLat : order.shippingInfo?.lat;
    const lng = isZiti ? order.storeLng : order.shippingInfo?.lng;
    const name = isZiti ? order.storeName : order.shippingInfo?.name;
    const address = isZiti ? order.storeName : (order.shippingAddressText || buildShippingAddressText(order.shippingInfo));
    if (lat != null && lng != null) {
      wx.openLocation({ latitude: lat, longitude: lng, name, address });
    }
  },

  copyOrderId() {
    if (this.data.order?.orderNo) {
      wx.setClipboardData({ data: this.data.order.orderNo });
    }
  },
  
  contactShop() {
    wx.navigateTo({ url: '/pages/mine/service/service' });
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
  chooseRefundReason(e) { this.setData({ refundReasonIndex: e.currentTarget.dataset.index }); },
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
          title: '提示',
          content: '确定要取消本次售后申请吗？',
          success: resolve
      }));
      if (!confirm) return;
  
      wx.showLoading({ title: '正在取消...', mask: true });
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
