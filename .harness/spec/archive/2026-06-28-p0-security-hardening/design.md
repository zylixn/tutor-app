# P0 安全加固 — Design

## 架构决策记录

### ADR-100: 微信 session_key 不持久化
- **决策**: 仅用 openid 做鉴权，丢弃 session_key
- **理由**: YAGNI 原则。当前仅需鉴权，手机号获取等需求明确时再扩展
- **后果**: 后续微信敏感接口需重新登录获取 session_key

### ADR-101: 评论允许修改
- **决策**: 同一用户对同一家教仅一条评论，允许修改（ON CONFLICT UPDATE 语义）
- **理由**: 用户修改评论是常见需求，`INSERT OR REPLACE` / `UPDATE` 实现简单
- **后果**: `review_count` 不因修改而增加，`created_at` 更新为修改时间

### ADR-102: 评论区 is_self 标记替代 UserID
- **决策**: 评论返回中移除 `userId`，新增 `isSelf` 布尔标记
- **理由**: 前端仅需知道"这条评论是否是我写的"，零信息泄露
- **后果**: 前端需适配新字段，无法通过评论接口枚举用户

### ADR-103: 新增联系家教认证接口
- **决策**: 新增 `GET /api/v1/tutors/:id/contact`，需 `RequireAuth()` 中间件
- **理由**: 真实微信号属于敏感数据，应按需获取，不应在公开响应中暴露
- **后果**: 前端"联系家教"按钮需先调用此接口，增加一次网络请求

---

## 技术方案

### P0-1 微信登录鉴权

#### 策略模式实现

```
auth/
  provider.go    # AuthProvider 接口定义
  wechat.go      # WechatAuthProvider 实现
  mock.go        # MockAuthProvider 实现（开发环境）
```

#### AuthProvider 接口

```go
package auth

type AuthResult struct {
    OpenID     string
    SessionKey string // 保留但不持久化
}

type AuthProvider interface {
    Authenticate(code string) (*AuthResult, error)
}
```

#### WechatAuthProvider

```go
type WechatAuthProvider struct {
    AppID     string
    AppSecret string
    Client    *http.Client // 3s 连接 + 5s 读取超时
}

func (p *WechatAuthProvider) Authenticate(code string) (*AuthResult, error) {
    url := fmt.Sprintf(
        "https://api.weixin.qq.com/sns/jscode2session?appid=%s&secret=%s&js_code=%s&grant_type=authorization_code",
        p.AppID, p.AppSecret, code)

    resp, err := p.Client.Get(url)
    // 解析 JSON:
    // { "openid": "xxx", "session_key": "xxx", "unionid": "xxx", "errcode": 0, "errmsg": "" }
    // errcode 映射: 40029→401, 45011→429, 其他→502
}
```

#### MockAuthProvider

```go
type MockAuthProvider struct{}

func (p *MockAuthProvider) Authenticate(code string) (*AuthResult, error) {
    return &AuthResult{OpenID: "dev_openid_" + code}, nil
}
```

#### Login handler 改造

```go
func Login(c *gin.Context) {
    var req LoginRequest
    // ... binding 校验 ...

    result, err := authProvider.Authenticate(req.Code)
    if err != nil {
        // 根据错误类型返回 401/429/502
    }

    openID := result.OpenID
    // 后续用户查找/创建逻辑不变
}
```

#### 初始化

```go
// main.go 或 config 初始化时
var authProvider auth.AuthProvider

func initAuthProvider(cfg *config.Config) {
    if cfg.AppEnv == "production" || cfg.AppEnv == "staging" {
        authProvider = &auth.WechatAuthProvider{
            AppID: cfg.WechatAppID,
            AppSecret: cfg.WechatAppSecret,
            Client: &http.Client{Timeout: 8 * time.Second},
        }
    } else {
        authProvider = &auth.MockAuthProvider{}
    }
}
```

#### 配置新增

```go
// config/config.go
type Config struct {
    // 现有字段
    ServerPort string
    DBPath     string
    CORSOrigin string
    JWTSecret  string
    // 新增
    AppEnv          string // development / staging / production
    WechatAppID     string
    WechatAppSecret string
}
```

---

### P0-2 JWT Secret 安全门禁

#### 改造 config.LoadConfig

