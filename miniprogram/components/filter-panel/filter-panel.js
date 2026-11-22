Component({
  properties: {
    initialFilters: {
      type: Object,
      value: {
        subject: null,
        grade: null,
        minPrice: null,
        maxPrice: null
      }
    },
    // 科目列表（由父组件传入，支持动态配置）
    subjects: {
      type: Array,
      value: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '全科', '音乐', '美术', '书法', '编程', '体育', '舞蹈', '围棋']
    },
    // 年级列表（由父组件传入）
    grades: {
      type: Array,
      value: ['小学', '初中', '高中']
    }
  },

  data: {
    selectedSubject: null,
    selectedGrade: null,
    minPrice: null,
    maxPrice: null
  },

  lifetimes: {
    attached() {
      var filters = this.data.initialFilters
      if (filters) {
        this.setData({
          selectedSubject: filters.subject || null,
          selectedGrade: filters.grade || null,
          minPrice: filters.minPrice || null,
          maxPrice: filters.maxPrice || null
        })
      }
    }
  },

  methods: {
    onSubjectSelect(e) {
      var subject = e.currentTarget.dataset.subject
      this.setData({
        selectedSubject: this.data.selectedSubject === subject ? null : subject
      })
    },

    onGradeSelect(e) {
      var grade = e.currentTarget.dataset.grade
      this.setData({
        selectedGrade: this.data.selectedGrade === grade ? null : grade
      })
    },

    onMinPriceInput(e) {
      var value = e.detail.value
      this.setData({
        minPrice: value ? parseInt(value) : null
      })
    },

    onMaxPriceInput(e) {
      var value = e.detail.value
      this.setData({
        maxPrice: value ? parseInt(value) : null
      })
    },

    onReset() {
      this.setData({
        selectedSubject: null,
        selectedGrade: null,
        minPrice: null,
        maxPrice: null
      })
    },

    onApply() {
      var selectedSubject = this.data.selectedSubject
      var selectedGrade = this.data.selectedGrade
      var minPrice = this.data.minPrice
      var maxPrice = this.data.maxPrice

      if (minPrice && maxPrice && minPrice && minPrice > maxPrice) {
        wx.showToast({ title: '最低价不能大于最高价', icon: 'none' })
        return
      }

      this.triggerEvent('filterchange', {
        subject: selectedSubject,
        grade: selectedGrade,
        minPrice: minPrice,
        maxPrice: maxPrice
      })
    }
  }
})
