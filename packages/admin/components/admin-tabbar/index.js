Component({
  data: {
    active: '',
    tabs: [
      {
        key: 'goods',
        text: '商品管理',
        url: '/packages/admin/pages/goods/index'
      },
      {
        key: 'orders',
        text: '订单管理',
        url: '/packages/admin/pages/orders/index'
      },
      {
        key: 'shop',
        text: '店铺信息',
        url: '/packages/admin/pages/shop/index'
      }
    ]
  },

  lifetimes: {
    attached() {
      this._syncActiveByRoute()
    }
  },

  pageLifetimes: {
    show() {
      this._syncActiveByRoute()
    }
  },

  methods: {
    _syncActiveByRoute() {
      const pages = getCurrentPages()
      const cur = pages[pages.length - 1]
      const route = (cur && cur.route) || ''

      const map = {
        'packages/admin/pages/goods/index': 'goods',
        'packages/admin/pages/orders/index': 'orders',
        'packages/admin/pages/shop/index': 'shop'
      }

      const active = map[route] || ''
      if (active && active !== this.data.active) {
        this.setData({ active })
      }
    },

    onTap(e) {
      const key = e.currentTarget.dataset.key
      if (!key || key === this.data.active) return

      const tab = (this.data.tabs || []).find(t => t.key === key)
      if (!tab || !tab.url) return

      wx.reLaunch({ url: tab.url })
    }
  }
})
