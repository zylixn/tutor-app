# Implementation Plan: WeChat Mini-Program for Tutor Matching Platform (MVP)

Generated from design doc: wangwenhui-unknown-design-20260618-223642.md
Date: 2026-06-18
Status: DRAFT
Mode: MVP (Minimum Trust Platform)

---

## Overview

Build a WeChat mini-program that provides a curated tutor directory with manual vetting, discovery features, and WeChat contact. This MVP tests the core hypothesis: "Will parents trust tutors discovered through your platform if the platform provides vetting + discovery?"

**Target:** 48-hour build with one engineer
**Tech stack:** WeChat mini-program (WXML/WXSS/JS) + CloudBase backend (no custom server)
**Scope:** Tutor profiles, search/filter, contact via WeChat, manual vetting badge, reviews

---

## Phase 1: Project Setup & Infrastructure (4 hours)

### 1.1 WeChat Mini-Program Project Initialization
- [ ] Create new WeChat mini-program project in微信开发者工具
- [ ] Configure project settings (app.json):
  - AppID (use test AppID for development)
  - Window settings (navigationBarTitleText, backgroundColor, etc.)
  - Tab bar configuration (if needed)
- [ ] Set up project structure:
  ```
  /pages
    /index         # Home/search page
    /tutor-detail  # Tutor profile detail
    /tutor-list    # Search results list
    /my            # User profile (optional for MVP)
  /components
    /tutor-card    # Reusable tutor profile card
    /search-bar    # Search/filter component
    /filter-panel  # Filter panel component
  /utils
    /api.js        # CloudBase API wrappers
    /auth.js       # WeChat auth utilities
    /util.js       # General utilities
  /cloud-functions # CloudBase cloud functions
    /getTutors     # Fetch tutor list
    /getTutorDetail# Fetch single tutor
    /submitReview  # Submit review
  app.js
  app.json
  app.wxss
  ```

### 1.2 CloudBase Backend Setup
- [ ] Create CloudBase environment in WeChat Cloud Console
- [ ] Initialize CloudBase in mini-program:
  ```javascript
  // app.js
  App({
    onLaunch: function() {
      if (!wx.cloud) {
        console.error('请使用 2.2.3 或以上的基础库以使用云能力')
        return
      }
      wx.cloud.init({
        env: 'your-env-id', // CloudBase environment ID
        traceUser: true,
      })
    }
  })
  ```
- [ ] Create database collections:
  - `tutors` - Tutor profiles
  - `reviews` - User reviews
  - `users` - User data (optional for MVP)
- [ ] Set database security rules (read: true, write: auth != null for reviews)
- [ ] Verify CloudBase free tier limits:
  - Database: 2GB storage, 50,000 reads/day, 30,000 writes/day
  - Cloud functions: 40,000 invocations/day
  - Storage: 5GB
  - Concurrent connections: 500

### 1.3 Development Environment
- [ ] Install dependencies (if any)
- [ ] Configure ESLint/Prettier for code quality
- [ ] Set up version control (git init, .gitignore)
- [ ] Create development branch

---

## Phase 2: Data Model & Cloud Functions (6 hours)

### 2.1 Database Schema Design

**Collection: `tutors`**
```javascript
{
  _id: String,              // Auto-generated
  name: String,             // 家教姓名
  avatar: String,           // 头像URL
  gender: String,           // 性别: '男' | '女'
  education: String,        // 学历: '本科' | '硕士' | '博士'
  school: String,           // 学校
  major: String,            // 专业
  subjects: Array<String>,  // 教授科目: ['数学', '英语', '物理']
  grades: Array<String>,    // 教授年级: ['小学', '初中', '高中']
  hourlyRate: Number,       // 时薪 (元)
  location: String,         // 授课地点
  experience: String,       // 教学经验描述
  credentials: Array<{      // 资质证明
    type: String,           // '学生证' | '教师资格证' | '其他'
    verified: Boolean,      // 是否已验证
    imageUrl: String        // 证明图片URL
  }>,
  references: Array<{       // 推荐人信息
    name: String,
    relationship: String,
    contact: String,
    verified: Boolean
  }>,
  verified: Boolean,        // 平台认证状态
  verifiedAt: Date,         // 认证时间
  rating: Number,           // 平均评分 (1-5)
  reviewCount: Number,      // 评论数量
  availability: String,     // 可授课时间描述
  bio: String,              // 个人简介
  wechatId: String,         // 微信号 (用于联系)
  createdAt: Date,
  updatedAt: Date,
  status: String            // 'active' | 'inactive' | 'pending'
}
```