```go
func LoadConfig() (*Config, error) {
    // ... 现有 godotenv 逻辑 ...

    config := &Config{
        // ... 现有字段 ...
        AppEnv:          getEnv("APP_ENV", "development"),
        WechatAppID:     getEnv("WECHAT_APP_ID", ""),
        WechatAppSecret: getEnv("WECHAT_APP_SECRET", ""),
    }

    // JWT Secret 校验
    if config.AppEnv == "production" || config.AppEnv == "staging" {
        if config.JWTSecret == "" || config.JWTSecret == "dev-secret-change-in-production" {
            return nil, fmt.Errorf("❌ %s 环境必须设置 JWT_SECRET 且不能使用默认值", config.AppEnv)
        }
    } else if config.JWTSecret == "" {
        config.JWTSecret = "dev-secret-change-in-production"
        log.Println("⚠️  JWT_SECRET 未设置，使用开发默认值，生产环境必须配置！")
    }

    return config, nil
}
```

#### .env.example 更新

```env
# 环境配置
APP_ENV=development

# JWT 配置
JWT_SECRET=

# 微信小程序配置
WECHAT_APP_ID=
WECHAT_APP_SECRET=
```

---

### P0-3 评论防重

#### Schema 变更

在 `database/init.sql` 中为 reviews 表添加 UNIQUE 约束：

```sql
CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    tutor_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    content TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'hidden')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tutor_id) REFERENCES tutors(id),
    UNIQUE(tutor_id, user_id)  -- 新增
);
```

#### SubmitReview handler 改造

```go
func SubmitReview(c *gin.Context) {
    // ... 现有 binding 校验 + userId 获取 + 家教存在性校验 ...

    // 检查是否已有评论
    var existingID string
    err := database.DB.QueryRow(
        "SELECT id FROM reviews WHERE tutor_id = ? AND user_id = ? AND status = 'active'",
        req.TutorID, userID,
    ).Scan(&existingID)

    if err == nil {
        // 已有评论 → 修改模式
        _, err = database.DB.Exec(`
            UPDATE reviews SET rating = ?, content = ?, created_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, req.Rating, req.Content, existingID)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": "修改评论失败"})
            return
        }
        // 更新家教评分
        updateTutorRating(req.TutorID)
        c.JSON(http.StatusOK, gin.H{
            "message":  "评论修改成功",
            "reviewId": existingID,
        })
        return
    }

    if err != sql.ErrNoRows {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "查询评论失败"})
        return
    }

    // 无已有评论 → 新增模式（现有逻辑不变）
    tx, err := database.DB.Begin()
    // ... INSERT + UPDATE tutor rating ...
    c.JSON(http.StatusCreated, gin.H{
        "message":  "评论提交成功",
        "reviewId": reviewID,
    })
}

