// pages/tutor-detail/tutor-detail.js
const api = require('../../utils/api')

Page({
  data: {
    tutor: null,
    reviews: [],
    loading: true
  },

  onLoad(options) {
    if (!options || !options.id) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    this.loadTutorDetail(options.id)
  },

  async loadTutorDetail(tutorId) {
    try {
      const result = await api.getTutorDetail(tutorId)
      this.setData({
        tutor: result.result.tutor,
        reviews: result.result.reviews,
        loading: false
      })
    } catch (err) {
      console.error('加载失败', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async onContact() {
    const app = getApp()
    if (!app.globalData.token) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    try {
      const result = await api.getTutorContact(this.data.tutor.id)
      if (!result.wechatId) {
        wx.showToast({ title: result.message || '该家教尚未认证', icon: 'none' })
        return
      }
      wx.showModal({
        title: '联系家教',
        content: '点击确认复制微信号，请在微信中搜索添加',
        confirmText: '复制微信号',
        success: (res) => {
          if (res.confirm) {
            wx.setClipboardData({
              data: result.wechatId,
              success: () => {
                wx.showToast({ title: '微信号已复制', icon: 'success' })
              }
            })
          }
        }
      })
    } catch (err) {
      if (err.statusCode === 401) {
        wx.showToast({ title: '请先登录', icon: 'none' })
      } else {
        wx.showToast({ title: '获取联系方式失败', icon: 'none' })
      }
    }
  },

  onWriteReview() {
    wx.navigateTo({
      url: `/pages/write-review/write-review?tutorId=${this.data.tutor.id}`
    })
  },

  onShareAppMessage() {
    const { tutor } = this.data
    return {
      title: `${tutor.name} - 家教推荐`,
      path: `/pages/tutor-detail/tutor-detail?id=${tutor.id}`
    }
  },

  onAvatarError() {
    this.setData({ 'tutor.avatar': '/images/default-avatar.png' })
  }
})
