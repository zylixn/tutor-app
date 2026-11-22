// pages/apply/apply.js - 教师入驻四步表单
const api = require('../../utils/api')

const EDU_OPTIONS = ['本科', '硕士', '博士']
const SUBJECT_OPTIONS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '全科']
const GRADE_OPTIONS = ['小学', '初中', '高中']

// WXML 表达式不支持方法调用，多选选中态用 {值: true} 映射维护
const toSelectedMap = (list) => (list || []).reduce((map, v) => { map[v] = true; return map }, {})

Page({
  data: {
    step: 1,
    submitting: false,
    previewSubjects: '',
    previewGrades: '',
    form: {
      name: '', gender: '', education: '', school: '', major: '',
      subjects: [], grades: [], hourlyRate: '', location: '', experience: '',
      bio: '', avatar: '', certImages: [], wechatId: ''
    },
    errors: {},
    subjectSelected: {},
    gradeSelected: {},
    eduOptions: EDU_OPTIONS,
    subjectOptions: SUBJECT_OPTIONS,
    gradeOptions: GRADE_OPTIONS
  },

  onLoad() { this.init() },

  async init() {
    try {
      await api.ensureLogin()
    } catch (e) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      wx.navigateBack()
      return
    }
    // 已有档案 → 带入内容（编辑/重提场景）；拉取失败不拦表单，按新申请继续
    try {
      const app = await api.getMyApplication()
      if (app.auditStatus && app.auditStatus !== 'none') {
        this.setData({
          form: {
            name: app.name || '', gender: app.gender || '', education: app.education || '',
            school: app.school || '', major: app.major || '',
            subjects: app.subjects || [], grades: app.grades || [],
            hourlyRate: app.hourlyRate ? String(app.hourlyRate) : '',
            location: app.location || '', experience: app.experience ? String(app.experience) : '',
            bio: app.bio || '', avatar: app.avatar || '',
            certImages: app.certImages || [], wechatId: app.wechatId || ''
          },
          subjectSelected: toSelectedMap(app.subjects),
          gradeSelected: toSelectedMap(app.grades)
        })
      }
    } catch (e) { /* 拉取旧档案失败: 保留空白表单 */ }
  },

  /* —— 通用输入 —— */
  onField(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value, [`errors.${field}`]: '' })
  },
  onPickGender(e) { this.setData({ 'form.gender': e.currentTarget.dataset.value, 'errors.gender': '' }) },
  onPickEdu(e) { this.setData({ 'form.education': e.currentTarget.dataset.value, 'errors.education': '' }) },
  toggleSubject(e) { this.toggleList('subjects', 'subjectSelected', e.currentTarget.dataset.value) },
  toggleGrade(e) { this.toggleList('grades', 'gradeSelected', e.currentTarget.dataset.value) },
  toggleList(field, selectedField, value) {
    const list = this.data.form[field]
    const selected = this.data[selectedField]
    let next
    if (selected[value]) {
      next = list.filter(v => v !== value)
      this.setData({ [`${selectedField}.${value}`]: false })
    } else {
      next = list.concat(value)
      this.setData({ [`${selectedField}.${value}`]: true })
    }
    this.setData({ [`form.${field}`]: next, [`errors.${field}`]: '' })
  },

  /* —— 上传 —— */
  async chooseCert() {
    try {
      const res = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
      const url = await api.uploadImage(res.tempFiles[0].tempFilePath)
      this.setData({
        'form.certImages': this.data.form.certImages.concat(url),
        'errors.certImages': ''
      })
    } catch (e) { /* 用户取消或上传失败（上传失败已有 toast） */ }
  },
  removeCert(e) {
    const idx = e.currentTarget.dataset.index
    const list = this.data.form.certImages
    this.setData({ 'form.certImages': list.filter((_, i) => i !== idx) })
  },
  async chooseAvatar() {
    try {
      const res = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
      const url = await api.uploadImage(res.tempFiles[0].tempFilePath)
      this.setData({ 'form.avatar': url })
    } catch (e) { /* 用户取消 */ }
  },
  clearAvatar() { this.setData({ 'form.avatar': '' }) },

  /* —— 步骤流转 —— */
  nextStep() {
    if (this.data.step >= 4) { return }
    // WXML 表达式不支持方法调用，预览文案进第 4 步前预计算
    if (this.data.step === 3) {
      this.setData({
        previewSubjects: this.data.form.subjects.join(' · '),
        previewGrades: this.data.form.grades.join(' · ')
      })
    }
    this.setData({ step: this.data.step + 1 })
  },
  prevStep() { if (this.data.step > 1) { this.setData({ step: this.data.step - 1 }) } },

  /* —— 提交 —— */
  async submit() {
    if (this.data.submitting) { return }
    this.setData({ submitting: true })
    const f = this.data.form
    try {
      await api.submitApplication({
        name: f.name, gender: f.gender, education: f.education, school: f.school,
        major: f.major, subjects: f.subjects, grades: f.grades,
        hourlyRate: parseInt(f.hourlyRate, 10) || 0, location: f.location,
        experience: parseInt(f.experience, 10) || 0, bio: f.bio,
        avatar: f.avatar, certImages: f.certImages, wechatId: f.wechatId
      })
      wx.showToast({ title: '已存入公报', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (err) {
      if (err && err.errors) {
        this.setData({ errors: err.errors })
        // 跳到第一个有错的步骤
        const stepOf = { name: 1, gender: 1, education: 1, school: 1, major: 1, subjects: 2, grades: 2, hourlyRate: 2, location: 2, experience: 2, bio: 3, certImages: 3, wechatId: 3 }
        let target = 4
        Object.keys(err.errors).forEach(k => { if (stepOf[k] < target) { target = stepOf[k] } })
        this.setData({ step: target })
      } else {
        const msg = (err && err.error) || '提交失败，请重试'
        wx.showToast({ title: msg, icon: 'none' })
      }
    } finally {
      this.setData({ submitting: false })
    }
  }
})
