# P0 安全加固 — Tasks

## 实施步骤

### Task 1: P0-2 JWT Secret 安全门禁 + 配置层改造

**前置**: 无
**工作量**: 0.5h
**验证**: `APP_ENV=production JWT_SECRET="" go run .` 拒绝启动

- [x] 1.1 `config/config.go` 新增 `AppEnv`、`WechatAppID`、`WechatAppSecret` 字段
- [x] 1.2 `config/config.go` 新增 JWT Secret 校验逻辑（production/staging 拒绝默认值）
- [x] 1.3 `config/config.go` 新增 `getEnv("APP_ENV", "development")`
- [x] 1.4 `.env.example` 新增 `APP_ENV`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET`
- [x] 1.5 验证：开发环境正常启动，生产环境空 JWT_SECRET 拒绝启动

---

### Task 2: P0-3 评论防重

**前置**: 无（可与 Task 1 并行）
**工作量**: 1h
**验证**: 同一用户重复提交评论返回 409，修改评论返回 200

- [x] 2.1 `database/init.sql` reviews 表添加 `UNIQUE(tutor_id, user_id)` 约束
- [x] 2.2 `main.go` 的 `executeInitSQL()` 同步更新 reviews 表定义
- [x] 2.3 删除 `backend/database/tutors.db` 重建数据库
- [x] 2.4 `handlers/reviews.go` SubmitReview 增加已有评论检查
- [x] 2.5 已有评论时执行 UPDATE（rating + content + created_at），返回 HTTP 200
- [x] 2.6 提取 `updateTutorRating()` 辅助函数，去重评分更新逻辑
- [x] 2.7 验证：
  - 新评论返回 201
  - 重复提交同一内容返回 409 或 200（修改模式）
  - 修改评论后家教评分正确更新
  - review_count 不因修改而 +1

---

### Task 3: P0-1 微信登录鉴权

**前置**: Task 1（配置层新增 APP_ENV 等）
**工作量**: 2h
**验证**: 开发环境 Mock 登录正常，生产环境调用微信 API

- [x] 3.1 创建 `backend/auth/` 包
- [x] 3.2 `auth/provider.go` 定义 `AuthProvider` 接口和 `AuthResult` 结构体
- [x] 3.3 `auth/mock.go` 实现 `MockAuthProvider`（现有硬编码逻辑）
- [x] 3.4 `auth/wechat.go` 实现 `WechatAuthProvider`：
  - 调用 `jscode2session` API
  - 超时：3s 连接 + 5s 读取
  - errcode 映射：40029→401, 45011→429, 其他→502
- [x] 3.5 `auth/wechat.go` 定义微信 API 响应结构体和错误类型
- [x] 3.6 `main.go` 初始化 authProvider（根据 APP_ENV 选择实现）
- [x] 3.7 `handlers/reviews.go` Login 使用 `authProvider.Authenticate()` 替换硬编码
- [x] 3.8 验证：
  - `APP_ENV=development` Mock 登录正常
  - 微信 API 错误码正确映射
  - 生产环境 AppID/Secret 为空时启动警告

---

### Task 4: P0-4 脱敏加固 + 联系家教接口

**前置**: Task 3（认证体系）
**工作量**: 1.5h
**验证**: 评论返回无 userId、isSelf 正确、联系家教接口返回真实微信号

- [x] 4.1 `models/review.go` 新增 `ReviewResponse` 结构体（含 `isSelf`，无 `userId`）
- [x] 4.2 `models/review.go` `Review` 结构体调整 json tag（`id` 和 `userId` 改为 `json:"-"`）
- [x] 4.3 `models/review.go` 新增 `ToResponse(currentUserID string)` 方法
- [x] 4.4 `handlers/tutors.go` GetTutorDetail 中评论使用 ReviewResponse
- [x] 4.5 `handlers/reviews.go` GetReviews 中评论使用 ReviewResponse
- [x] 4.6 从 JWT context 获取 currentUserID，传入 ToResponse
- [x] 4.7 `handlers/tutors.go` 新增 GetTutorContact 函数
- [x] 4.8 `main.go` 注册路由 `GET /api/v1/tutors/:id/contact` + RequireAuth()
- [x] 4.9 `miniprogram/utils/api.js` 新增 `getTutorContact(tutorId)` 方法
- [x] 4.10 `miniprogram/pages/tutor-detail/tutor-detail.js` onContact 改用认证接口
- [x] 4.11 验证：
  - 评论 API 返回中无 `userId` 字段
  - `isSelf` 在登录用户自己评论时为 true
  - 未登录时 `isSelf` 全为 false
  - `/tutors/:id/contact` 返回真实微信号
  - 未认证家教返回 `wechatId: null`

---

### Task 5: 端到端验证

**前置**: Task 1-4 全部完成
**工作量**: 0.5h

- [x] 5.1 删除 `backend/database/tutors.db`
- [x] 5.2 `APP_ENV=development go run .` 启动服务
- [x] 5.3 测试完整流程：登录 → 浏览家教 → 查看详情 → 提交评论 → 联系家教
- [x] 5.4 测试安全场景：
  - 重复评论（应返回 409 或 200 修改模式）
  - 未登录联系家教（应返回 401）
  - 评论返回无 userId
- [x] 5.5 测试生产环境启动拦截：`APP_ENV=production JWT_SECRET="" go run .` 应拒绝启动
- [x] 5.6 更新 `docs/提案.md` 中 P0 项的状态

---

## 总工作量

| Task | 内容 | 工作量 |
|------|------|--------|
| 1 | JWT Secret + 配置层 | 0.5h |
| 2 | 评论防重 | 1h |
| 3 | 微信登录鉴权 | 2h |
| 4 | 脱敏加固 + 联系家教 | 1.5h |
| 5 | 端到端验证 | 0.5h |
| **总计** | | **5.5h** |