**Collection: `reviews`**
```javascript
{
  _id: String,
  tutorId: String,          // 关联的tutor _id
  userId: String,           // 评论用户ID (可选匿名)
  rating: Number,           // 评分 1-5
  content: String,          // 评论内容
  createdAt: Date,
  status: String            // 'active' | 'hidden'
}
```

### 2.2 Cloud Functions

**Function: `getTutors`** - Fetch tutor list with filters
```javascript
// cloud-functions/getTutors/index.js
const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event, context) => {
  const db = cloud.database()
  const { subject, grade, location, minPrice, maxPrice, page = 1, pageSize = 20 } = event

  let query = db.collection('tutors').where({
    status: 'active',
    verified: true
  })

  // Apply filters
  if (subject) query = query.where({ subjects: subject })
  if (grade) query = query.where({ grades: grade })
  if (location) query = query.where({ location: db.RegExp({ regexp: location, options: 'i' }) })
  if (minPrice !== undefined) query = query.where({ hourlyRate: db.command.gte(minPrice) })
  if (maxPrice !== undefined) query = query.where({ hourlyRate: db.command.lte(maxPrice) })

  // Pagination
  const skip = (page - 1) * pageSize
  const result = await query
    .orderBy('rating', 'desc')
    .orderBy('reviewCount', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  return {
    data: result.data,
    page,
    pageSize,
    hasMore: result.data.length === pageSize
  }
}
```

**Function: `getTutorDetail`** - Fetch single tutor with reviews
```javascript
// cloud-functions/getTutorDetail/index.js
const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event, context) => {
  const db = cloud.database()
  const { tutorId } = event

  // Get tutor details
  const tutor = await db.collection('tutors').doc(tutorId).get()

  // Get recent reviews
  const reviews = await db.collection('reviews')
    .where({
      tutorId: tutorId,
      status: 'active'
    })
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get()

  return {
    tutor: tutor.data,
    reviews: reviews.data
  }
}
```

**Function: `submitReview`** - Submit a review
```javascript
// cloud-functions/submitReview/index.js
const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event, context) => {
  const db = cloud.database()
  const { tutorId, rating, content } = event
  const { OPENID } = cloud.getWXContext()

  // Create review
  const review = await db.collection('reviews').add({
    data: {
      tutorId,
      userId: OPENID,
      rating,
      content,
      createdAt: new Date(),
      status: 'active'
    }
  })

  // Update tutor rating (simplified - should use aggregation)
  const allReviews = await db.collection('reviews')
    .where({ tutorId, status: 'active' })
    .get()

  const avgRating = allReviews.data.reduce((sum, r) => sum + r.rating, 0) / allReviews.data.length

  await db.collection('tutors').doc(tutorId).update({
    data: {
      rating: avgRating,
      reviewCount: allReviews.data.length,
      updatedAt: new Date()
    }
  })

  return { success: true, reviewId: review._id }
}
```

### 2.3 API Wrapper Functions
```javascript
// utils/api.js
const cloud = require('wx-server-sdk')

// Get tutor list
export const getTutors = async (params) => {
  return await cloud.callFunction({
    name: 'getTutors',
    data: params
  })
}

// Get tutor detail
export const getTutorDetail = async (tutorId) => {
  return await cloud.callFunction({
    name: 'getTutorDetail',
    data: { tutorId }
  })
}

// Submit review
export const submitReview = async (tutorId, rating, content) => {
  return await cloud.callFunction({
    name: 'submitReview',
    data: { tutorId, rating, content }
  })
}
```

---

## Phase 3: UI Components (8 hours)

### 3.1 Search Bar Component
```xml
<!-- components/search-bar/search-bar.wxml -->
<view class="search-bar">
  <view class="search-input">
    <icon type="search" size="16"/>
    <input
      placeholder="搜索科目、年级、地点..."
      value="{{keyword}}"
      bindinput="onInput"
      bindconfirm="onSearch"
    />
  </view>
  <view class="filter-btn" bindtap="onToggleFilter">
    <icon type="info" size="16"/>
    <text>筛选</text>
  </view>
</view>
```

