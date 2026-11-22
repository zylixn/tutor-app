// pages/tutor-list/tutor-list.js
const api = require('../../utils/api')
const tutorListBehavior = require('../../behaviors/tutor-list-behavior')

Page({
  behaviors: [tutorListBehavior],

  data: {
    // behavior 中已定义公共字段，页面特有字段在此定义
    pageSize: 10
  },

  onLoad() {
    this.loadTutors()
  },

  onPullDownRefresh() {
    this.resetAndLoad()
  },

  onReachBottom() {
    this.loadMore()
  },

  async loadTutors(append = true) {
    if (this.data.loading) return
    if (!append && !this.data.hasMore) return

    this.setData({ loading: true })

    try {
      const { keyword, filters, page, pageSize } = this.data
      const params = { page, pageSize, ...filters }
      if (keyword) {
        params.keyword = keyword
      }

      const result = await api.getTutors(params)
      const newTutors = result.data || []

      this.setData({
        tutors: append ? this.data.tutors.concat(newTutors) : newTutors,
        hasMore: newTutors.length >= pageSize,
        page: page + 1,
        loading: false
      })

      if (!append) {
        wx.stopPullDownRefresh()
      }
    } catch (err) {
      console.error('加载失败', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  resetAndLoad() {
    this.setData({
      tutors: [],
      page: 1,
      hasMore: true
    })
    this.loadTutors(false)
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading) return
    this.loadTutors(true)
  }
})
