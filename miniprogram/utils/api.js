// utils/api.js - Backend API wrappers

/**
 * HTTP request helper
 * 每次调用时获取 App 实例，避免模块顶层 getApp() 时序问题
 */
const request = (method, url, data = {}) => {
  const app = getApp()
  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBaseUrl + url,
      method,
      data,
      header: {
        'content-type': 'application/json',
        'Authorization': app.globalData.token ? 'Bearer ' + app.globalData.token : ''
      },
      success: (res) => {
        if (res.statusCode === 401) {
          const app = getApp()
          app.globalData.token = null
          wx.removeStorageSync('token')
          wx.removeStorageSync('userId')
          wx.removeStorageSync('role')
          wx.showToast({ title: '请先登录', icon: 'none' })
          reject(res.data)
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          reject(res.data)
        }
      },
      fail: (err) => {
        reject(err)
      }
    })
  })
}

/**
 * Get tutor list with filters
 */
const getTutors = async (params) => {
  const queryString = Object.keys(params)
    .filter(key => params[key] !== null && params[key] !== undefined)
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&')

  return await request('GET', `/tutors?${queryString}`)
}

/**
 * Get tutor detail
 */
const getTutorDetail = async (tutorId) => {
  return await request('GET', `/tutors/${tutorId}`)
}

/**
 * Submit review
 */
const submitReview = async (tutorId, rating, content, isAnonymous = false) => {
  return await request('POST', '/reviews', {
    tutorId,
    rating,
    content,
    isAnonymous
  })
}

/**
 * Create tutor (admin use)
 */
const createTutor = async (tutorData) => {
  return await request('POST', '/tutors', tutorData)
}

/**
 * Get tutor contact info (requires login)
 */
const getTutorContact = async (tutorId) => {
  return await request('GET', `/tutors/${tutorId}/contact`)
}

/**
 * 微信登录（wx.login → code → 后端换 JWT），并持久化
 */
const login = () => new Promise((resolve, reject) => {
  wx.login({
    success: (res) => {
      if (!res.code) { reject(new Error('wx.login 未返回 code')); return }
      request('POST', '/auth/login', { code: res.code }).then((data) => {
        const app = getApp()
        app.globalData.token = data.token
        app.globalData.userId = data.userId
        app.globalData.role = data.role
        wx.setStorageSync('token', data.token)
        wx.setStorageSync('userId', data.userId)
        wx.setStorageSync('role', data.role)
        resolve(data)
      }).catch(reject)
    },
    fail: reject
  })
})

/**
 * 确保已登录（storage 恢复 → 必要时静默登录）
 */
const ensureLogin = async () => {
  const app = getApp()
  if (!app.globalData.token) {
    app.globalData.token = wx.getStorageSync('token') || null
    app.globalData.role = wx.getStorageSync('role') || null
    app.globalData.userId = wx.getStorageSync('userId') || null
  }
  if (!app.globalData.token) {
    await login()
  }
  return app.globalData
}

/**
 * 上传图片（wx.uploadFile，独立于 request 的 multipart 流程）
 */
const uploadImage = (filePath) => new Promise((resolve, reject) => {
  const app = getApp()
  wx.uploadFile({
    url: app.globalData.apiBaseUrl + '/tutor-applications/images',
    filePath,
    name: 'image',
    header: {
      Authorization: app.globalData.token ? 'Bearer ' + app.globalData.token : ''
    },
    success: (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try { resolve(JSON.parse(res.data).url) }
        catch (e) { wx.showToast({ title: '上传失败', icon: 'none' }); reject(e) }
        return
      }
      let msg = '上传失败'
      try { msg = JSON.parse(res.data).error || msg } catch (e) {}
      wx.showToast({ title: msg, icon: 'none' })
      reject(res)
    },
    fail: (e) => { wx.showToast({ title: '上传失败，请重试', icon: 'none' }); reject(e) }
  })
})

/**
 * 提交入驻申请
 */
const submitApplication = (data) => request('POST', '/tutor-applications', data)

/**
 * 查询我的申请
 */
const getMyApplication = () => request('GET', '/tutor-applications/mine')

/**
 * 管理员: 待审列表 / 通过 / 驳回
 */
const listApplications = (status = 'pending', pageSize = 20) => request('GET', `/admin/tutor-applications?status=${status}&pageSize=${pageSize}`)
const approveApplication = (id) => request('POST', `/admin/tutor-applications/${id}/approve`)
const rejectApplication = (id, note) => request('POST', `/admin/tutor-applications/${id}/reject`, { note })

/**
 * 相对上传路径 → 绝对 URL（image 组件不支持以 / 开头的站内路径）
 */
const resolveUpload = (u) => /^https?:\/\//.test(u)
  ? u
  : getApp().globalData.apiBaseUrl.replace(/\/api\/v1$/, '') + u

module.exports = {
  getTutors,
  getTutorDetail,
  submitReview,
  createTutor,
  getTutorContact,
  login,
  ensureLogin,
  uploadImage,
  submitApplication,
  getMyApplication,
  listApplications,
  approveApplication,
  rejectApplication,
  resolveUpload
}
