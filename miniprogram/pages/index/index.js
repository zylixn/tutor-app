// pages/index/index.js
const api = require('../../utils/api')
const tutorListBehavior = require('../../behaviors/tutor-list-behavior')

Page({
  behaviors: [tutorListBehavior],

  data: {
    // behavior 中已定义 tutors/loading/page/hasMore/keyword/filters 等
  },

  onLoad() {
    this.loadTutors()
  },

  async loadTutors() {
    if (this.data.loading || !this.data.hasMore) return

    this.setData({ loading: true })

    try {
      const params = {
        ...this.data.filters,
        page: this.data.page
      }
      if (this.data.keyword) {
        params.keyword = this.data.keyword
      }

      const result = await api.getTutors(params)
      this.setData({
        tutors: this.data.tutors.concat(result.result.data),
        page: this.data.page + 1,
        hasMore: result.result.hasMore,
        loading: false
      })
    } catch (err) {
      console.error('加载失败', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onReachBottom() {
    this.loadTutors()
  },

  resetAndLoad() {
    this.setData({
      tutors: [],
      page: 1,
      hasMore: true
    })
    this.loadTutors()
  }
})
