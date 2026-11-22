const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    loggedIn: false,
    role: 'user',
    application: null,   // {auditStatus, auditNote, name, ...} 或 null
    applicationLoaded: false,
    loadFailed: false,
    pendingCount: 0
  },

  onLoad() {
    this.init()
  },

  onShow() {
    if (this.data.loggedIn) { this.refresh() }
  },

  async init() {
    try {
      const g = await api.ensureLogin()
      this.setData({ loggedIn: true, role: g.role || 'user', loading: false })
      this.refresh()
    } catch (e) {
      this.setData({ loading: false, loggedIn: false })
    }
  },

  async refresh() {
    try {
      const app = await api.getMyApplication()
      const application = app.auditStatus === 'none' ? null : app
      this.setData({ application, loadFailed: false, applicationLoaded: true })
      if (this.data.role === 'admin') { this.loadPendingCount() }
    } catch (e) {
      this.setData({ loadFailed: true, applicationLoaded: true })
    }
  },

  async loadPendingCount() {
    try {
      const res = await api.listApplications('pending')
      this.setData({ pendingCount: res.total })
    } catch (e) {
      this.setData({ pendingCount: null })
    }
  },

  retryLoad() { this.refresh() },

  onLogin() { this.init() },

  goApply() { wx.navigateTo({ url: '/pages/apply/apply' }) },
  goAdmin() { wx.navigateTo({ url: '/pages/admin-audit/admin-audit' }) },
  goMyProfile() {
    const app = this.data.application
    wx.navigateTo({ url: '/pages/tutor-detail/tutor-detail?id=' + app.id })
  }
})