### 3.2 Filter Panel Component
```xml
<!-- components/filter-panel/filter-panel.wxml -->
<view class="filter-panel {{visible ? 'visible' : ''}}">
  <view class="filter-section">
    <text class="filter-label">科目</text>
    <view class="filter-options">
      <view
        wx:for="{{subjects}}"
        class="option {{selectedSubject === item ? 'selected' : ''}}"
        bindtap="onSelectSubject"
        data-value="{{item}}"
      >{{item}}</view>
    </view>
  </view>

  <view class="filter-section">
    <text class="filter-label">年级</text>
    <view class="filter-options">
      <view
        wx:for="{{grades}}"
        class="option {{selectedGrade === item ? 'selected' : ''}}"
        bindtap="onSelectGrade"
        data-value="{{item}}"
      >{{item}}</view>
    </view>
  </view>

  <view class="filter-section">
    <text class="filter-label">时薪范围</text>
    <view class="price-range">
      <input type="number" placeholder="最低" value="{{minPrice}}" bindinput="onMinPrice"/>
      <text>-</text>
      <input type="number" placeholder="最高" value="{{maxPrice}}" bindinput="onMaxPrice"/>
      <text>元/小时</text>
    </view>
  </view>

  <view class="filter-actions">
    <button bindtap="onReset">重置</button>
    <button type="primary" bindtap="onApply">应用</button>
  </view>
</view>
```

### 3.3 Tutor Card Component
```xml
<!-- components/tutor-card/tutor-card.wxml -->
<view class="tutor-card" bindtap="onTap">
  <view class="tutor-header">
    <image class="avatar" src="{{tutor.avatar}}" mode="aspectFill"/>
    <view class="tutor-info">
      <view class="name-row">
        <text class="name">{{tutor.name}}</text>
        <view wx:if="{{tutor.verified}}" class="verified-badge">
          <icon type="success" size="12"/>
          <text>平台认证</text>
        </view>
      </view>
      <view class="education">{{tutor.education}} · {{tutor.school}}</view>
      <view class="subjects">
        <text wx:for="{{tutor.subjects}}" class="subject-tag">{{item}}</text>
      </view>
    </view>
  </view>

  <view class="tutor-stats">
    <view class="stat">
      <text class="label">评分</text>
      <text class="value">{{tutor.rating || '暂无'}}</text>
    </view>
    <view class="stat">
      <text class="label">时薪</text>
      <text class="value">{{tutor.hourlyRate}}元/时</text>
    </view>
    <view class="stat">
      <text class="label">经验</text>
      <text class="value">{{tutor.experience}}</text>
    </view>
  </view>

  <view class="tutor-footer">
    <text class="location">{{tutor.location}}</text>
  </view>
</view>
```

### 3.4 Pages

**Home/Search Page (pages/index/index)**
- Search bar at top
- Filter panel (collapsible)
- Tutor cards grid/list
- Load more on scroll
- Empty state when no results

**Tutor Detail Page (pages/tutor-detail/tutor-detail)**
- Full tutor profile
- Credentials display (with verified badges)
- References section
- Reviews section
- "联系家教" button (opens WeChat contact or shows WeChat ID)
- "写评论" button

---

## Phase 4: Core Features Implementation (12 hours)

### 4.1 Search & Filter Logic
```javascript
// pages/index/index.js
Page({
  data: {
    tutors: [],
    loading: false,
    page: 1,
    hasMore: true,
    filters: {
      subject: null,
      grade: null,
      location: null,
      minPrice: null,
      maxPrice: null
    }
  },

  onLoad() {
    this.loadTutors()
  },

  async loadTutors() {
    if (this.data.loading || !this.data.hasMore) return

    this.setData({ loading: true })

    try {
      const result = await getTutors({
        ...this.data.filters,
        page: this.data.page
      })

      this.setData({
        tutors: this.data.tutors.concat(result.data),
        page: this.data.page + 1,
        hasMore: result.hasMore,
        loading: false
      })
    } catch (err) {
      console.error('加载失败', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onReachBottom() {
    this.loadTutors()
  },

  onFilterChange(e) {
    this.setData({
      filters: e.detail,
      tutors: [],
      page: 1,
      hasMore: true
    })
    this.loadTutors()
  }
})
```

