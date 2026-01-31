// packages/admin/pages/orders/index.js
const { requireLogin } = require('../../utils/auth');
const { call } = require('../../utils/cloud');
const { fmtTime } = require('../../../../utils/common');

// --- 辅助函数 (用于UI展示) ---
function maskPhone(p) {
  return String(p || ''); // 商家端不打码
}

function modeText(mode, storeSubMode) {
  const m = String(mode || '').trim();
  if (m === 'ziti') {
    const raw = String(storeSubMode || '').trim();
    const sub = ['tangshi', 'ziti'].includes(raw) ? raw : 'ziti';
    const subText = sub === 'tangshi' ? '堂食' : '自提';
    return subText;
  }
  if (m === 'waimai') return '外卖';
  if (m === 'kuaidi') return '快递';
  return m;
}

/**
 * [核心修改] 简化状态文本生成逻辑
 * 明确将 'processing' 视为 '准备中'
 */
function buildStatusText(o) {
  const st = String(o?.status || '').toLowerCase();
  if (['paid', 'making', 'processing'].includes(st)) return '准备中';
  if (st === 'ready') return '待取餐';
  if (st === 'delivering') return '派送中';
  if (st === 'done') return '已完成';
  if (st === 'cancelled') return '已取消';
  return String(o?.statusText || st || '');
}

function getRefundStatus(o) {
  return String(o?.refund?.status || '').toLowerCase();
}

function needRefundHandle(o) {
  const s = getRefundStatus(o);
  return ['applied', 'applying', 'pending', 'request', 'requested'].includes(s);
}

