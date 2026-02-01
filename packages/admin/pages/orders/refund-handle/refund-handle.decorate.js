// packages/admin/pages/orders/refund-handle/refund-handle.decorate.js

const { fmtTime } = require('../../../../../utils/common');
const { mergeApplyReasonText, modeText } = require('./refund-handle.helpers');

module.exports = {
  decorateOrder(o) {
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsView = items.map((it, idx) => {
      const name = String(it.name || it.productName || '');
      const c = Number(it.count || 0) || 0;
      const spec = String(it.specText || '').trim();
      const line = `${name} × ${c}${spec ? `（${spec}）` : ''}`;
      return { key: `${o._id}_${idx}`, line };
    });

    const refund = o.refund || {};
    const latestTime = refund.latestTime || refund.latestAt || 0;
    const refundApplyReasonText = mergeApplyReasonText(refund.reason, refund.remark);
    const handleRemarkText = String(refund.handleRemark || '').trim();
    const handleByText = String(refund.handleBy || '').trim();
    const handleTimeText = refund.handleTime ? String(refund.handleTime) : (refund.handleAt ? fmtTime(refund.handleAt) : '');
    const st = String(refund.status || '').trim().toLowerCase();
    const refundIsProcessing = !!refund && !['success', 'rejected', 'cancelled', 'failed'].includes(st);

    return {
      ...o,
      modeText: modeText(o.mode, o.storeSubMode),
      createdAtText: fmtTime(o.createdAt),
      // 从 order.amount.total 读取金额
      payAmountText: Number(o.amount?.total || 0).toFixed(2),
      refundStatusText: String(refund.statusText || '售后处理中'),
      refundLatestText: String(refund.latestText || ''),
      refundLatestTimeText: latestTime ? fmtTime(latestTime) : '',
      remarkText: String(o.remark || '').trim(),
      refundApplyReasonText,
      refundIsProcessing,
      refundHandleRemarkText: handleRemarkText,
      refundHandleByText: handleByText,
      refundHandleTimeText: handleTimeText,
      itemsView,
      refundStatus: String(refund.status || ''),
    };
  },
};