### 4.2 Tutor Detail View
```javascript
// pages/tutor-detail/tutor-detail.js
Page({
  data: {
    tutor: null,
    reviews: [],
    loading: true
  },

  onLoad(options) {
    this.loadTutorDetail(options.id)
  },

  async loadTutorDetail(tutorId) {
    try {
      const result = await getTutorDetail(tutorId)
      this.setData({
        tutor: result.tutor,
        reviews: result.reviews,
        loading: false
      })
    } catch (err) {
      console.error('加载失败', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onContact() {
    const { tutor } = this.data

    // Option 1: Copy WeChat ID to clipboard
    wx.setClipboardData({
      data: tutor.wechatId,
      success: () => {
        wx.showToast({ title: '微信号已复制', icon: 'success' })
      }
    })

    // Option 2: Show contact modal
    wx.showModal({
      title: '联系家教',
      content: `微信号: ${tutor.wechatId}\n请在微信中搜索添加`,
      confirmText: '复制微信号',
      success: (res) => {
        if (res.confirm) {
          wx.setClipboardData({ data: tutor.wechatId })
        }
      }
    })
  },

  onWriteReview() {
    // Navigate to review page or show review modal
    wx.navigateTo({
      url: `/pages/write-review/write-review?tutorId=${this.data.tutor._id}`
    })
  }
})
```

### 4.3 Review Submission
```javascript
// pages/write-review/write-review.js
Page({
  data: {
    tutorId: null,
    rating: 5,
    content: ''
  },

  onLoad(options) {
    this.setData({ tutorId: options.tutorId })
  },

  onRatingChange(e) {
    this.setData({ rating: e.detail.value })
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  async onSubmit() {
    if (!this.data.content.trim()) {
      wx.showToast({ title: '请填写评论内容', icon: 'none' })
      return
    }

    try {
      await submitReview(this.data.tutorId, this.data.rating, this.data.content)
      wx.showToast({ title: '评论成功', icon: 'success' })
      wx.navigateBack()
    } catch (err) {
      console.error('评论失败', err)
      wx.showToast({ title: '评论失败', icon: 'none' })
    }
  }
})
```

---

## Phase 5: Manual Vetting Process (8 hours)

### 5.1 Vetting Checklist
Create a vetting checklist document for manual review:

**Vetting Criteria:**
1. ✅ Verified student ID (for university students) OR teaching certificate (for professionals)
2. ✅ At least 1 reference from previous tutoring experience
3. ✅ Phone or video interview completed
4. ✅ No red flags in background check
5. ✅ Agreement to platform terms

### 5.2 Vetting Workflow
1. Tutor submits profile via mini-program (or manual entry)
2. Admin reviews submitted credentials
3. Admin conducts phone/video interview
4. Admin verifies references (call/message)
5. Admin marks tutor as `verified: true` in database
6. Tutor profile becomes visible to parents

### 5.3 Admin Tools (Simple)
- Use CloudBase console to manually update tutor records
- Set `verified: true` and `verifiedAt: new Date()`
- Optional: Create simple admin page in mini-program (password protected)

---

## Phase 6: Testing & Polish (6 hours)

### 6.1 Functional Testing
- [ ] Search returns correct results
- [ ] Filters work correctly (subject, grade, price, location)
- [ ] Tutor detail page loads correctly
- [ ] Contact button copies WeChat ID
- [ ] Review submission works
- [ ] Rating updates correctly after review
- [ ] Pagination works (load more)
- [ ] Empty states display correctly

### 6.2 Edge Cases
- [ ] No tutors found (empty state)
- [ ] Network error handling
- [ ] Invalid tutor ID
- [ ] Duplicate review prevention
- [ ] Long text handling (bio, reviews)
- [ ] Missing data handling (no avatar, no reviews)
- [ ] Price range validation

### 6.3 Performance Testing
- [ ] Initial load time < 2 seconds
- [ ] Search response < 1 second
- [ ] Image loading optimization
- [ ] Cloud function cold start handling

### 6.4 UI/UX Polish
- [ ] Loading states (skeleton screens)
- [ ] Error messages (user-friendly)
- [ ] Success feedback (toasts)
- [ ] Smooth animations
- [ ] Responsive layout (different screen sizes)
- [ ] Accessibility (color contrast, touch targets)

