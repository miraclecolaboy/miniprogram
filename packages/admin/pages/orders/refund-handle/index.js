// packages/admin/pages/orders/refund-handle/index.js
// 售后处理页：按客户端页面的方式拆分 methods，降低单文件复杂度
const decorateMethods = require('./refund-handle.decorate');
const logicMethods = require('./refund-handle.logic');

Page(Object.assign({
  data: {
    key: '',
    loading: false,
    order: null,
    remark: '',
  },
}, decorateMethods, logicMethods));
