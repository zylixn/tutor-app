Component({
  properties: {
    tutor: {
      type: Object,
      value: {}
    },
    featured: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    onTap() {
      var id = this.data.tutor.id
      if (!id) return
      wx.navigateTo({
        url: '/pages/tutor-detail/tutor-detail?id=' + id
      })
    }
  }
})
