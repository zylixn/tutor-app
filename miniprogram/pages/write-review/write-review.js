const api = require('../../utils/api')

Page({
  data: {
    tutorId: null,
    tutor: null,
    rating: 0,
    content: '',
    isAnonymous: false,
    ratingText: '点击星星评分',
    canSubmit: false,
    ratingTexts: {
      1: '非常差',
      2: '较差',
      3: '一般',
      4: '较好',
      5: '非常好'
    }
  },

  onLoad(options) {
    if (!options || !options.tutorId) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    this.setData({ tutorId: options.tutorId })
    this.loadTutorInfo(options.tutorId)
  },

  async loadTutorInfo(tutorId) {
    try {
      const result = await api.getTutorDetail(tutorId)
      this.setData({ tutor: result.tutor })
    } catch (err) {
      console.error('加载家教信息失败', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  _updateComputed() {
    var rating = this.data.rating
    var content = this.data.content
    this.setData({
      ratingText: this.data.ratingTexts[rating] || '点击星星评分',
      canSubmit: rating > 0 && content.trim().length >= 10
    })
  },

  onStarTap(e) {
    this.setData({ rating: e.currentTarget.dataset.rating })
    this._updateComputed()
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
    this._updateComputed()
  },

  toggleAnonymous() {
    this.setData({ isAnonymous: !this.data.isAnonymous })
  },

  async onSubmit() {
    const { rating, content, tutorId, isAnonymous } = this.data

    if (rating === 0) {
      wx.showToast({ title: '请选择评分', icon: 'none' })
      return
    }

    if (content.trim().length < 10) {
      wx.showToast({ title: '评论内容至少10个字', icon: 'none' })
      return
    }

    wx.showLoading({ title: '提交中...' })

    try {
      await api.submitReview(tutorId, rating, content.trim(), isAnonymous)
      wx.hideLoading()

      wx.showModal({
        title: '提交成功',
        content: '感谢您的评价！',
        showCancel: false,
        success: () => {
          wx.navigateBack()
        }
      })
    } catch (err) {
      wx.hideLoading()
      console.error('提交评论失败', err)
      wx.showToast({ title: err.message || '提交失败', icon: 'none' })
    }
  }
})
