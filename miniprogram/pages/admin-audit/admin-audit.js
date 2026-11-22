const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    list: [],
    current: null,     // 正在查看的申请
    currentSubjects: '',
    currentGrades: '',
    rejectNote: '',
    acting: false
  },

  onLoad() { this.refresh() },

  async refresh() {
    try {
      const res = await api.listApplications('pending')
      const list = (res.data || []).map(x => ({
        ...x,
        subjectsText: (x.subjects || []).join('、')
      }))
      this.setData({ list, loading: false, current: null })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    const current = this.data.list.find(x => x.id === id)
    if (!current) { return }
    // WXML 表达式不支持方法调用，展示字符串在此预计算
    this.setData({
      current,
      rejectNote: '',
      currentSubjects: (current.subjects || []).join('、'),
      currentGrades: (current.grades || []).join('、')
    })
  },
  backToList() { this.setData({ current: null }) },

  onNote(e) { this.setData({ rejectNote: e.detail.value }) },

  async approve() {
    if (this.data.acting) { return }
    this.setData({ acting: true })
    try {
      await api.approveApplication(this.data.current.id)
      wx.showToast({ title: '已刊入名录', icon: 'success' })
      this.refresh()
    } catch (err) {
      wx.showToast({ title: (err && err.error) || '操作失败', icon: 'none' })
    } finally {
      this.setData({ acting: false })
    }
  },

  async reject() {
    if (this.data.acting) { return }
    if (!this.data.rejectNote.trim()) {
      wx.showToast({ title: '请填写驳回原因', icon: 'none' })
      return
    }
    this.setData({ acting: true })
    try {
      await api.rejectApplication(this.data.current.id, this.data.rejectNote.trim())
      wx.showToast({ title: '已驳回', icon: 'none' })
      this.refresh()
    } catch (err) {
      wx.showToast({ title: (err && err.error) || '操作失败', icon: 'none' })
    } finally {
      this.setData({ acting: false })
    }
  }
})
