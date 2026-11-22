// app.js - Main application entry point
App({
  onLaunch: function () {
    // 获取用户信息（使用 wx.getUserProfile 替代已废弃的 wx.getUserInfo）
    // wx.getUserProfile 需要用户主动触发，在页面中通过按钮调用
  },

  globalData: {
    userInfo: null,
    token: null,
    // 多环境 API 地址配置
    apiBaseUrl: (function () {
      var envVersion = __wxConfig && __wxConfig.envVersion || 'develop'
      var urls = {
        develop: 'http://localhost:8080/api/v1',           // 开发环境 (本地 Go 服务)
        trial:   'https://staging-api.example.com/api/v1', // 体验版
        release: 'https://api.example.com/api/v1'          // 正式版
      }
      return urls[envVersion] || urls.develop
    })()
  }
})
