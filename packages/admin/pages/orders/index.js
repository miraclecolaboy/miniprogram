// packages/admin/pages/orders/index.js
// 订单管理页：按客户端页面的方式拆分 methods，降低单文件复杂度
const listMethods = require('./orders.list');
const decorateMethods = require('./orders.decorate');
const actionMethods = require('./orders.actions');

Page(Object.assign({
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
}, decorateMethods, listMethods, actionMethods));
