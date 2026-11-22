// behaviors/tutor-list-behavior.js
// 首页和家教列表页的公共逻辑

module.exports = Behavior({
  data: {
    tutors: [],
    loading: false,
    page: 1,
    hasMore: true,
    keyword: '',
    showFilter: false,
    filters: {
      subject: null,
      grade: null,
      minPrice: null,
      maxPrice: null
    },
    hasActiveFilters: false
  },

  methods: {
    _updateHasActiveFilters(filters) {
      var has = !!(filters.subject || filters.grade || filters.minPrice || filters.maxPrice)
      this.setData({ hasActiveFilters: has })
    },

    onToggleFilter() {
      this.setData({ showFilter: !this.data.showFilter })
    },

    onFilterChange(e) {
      var filters = e.detail
      this.setData({
        filters: filters,
        showFilter: false
      })
      this._updateHasActiveFilters(filters)
      this.resetAndLoad()
    },

    removeSubjectFilter() {
      var filters = Object.assign({}, this.data.filters, { subject: null })
      this.setData({ filters: filters })
      this._updateHasActiveFilters(filters)
      this.resetAndLoad()
    },

    removeGradeFilter() {
      var filters = Object.assign({}, this.data.filters, { grade: null })
      this.setData({ filters: filters })
      this._updateHasActiveFilters(filters)
      this.resetAndLoad()
    },

    removePriceFilter() {
      var filters = Object.assign({}, this.data.filters, { minPrice: null, maxPrice: null })
      this.setData({ filters: filters })
      this._updateHasActiveFilters(filters)
      this.resetAndLoad()
    },

    clearAllFilters() {
      var filters = {
        subject: null,
        grade: null,
        minPrice: null,
        maxPrice: null
      }
      this.setData({
        filters: filters,
        keyword: '',
        showFilter: false,
        hasActiveFilters: false
      })
      this.resetAndLoad()
    },

    onSearchInput(e) {
      this.setData({ keyword: e.detail.value })
      clearTimeout(this._searchTimer)
      this._searchTimer = setTimeout(() => {
        this.resetAndLoad()
      }, 400)
    },

    onSearch() {
      this.resetAndLoad()
    },

    onTutorTap(e) {
      var tutorId = e.currentTarget.dataset.id
      wx.navigateTo({
        url: '/pages/tutor-detail/tutor-detail?id=' + tutorId
      })
    }
  }
})
