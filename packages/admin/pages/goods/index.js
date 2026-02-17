
const listMethods = require('./goods.list');
const formMethods = require('./goods.form');
const skuMethods = require('./goods.sku');
const categoryMethods = require('./goods.category');

Page(Object.assign({
  data: {
    keyword: '',
    loading: false,
    hasMore: true,
    pageNum: 1,
    pageSize: 20,
    categories: [{ _id: 'all', name: '全部分类' }],
    filterCategoryIndex: 0,
    list: [],
    showForm: false,
    editingId: '',
    saving: false,
    
    deletedFileIDs: [],
    
    formCategoryIndex: 0,
    formModesMap: { ziti: true, waimai: true, kuaidi: true },
    
    form: {
      name: '', categoryId: '', price: '', sort: '0', onShelf: true,
      modes: ['ziti', 'waimai', 'kuaidi'],
      
      displayImages: [],
      thumb: { localPath: '', fileID: '' },
      originalThumbFileID: '',

      desc: '', detail: '', hasSpecs: false, specs: [], skuList: []
    },

    showSkuModal: false,
    skuLoading: false,
    skuSaving: false,
    skuItems: [],
    skuBulkPrice: '',
    showCategoryForm: false,
    categorySaving: false,
    categoryDeletingId: '',
    categoryForm: { name: '', sort: '0' }
  },

  noop() {}

}, listMethods, formMethods, skuMethods, categoryMethods));
