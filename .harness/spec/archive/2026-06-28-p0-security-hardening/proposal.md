# P0 安全加固 — Proposal

## 变更名称
`p0-security-hardening`

## 做什么

修复家教小程序后端 4 项 P0 级安全/可靠性问题：

1. **微信登录鉴权**：替换 Mock 登录为真实微信 `jscode2session` 鉴权，开发环境保留 Mock 模式
2. **JWT Secret 安全**：生产环境拒绝使用默认密钥启动
3. **评论防重**：同一用户对同一家教仅允许一条评论，支持修改已有评论
4. **脱敏加固**：评论区移除 `userId` 暴露，改用 `is_self` 标记；新增"联系家教"认证接口返回真实微信号

## 为什么

### P0-1 登录鉴权
- `handlers/reviews.go:29` 硬编码 `openID := "dev_openid_" + req.Code`
- 任何人传入任意 code 即可登录，获取合法 JWT token
- 提交评论等需登录的操作完全失控

### P0-2 JWT Secret
- `config/config.go:34` 使用默认值 `"dev-secret-change-in-production"`
- 生产部署若忘记配置，任何人可伪造任意用户的 JWT token
- 可冒充 admin 执行管理员操作（创建家教等）

### P0-3 评论防重
- `SubmitReview` 无唯一性校验
- 同一用户可对同一家教无限次刷评论，污染评分
- 恶意用户可通过大量 1 星评论拉低家教评分

### P0-4 脱敏加固
- 评论返回中 `userId` 完整暴露，可枚举所有用户
- 家教详情页因 `MaskWechatID` 导致"联系家教"功能已损坏（复制的是脱敏微信号如 `zh****du`）
- 需要一个认证接口，让已登录用户获取真实微信号

## 影响范围

| 变更项 | 后端文件 | 前端文件 |
|--------|---------|---------|
| P0-1 登录鉴权 | `handlers/reviews.go`, `config/config.go`, 新增 `auth/wechat.go` | `utils/api.js`, `pages/tutor-detail/tutor-detail.js` |
| P0-2 JWT Secret | `config/config.go` | 无 |
| P0-3 评论防重 | `database/init.sql`, `handlers/reviews.go` | 无 |
| P0-4 脱敏加固 | `models/review.go`, `handlers/tutors.go`, `handlers/reviews.go`, 新增 contact 路由 | `utils/api.js`, `pages/tutor-detail/tutor-detail.js` |

## 排除范围

- 不涉及微信 `session_key` 持久化（YAGNI，待手机号获取需求时再扩展）
- 不涉及 Repository 层重构（P1 范围）
- 不涉及数据库迁移工具引入（数据可丢弃，直接重建）
- 不涉及前端页面结构变更

## 成功标准

1. 登录接口在 `APP_ENV=production` 时调用微信 `jscode2session`，`APP_ENV=development` 时保持 Mock
2. `APP_ENV=production` 且 `JWT_SECRET` 为空/默认值时，服务拒绝启动
3. 同一用户对同一家教重复提交评论返回 409，允许修改已有评论
4. 评论 API 返回中无 `userId` 字段，改用 `is_self` 布尔标记
5. 新增 `GET /api/v1/tutors/:id/contact` 认证接口，返回真实微信号
6. 现有测试可正常运行
