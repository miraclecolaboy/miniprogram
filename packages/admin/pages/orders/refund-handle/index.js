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
