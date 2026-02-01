// pages/trade/trade-refund-detail/trade-refund-detail.js
const { callUser } = require('../../../utils/cloud');
const { fmtTime } = require('../../../utils/common');

const AFTER_SALE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

function s(v) { return String(v == null ? '' : v).trim(); }

function buildShippingAddressText(shippingInfo) {
  if (!shippingInfo) return '';
  const full = s(shippingInfo.address || shippingInfo.fullAddress || shippingInfo.poiAddress);
  if (full) return full;
  return [s(shippingInfo.region), s(shippingInfo.detail)].filter(Boolean).join(' ');
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
    wx.setNavigationBarTitle({ title: '售后详情' });
    const orderId = options.orderId || options.id || '';
    if (orderId) {
      this.setData({ orderId });
      this.refreshFromCloud(true);
    }
  },

  onShow() {
    if (this.data.orderId) {
      this.refreshFromCloud(false);
    }
  },
  
  async refreshFromCloud(showLoading) {
    const key = this.data.orderId;
    if (!key) return;

    if (showLoading) wx.showLoading({ title: '加载中...' });

    try {
      const res = await callUser('getOrderDetail', { orderId: key });
      const orderData = res?.result?.data;
      if (!orderData) throw new Error('订单加载失败');
      
      const mappedOrder = this.mapOrderToView(orderData);
      this.setData({ order: mappedOrder });
      
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      if (showLoading) wx.hideLoading();
    }
  },

  mapOrderToView(rawOrder) {
      const order = rawOrder || {};
      const refund = order.refund || {};
      
      const statusKey = String(refund.status || '').toLowerCase();
      const isSuccess = ['success', 'refunded'].includes(statusKey);
      const isRejected = ['rejected', 'reject'].includes(statusKey);
      const isCancelled = ['cancelled', 'canceled', 'cancel'].includes(statusKey);
      const isApplied = statusKey === 'applied';
      const windowExpired = order.status === 'done' && (Date.now() - (order.doneAt || 0)) > AFTER_SALE_WINDOW_MS;

      let actionType = 'none';
      let actionText = '不可操作';
      let actionDisabled = true;

      if (isApplied && !windowExpired) {
          actionType = 'cancel';
          actionText = '取消售后';
          actionDisabled = false;
      } else if ((isRejected || isCancelled) && !windowExpired) {
          actionType = 'reapply';
          actionText = '重新申请';
          actionDisabled = false;
      } else if (isSuccess) {
          actionText = '售后已完成';
      } else if (windowExpired) {
          actionText = '已超出售后期';
      }
      
      const applyReasonText = [String(refund.reason || '').trim(), String(refund.remark || '').trim()].filter(Boolean).join('；');
      
      const mappedRefund = {
          ...refund,
          statusText: refund.statusText || '售后处理中',
          latestTime: refund.latestAt ? fmtTime(refund.latestAt) : (refund.logs && refund.logs.length > 0 ? fmtTime(refund.logs[refund.logs.length-1].ts) : ''),
          latestText: refund.logs && refund.logs.length > 0 ? refund.logs[refund.logs.length-1].text : '等待处理',
          applyReasonText: applyReasonText,
          actionType,
          actionText,
          actionDisabled
      };

      return { ...order, refund: mappedRefund, shippingAddressText: buildShippingAddressText(order.shippingInfo) };
  },

  handleRefundAction() {
    const { order } = this.data;
    if (!order || !order.refund || order.refund.actionDisabled) return;

    const actionType = order.refund.actionType;
    if (actionType === 'reapply') {
      this.openRefundSheet();
    } else if (actionType === 'cancel') {
      this.confirmCancelRefund();
    }
  },

  openRefundSheet() {
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
    const { order, refundReasonList, refundReasonIndex, refundRemark } = this.data;
    if (!order) return;
    
    this.closeRefundSheet();
    wx.showLoading({ title: '提交中...', mask: true });

    try {
        const reason = refundReasonList[refundReasonIndex] || '其他原因';
        const res = await callUser('applyRefund', { orderId: order._id, reason, remark: refundRemark });
        if (!res?.result?.ok) throw new Error(res?.result?.message || '申请失败');
        
        wx.showToast({ title: '申请成功', icon: 'success' });
        this.refreshFromCloud(true);
    } catch (e) {
        wx.showToast({ title: e.message || '申请失败', icon: 'none' });
    } finally {
        wx.hideLoading();
    }
  },

  async confirmCancelRefund() {
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
        // 返回上一页，因为当前售后已不存在
        setTimeout(() => wx.navigateBack(), 400);
    } catch (e) {
        wx.showToast({ title: e.message || '取消失败', icon: 'none' });
    } finally {
        wx.hideLoading();
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
});
