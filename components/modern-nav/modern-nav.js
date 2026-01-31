// 现代化导航栏组件
Component({
  properties: {
    // 基础配置
    title: {
      type: String,
      value: ''
    },
    background: {
      type: String,
      value: ''
    },
    extClass: {
      type: String,
      value: ''
    },
    
    // 返回按钮配置
    showBack: {
      type: Boolean,
      value: false
    },
    backText: {
      type: String,
      value: ''
    },
    
    // 首页按钮配置
    showHome: {
      type: Boolean,
      value: false
    },
    
    // 加载状态
    loading: {
      type: Boolean,
      value: false
    },
    
    // 徽章
    badge: {
      type: String,
      value: ''
    },
    
    // 操作按钮
    actions: {
      type: Array,
      value: []
    },
    
    // 搜索栏配置
    showSearch: {
      type: Boolean,
      value: false
    },
    searchPlaceholder: {
      type: String,
      value: ''
    },
    searchValue: {
      type: String,
      value: ''
    }
  },
  
  data: {
    safeAreaTop: '0px'
  },
  
  lifetimes: {
    attached() {
      this.setSafeAreaTop()
    }
  },
  
  methods: {
    // 设置安全区域
    setSafeAreaTop() {
      const systemInfo = wx.getSystemInfoSync()
      const { statusBarHeight, platform } = systemInfo
      const isIOS = platform === 'ios'
      
      // iOS需要额外调整
      const top = isIOS ? statusBarHeight + 4 : statusBarHeight
      this.setData({
        safeAreaTop: `${top}px`
      })
    },
    
    // 返回按钮点击
    onBack() {
      this.triggerEvent('back')
      
      // 默认行为：返回上一页
      if (this.data.showBack) {
        wx.navigateBack({
          delta: 1,
          fail: () => {
            wx.switchTab({
              url: '/pages/home/home'
            })
          }
        })
      }
    },
    
    // 首页按钮点击
    onHome() {
      this.triggerEvent('home')
      
      // 默认行为：跳转到首页
      if (this.data.showHome) {
        wx.switchTab({
          url: '/pages/home/home'
        })
      }
    },
    
    // 操作按钮点击
    onAction(e) {
      const { id } = e.currentTarget.dataset
      this.triggerEvent('action', { id })
    },
    
    // 搜索输入
    onSearchInput(e) {
      const value = e.detail.value
      this.triggerEvent('searchinput', { value })
      this.setData({ searchValue: value })
    },
    
    // 搜索确认
    onSearchConfirm(e) {
      const value = e.detail.value
      this.triggerEvent('searchconfirm', { value })
    },
    
    // 清除搜索
    onClearSearch() {
      this.triggerEvent('clearsearch')
      this.setData({ searchValue: '' })
    }
  }
})