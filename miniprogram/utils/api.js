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

module.exports = {
  getTutors,
  getTutorDetail,
  submitReview,
  createTutor,
  getTutorContact
}