---

## Phase 7: Deployment & Launch (4 hours)

### 7.1 Pre-Launch Checklist
- [ ] All tests passing
- [ ] CloudBase limits verified
- [ ] 10-20 vetted tutors ready
- [ ] Sample reviews added (optional)
- [ ] Terms of service and privacy policy (basic)
- [ ] Error monitoring configured

### 7.2 Deployment
- [ ] Upload code to WeChat mini-program platform
- [ ] Set production CloudBase environment
- [ ] Submit for review (WeChat mini-program审核)
- [ ] Wait for approval (typically 1-3 days)
- [ ] Publish to production

### 7.3 Launch Activities
- [ ] Share QR code in WeChat groups
- [ ] Announce to recruited tutors
- [ ] Monitor usage analytics
- [ ] Collect user feedback

---

## Success Metrics (2-week validation)

**Quantitative:**
- 10-20 manually vetted tutors with complete profiles ✅
- 10-20 parents browse and send contact requests
- At least 3 parents successfully connect with tutors via WeChat
- At least 1 parent hires a tutor discovered through the platform

**Qualitative:**
- Parents return to browse more tutors (repeat behavior)
- Tutors report receiving inquiries from parents they couldn't reach before
- No complaints about trust or safety issues

**Failure signals to watch:**
- Parents browse but never contact
- Parents contact but never hire
- Tutors join but receive no inquiries
- Parents express distrust of platform-vetted tutors

---

## What We're NOT Building (Deferred)

**Explicitly out of scope for MVP:**
- ❌ Payment processing/escrow
- ❌ Booking/scheduling system
- ❌ Video lessons
- ❌ AI matching algorithm
- ❌ Admin dashboard (use CloudBase console)
- ❌ Push notifications
- ❌ Chat system (use WeChat contact)
- ❌ Tutor application form (manual entry for now)
- ❌ User accounts/authentication (optional)
- ❌ Favorites/bookmarks
- ❌ Map/location view
- ❌ Social sharing
- ❌ Rating distribution charts

---

## Technical Debt & Future Work

**Known limitations:**
1. No authentication - anyone can submit reviews
2. Manual vetting doesn't scale - need application form
3. No tutor-side interface - admin manages everything
4. Rating calculation is simplified - should use proper aggregation
5. No caching - every search hits database
6. No error tracking/monitoring

**Future enhancements (if MVP succeeds):**
- Tutor application and self-service profile management
- Parent accounts and booking history
- In-app messaging
- Payment integration (if trust hypothesis validated)
- Advanced search (distance, availability, education level)
- Recommendation engine
- Admin dashboard
- Analytics and reporting

---

## Dependencies & Blockers

**Required before start:**
- [ ] WeChat mini-program AppID (can use test ID for development)
- [ ] CloudBase account setup
- [ ] 10-20 tutors identified for initial vetting
- [ ] Vetting process defined

**Potential blockers:**
- WeChat mini-program审核 (review process can take 1-3 days)
- CloudBase free tier limits (upgrade if needed)
- Tutor recruitment challenges
- User acquisition challenges

---

## Estimated Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| 1. Setup & Infrastructure | 4 hours | 4 hours |
| 2. Data Model & Cloud Functions | 6 hours | 10 hours |
| 3. UI Components | 8 hours | 18 hours |
| 4. Core Features | 12 hours | 30 hours |
| 5. Manual Vetting | 8 hours | 38 hours |
| 6. Testing & Polish | 6 hours | 44 hours |
| 7. Deployment & Launch | 4 hours | 48 hours |

**Total: 48 hours** (with one engineer)

---

## Notes

This plan implements the **Minimum Trust Platform** approach from the approved design document. It deliberately excludes payment processing, booking, and other complex features to test the core hypothesis: "Will parents trust tutors discovered through your platform if the platform provides vetting + discovery?"

If the hypothesis is validated (parents use the platform and hire tutors), future iterations can add:
- Payment and escrow
- Booking system
- In-app messaging
- Advanced features

If the hypothesis fails (parents don't trust platform-vetted tutors), the pivot is cheap — only 48 hours invested, and we learned something valuable about the market.