func updateTutorRating(tutorID string) {
    database.DB.Exec(`
        UPDATE tutors SET
            rating = (SELECT AVG(rating) FROM reviews WHERE tutor_id = ? AND status = 'active'),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, tutorID, tutorID)
}
```

#### 数据库重建

删除现有 `tutors.db` 文件，下次启动时自动重建：

```bash
rm backend/database/tutors.db
```

---

### P0-4 脱敏加固

#### Review 模型变更

```go
// models/review.go

// Review 数据库模型（不变）
type Review struct {
    ID        string    `json:"-"`
    TutorID   string    `json:"tutorId"`
    UserID    string    `json:"-"`
    Rating    int       `json:"rating"`
    Content   string    `json:"content"`
    Status    string    `json:"status"`
    CreatedAt time.Time `json:"createdAt"`
}

// ReviewResponse API 返回模型（新增 isSelf，移除 userId）
type ReviewResponse struct {
    ID        string    `json:"id"`
    TutorID   string    `json:"tutorId"`
    IsSelf    bool      `json:"isSelf"`
    Rating    int       `json:"rating"`
    Content   string    `json:"content"`
    Status    string    `json:"status"`
    CreatedAt time.Time `json:"createdAt"`
}

// ToResponse 将 Review 转为 ReviewResponse
func (r *Review) ToResponse(currentUserID string) ReviewResponse {
    return ReviewResponse{
        ID:        r.ID,
        TutorID:   r.TutorID,
        IsSelf:    r.UserID == currentUserID,
        Rating:    r.Rating,
        Content:   r.Content,
        Status:    r.Status,
        CreatedAt: r.CreatedAt,
    }
}
```

#### handlers 改造

**GetReviews**: 使用 `ReviewResponse` 替代 `Review` 返回：

```go
func GetReviews(c *gin.Context) {
    // ... 现有查询逻辑 ...

    currentUserID, _ := c.Get("userId") // 可能为空（未登录）
    uid, _ := currentUserID.(string)

    responses := make([]models.ReviewResponse, 0, len(reviews))
    for _, r := range reviews {
        responses = append(responses, r.ToResponse(uid))
    }

    c.JSON(http.StatusOK, models.ReviewListResponse{
        Total:   total,
        Page:    params.Page,
        PerPage: params.PageSize,
        Data:    responses,
    })
}
```

**GetTutorDetail**: 同样使用 `ReviewResponse`。

#### 新增联系家教接口

```go
// handlers/tutors.go

func GetTutorContact(c *gin.Context) {
    tutorID := c.Param("id")
    if tutorID == "" {
        c.JSON(http.StatusBadRequest, gin.H{"error": "缺少家教ID"})
        return
    }

    var wechatID string
    var verified bool
    err := database.DB.QueryRow(
        "SELECT wechat_id, verified FROM tutors WHERE id = ? AND status = 'active'",
        tutorID,
    ).Scan(&wechatID, &verified)

    if err == sql.ErrNoRows {
        c.JSON(http.StatusNotFound, gin.H{"error": "家教不存在"})
        return
    }
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
        return
    }

    if !verified {
        c.JSON(http.StatusOK, gin.H{
            "wechatId": nil,
            "message":  "该家教尚未通过平台认证",
        })
        return
    }

    c.JSON(http.StatusOK, gin.H{"wechatId": wechatID})
}
```

#### 路由注册

```go
// main.go
v1 := router.Group("/api/v1")
{
    // 现有路由
    v1.GET("/tutors", handlers.GetTutors)
    v1.GET("/tutors/:id", handlers.GetTutorDetail)
    v1.GET("/reviews", handlers.GetReviews)
    v1.POST("/reviews", middleware.RequireAuth(), handlers.SubmitReview)
    v1.POST("/tutors", middleware.RequireAuth(), middleware.RequireAdmin(), handlers.CreateTutor)
    v1.POST("/auth/login", handlers.Login)
    // 新增
    v1.GET("/tutors/:id/contact", middleware.RequireAuth(), handlers.GetTutorContact)
}
```

#### 前端 api.js 新增

```javascript
const getTutorContact = async (tutorId) => {
  return await request('GET', `/tutors/${tutorId}/contact`)
}

module.exports = {
  // 现有导出
  getTutors,
  getTutorDetail,
  submitReview,
  createTutor,
  // 新增
  getTutorContact
}
```

#### 前端 tutor-detail.js 改造

```javascript
async onContact() {
    if (!getApp().globalData.token) {
        wx.showToast({ title: '请先登录', icon: 'none' })
        // 引导登录逻辑
        return
    }
    try {
        const result = await api.getTutorContact(this.data.tutor.id)
        if (!result.wechatId) {
            wx.showToast({ title: result.message || '该家教尚未认证', icon: 'none' })
            return
        }
        wx.setClipboardData({
            data: result.wechatId,
            success: () => {
                wx.showToast({ title: '微信号已复制', icon: 'success' })
            }
        })
    } catch (err) {
        if (err.statusCode === 401) {
            wx.showToast({ title: '请先登录', icon: 'none' })
        } else {
            wx.showToast({ title: '获取联系方式失败', icon: 'none' })
        }
    }
}
```

---

## 文件变更清单

| 操作 | 文件 | 变更说明 |
|------|------|----------|
| 新增 | `backend/auth/provider.go` | AuthProvider 接口 |
| 新增 | `backend/auth/wechat.go` | 微信鉴权实现 |
| 新增 | `backend/auth/mock.go` | Mock 鉴权实现 |
| 修改 | `backend/config/config.go` | 新增 AppEnv/WechatAppID/WechatAppSecret，JWT 校验 |
| 修改 | `backend/main.go` | 初始化 authProvider，注册 contact 路由 |
| 修改 | `backend/handlers/reviews.go` | Login 使用 authProvider，SubmitReview 防重+修改 |
| 修改 | `backend/handlers/tutors.go` | 新增 GetTutorContact，评论用 ReviewResponse |
| 修改 | `backend/models/review.go` | 新增 ReviewResponse，Review json tag 调整 |
| 修改 | `backend/database/init.sql` | reviews 表 UNIQUE 约束 |
| 修改 | `backend/.env.example` | 新增 APP_ENV, WECHAT_APP_ID, WECHAT_APP_SECRET |
| 修改 | `miniprogram/utils/api.js` | 新增 getTutorContact |
| 修改 | `miniprogram/pages/tutor-detail/tutor-detail.js` | onContact 改用认证接口 |
| 删除 | `backend/database/tutors.db` | 重建数据库 |

---

## 依赖关系

```
P0-2 (JWT Secret) ──→ P0-1 (微信登录) ──→ P0-4 (脱敏 + contact 接口)
                                                       ↑
P0-3 (评论防重) ──────────────────────────────────────┘
```

建议实施顺序：P0-2 → P0-3 → P0-1 → P0-4

- P0-2 最简单，先完成配置层改造
- P0-3 独立于鉴权改造，可并行
- P0-1 依赖 P0-2 的配置新增
- P0-4 依赖 P0-1 的认证体系