Page({
  data: {
    tabs: [
      { key: 'making', title: '准备中' },
      { key: 'ready', title: '待取餐' },
      { key: 'delivering', title: '派送中' },
      { key: 'done', title: '已完成' },
      { key: 'refund', title: '售后' },
    ],
    activeTab: 'making',
    list: [],
    pageNum: 1,
    pageSize: 15,
    loading: false,
    noMore: false,
    expressModal: { show: false, orderId: '', value: '' },
  },

  async onShow() {
    if (requireLogin()) {
      await this.reload();
    }
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    this.loadMore();
  },

  onTabTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeTab) return;
    this.setData({ activeTab: key }, () => this.reload());
  },

  async reload() {
    this.setData({ pageNum: 1, noMore: false, list: [] });
    await this.fetchList(true);
  },

  async loadMore() {
    if (this.data.loading || this.data.noMore) return;
    await this.fetchList(false);
  },

  async fetchList(reset) {
    const session = requireLogin();
    if (!session) return;

    const { activeTab, pageSize } = this.data;
    const pageNum = reset ? 1 : this.data.pageNum;

    this.setData({ loading: true });

    try {
      const res = await call('admin', {
        action: 'orders_list',
        token: session.token,
        tab: activeTab,
        pageNum: pageNum,
        pageSize: pageSize,
      });

      const newOrders = (res && res.list) ? res.list : [];
      const decoratedOrders = newOrders.map(o => this.decorateOrder(o));
      
      const currentOrders = reset ? [] : (this.data.list || []);
      const finalList = currentOrders.concat(decoratedOrders);

      this.setData({
        list: finalList,
        noMore: newOrders.length < pageSize,
        pageNum: pageNum + 1,
      });

    } catch (e) {
      console.warn(`[orders] fetchList for tab ${activeTab} failed`, e);
      if (!reset) this.setData({ noMore: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * [核心修改] 移除旧字段兼容，直接读取新结构
   */
  decorateOrder(o) {
    const hasRefund = !!(o && o.refund);
    const refundStatus = getRefundStatus(o);
    // 售后已结束但订单可继续履约（如拒绝/取消售后）
    const refundEndedButOrderContinues = ['rejected', 'reject', 'cancelled', 'canceled'];
    // 售后进行中/或已退款成功：不允许继续推进订单状态（避免误操作）
    const refundBlocksOrder = hasRefund && !refundEndedButOrderContinues.includes(refundStatus);
    const needHandle = hasRefund && needRefundHandle(o);

    // 商品
    const items = o.items || [];
    const itemsView = items.map((it, idx) => {
      const name = String(it.productName || it.name || '');
      const c = Number(it.count || 0) || 0;
      const spec = String(it.specText || '').trim();
      return { key: `${o._id}_${idx}`, line: `${name} × ${c}${spec ? `（${spec}）` : ''}` };
    });

    // 地址
    const addr = o.shippingInfo || {}; // 直接读取 shippingInfo
    const receiverName = addr.name || '';
    const receiverPhone = addr.phone || '';
    const addrText = `${addr.region || ''}${addr.detail || ''}`;
    const addrCopyText = (o.mode !== 'ziti') ? `${[receiverName, receiverPhone].filter(Boolean).join(' ')}\n${addrText}`.trim() : '';
    
    // 自提
    const pickupInfo = o.pickupInfo || {}; // 直接读取 pickupInfo
    const pickupCodeText = String(pickupInfo.code || '');
    let pickupTimeText = '';
    if (o.mode === 'ziti' && pickupInfo.time) {
      pickupTimeText = typeof pickupInfo.time === 'number' ? fmtTime(pickupInfo.time) : String(pickupInfo.time).trim();
    }
    
    // 金额
    const amount = o.amount || {}; // 直接读取 amount
    const payAmountText = Number(amount.total || 0).toFixed(2);
    const goodsAmountText = Number(amount.goods || 0).toFixed(2);
    const deliveryAmountText = Number(amount.delivery || 0).toFixed(2);
    const vipDiscountNum = Number(amount.vipDiscount != null ? amount.vipDiscount : (amount.discount || 0));
    const couponDiscountNum = Number(amount.couponDiscount || 0);
    const vipDiscountText = Number.isFinite(vipDiscountNum) ? vipDiscountNum.toFixed(2) : '0.00';
    const couponDiscountText = Number.isFinite(couponDiscountNum) ? couponDiscountNum.toFixed(2) : '0.00';
    
    // 状态
    const st = String(o.status || '').toLowerCase();
    const isPaidLike = !!o.paidAt || ['paid', 'making', 'processing', 'ready', 'delivering', 'done'].includes(st);
    const canApplyRefund = !!(isPaidLike && st !== 'cancelled' && (!hasRefund || refundEndedButOrderContinues.includes(refundStatus)));

    return {
      ...o,
      modeText: modeText(o.mode, o.storeSubMode),
      statusView: refundBlocksOrder
        ? (String((o.refund && o.refund.statusText) || '').trim() || buildStatusText(o))
        : buildStatusText(o),
      createdAtText: fmtTime(o.createdAt),
      paidAtText: fmtTime(o.paidAt),
      pickupCodeText,
      pickupTimeText,
      receiverName,
      receiverPhone,
      receiverPhoneMasked: maskPhone(receiverPhone),
      addrText,
      addrCopyText,
      itemsView,
      remarkText: String(o.remark || '').trim(),
      payAmountText, // 使用新的 payAmountText
      amountGoodsText: goodsAmountText,
      amountDeliveryText: deliveryAmountText,
      amountVipDiscountText: vipDiscountText,
      amountCouponDiscountText: couponDiscountText,
      expressNoText: String(o.expressNo || '').trim(),
      refundHandled: refundBlocksOrder,
      needRefundHandle: needHandle,
      canApplyRefund,
    };
  },

  // --- 以下为页面事件处理，保持不变 ---
  onCopyAddress(e) {
    const text = e.currentTarget.dataset.copytext || '';
    if (text) wx.setClipboardData({ data: text });
  },

  onCopyPhone(e) {
    const phone = e.currentTarget.dataset.phone || '';
    if (phone) wx.setClipboardData({ data: String(phone) });
  },

  onOpenExpressModal(e) {
    const orderId = e.currentTarget.dataset.id || '';
    const no = e.currentTarget.dataset.no || '';
    if (!orderId) return;
    this.setData({ expressModal: { show: true, orderId, value: no } });
  },

  onCloseExpressModal() {
    this.setData({ expressModal: { show: false, orderId: '', value: '' } });
  },
  
  onExpressInput(e) {
    this.setData({ 'expressModal.value': String(e.detail?.value || '').trim() });
  },

  async onConfirmExpress() {
    const session = requireLogin();
    if (!session) return;
    const { orderId, value } = this.data.expressModal || {};
    const expressNo = String(value || '').trim();
    if (!orderId || !expressNo) return wx.showToast({ title: '请输入快递单号', icon: 'none' });
    wx.showLoading({ title: '提交中', mask: true });
    try {
      const res = await call('admin', { action: 'orders_setExpressNo', token: session.token, id: orderId, expressNo });
      if (!res || !res.ok) throw new Error(res?.message || '提交失败');
      wx.showToast({ title: '已保存', icon: 'success' });
      this.onCloseExpressModal();
      await this.reload();
    } catch (e) {
      wx.showToast({ title: e?.message || '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onUpdateStatus(e) {
    const { id, status } = e.currentTarget.dataset;
    if (!id || !status) return;
    const session = requireLogin();
    if (!session) return;
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await call('admin', { action: 'orders_updateStatus', token: session.token, id, status });
      if (!res || !res.ok) throw new Error(res?.message || '操作失败');
      wx.showToast({ title: '已更新', icon: 'success' });
      await this.reload();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onApplyRefund(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const session = requireLogin();
    if (!session) return;
    const order = (this.data.list || []).find(x => x?._id === id);
    const doneAt = order?.doneAt || 0;
    const over3Days = order?.status === 'done' && doneAt > 0 && (Date.now() - doneAt) > 3 * 24 * 60 * 60 * 1000;
    const ok = await new Promise(resolve => wx.showModal({
      title: '申请售后',
      content: over3Days ? '该订单已完成超过3天，仍要申请售后吗？' : '确认对该订单发起售后申请？',
      confirmText: over3Days ? '继续申请' : '确认',
      cancelText: '取消',
      success: (r) => resolve(!!r.confirm)
    }));
    if (!ok) return;
    wx.showLoading({ title: '提交中', mask: true });
    try {
      const res = await call('admin', { action: 'orders_applyRefund', token: session.token, id, reason: '商家发起', remark: '' });
      if (!res || !res.ok) throw new Error(res?.message || '提交失败');
      wx.showToast({ title: '已提交售后', icon: 'success' });
      this.reload();
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onPrint(e) {
    const s = requireLogin();
    if (!s) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showLoading({ title: '打印中', mask: true });
    try {
      const r = await call('cloudPrint', { action: 'printOrder', token: s.token, orderId: id });
      if (r && r.ok) return wx.showToast({ title: '已发送', icon: 'success' });
      wx.showModal({ title: '打印失败', content: r?.message || '云打印失败', showCancel: false });
    } catch (err) {
      if (err?.code !== 'AUTH_EXPIRED') {
        wx.showModal({ title: '打印失败', content: err?.message || '云打印失败', showCancel: false });
      }
    } finally {
      wx.hideLoading();
    }
  },

  goRefundHandle(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/packages/admin/pages/orders/refund-handle/index?id=${id}` });
  },

  noop() {},
});
