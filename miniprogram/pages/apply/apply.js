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
    // 展示用绝对化副本（form 内保持相对路径提交，后端校验 /uploads/ 前缀）
    certDisplays: [],
    avatarDisplay: '',
    uploadingCert: false,
    uploadingAvatar: false,
    eduOptions: EDU_OPTIONS,
    subjectOptions: SUBJECT_OPTIONS,
    gradeOptions: GRADE_OPTIONS
  },

  onLoad() {
    this._dirty = false    // 用户已开始输入则 init 回填不覆盖
    this._unloaded = false // 延迟 navigateBack 前页面已被卸载则不弹栈
    this.init()
  },

  onUnload() { this._unloaded = true },

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
      if (this._dirty) { return } // 用户已开始输入，不覆盖
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
        this.syncDisplays()
      }
    } catch (e) { /* 拉取旧档案失败: 保留空白表单 */ }
  },

  /* —— 通用输入 —— */
  onField(e) {
    this._dirty = true
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value, [`errors.${field}`]: '' })
  },
  onPickGender(e) { this._dirty = true; this.setData({ 'form.gender': e.currentTarget.dataset.value, 'errors.gender': '' }) },
  onPickEdu(e) { this._dirty = true; this.setData({ 'form.education': e.currentTarget.dataset.value, 'errors.education': '' }) },
  toggleSubject(e) { this.toggleList('subjects', 'subjectSelected', e.currentTarget.dataset.value) },
  toggleGrade(e) { this.toggleList('grades', 'gradeSelected', e.currentTarget.dataset.value) },
  toggleList(field, selectedField, value) {
    this._dirty = true
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

  /* —— 上传（showLoading 在 chooseMedia 之后，取消不误显 loading；失败 toast 由 api 层顶掉 loading）—— */
  // WXML image 不支持以 / 开头的站内路径，展示统一走绝对化副本，form 数据流不动
  syncDisplays() {
    this.setData({
      certDisplays: this.data.form.certImages.map(api.resolveUpload),
      avatarDisplay: this.data.form.avatar ? api.resolveUpload(this.data.form.avatar) : ''
    })
  },
  async chooseCert() {
    if (this.data.uploadingCert) { return }
    this.setData({ uploadingCert: true })
    try {
      const res = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
      wx.showLoading({ title: '上传中' })
      const url = await api.uploadImage(res.tempFiles[0].tempFilePath)
      wx.hideLoading()
      this._dirty = true
      this.setData({
        'form.certImages': this.data.form.certImages.concat(url),
        'errors.certImages': ''
      })
      this.syncDisplays()
    } catch (e) { /* 用户取消或上传失败（失败 toast 由 api 层负责） */ } finally {
      this.setData({ uploadingCert: false })
    }
  },
  removeCert(e) {
    this._dirty = true
    const idx = e.currentTarget.dataset.index
    const list = this.data.form.certImages
    this.setData({ 'form.certImages': list.filter((_, i) => i !== idx) })
    this.syncDisplays()
  },
  async chooseAvatar() {
    if (this.data.uploadingAvatar) { return }
    this.setData({ uploadingAvatar: true })
    try {
      const res = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
      wx.showLoading({ title: '上传中' })
      const url = await api.uploadImage(res.tempFiles[0].tempFilePath)
      wx.hideLoading()
      this._dirty = true
      this.setData({ 'form.avatar': url })
      this.syncDisplays()
    } catch (e) { /* 用户取消或上传失败 */ } finally {
      this.setData({ uploadingAvatar: false })
    }
  },
  clearAvatar() { this._dirty = true; this.setData({ 'form.avatar': '' }); this.syncDisplays() },

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
      // 成功后保持 submitting=true 直到离开页面，封死 800ms 窗口内的双击重提
      wx.showToast({ title: '已存入公报', icon: 'success' })
      setTimeout(() => {
        if (!this._unloaded) { wx.navigateBack() }
      }, 800)
    } catch (err) {
      this.setData({ submitting: false })
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
    }
  }
})
