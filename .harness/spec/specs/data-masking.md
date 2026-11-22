# SPEC: 脱敏加固 (P0-4)

## 能力描述
1. 评论返回中移除 `userId` 暴露，改用 `is_self` 布尔标记
2. 新增"联系家教"认证接口，返回真实微信号

## 前置条件
- JWT 认证中间件 `RequireAuth()` 已实现

## 输入
- 评论 API：`GET /api/v1/reviews?tutorId=xxx` / `GET /api/v1/tutors/:id`（含评论）
- 联系家教 API：`GET /api/v1/tutors/:id/contact`（需 `Authorization: Bearer <token>`）

## 输出

### 评论返回格式变更
**变更前**:
```json
{
  "id": "review_001",
  "tutorId": "tutor_001",
  "userId": "user_101",
  "rating": 5,
  "content": "很好",
  "status": "active",
  "createdAt": "2026-06-21T10:00:00Z"
}
```

**变更后**:
```json
{
  "id": "review_001",
  "tutorId": "tutor_001",
  "isSelf": false,
  "rating": 5,
  "content": "很好",
  "status": "active",
  "createdAt": "2026-06-21T10:00:00Z"
}
```

- `isSelf`: 当前请求用户是否为评论作者。未登录请求中 `isSelf` 为 `false`。

### 联系家教接口
- 成功：`{ "wechatId": "<真实微信号>" }` HTTP 200
- 未登录：HTTP 401
- 家教不存在：HTTP 404
- 家教未认证（verified=false）：`{ "wechatId": null, "message": "该家教尚未通过平台认证" }` HTTP 200

## 行为规格

### 评论 is_self 计算
1. 从 JWT context 获取当前用户 `userId`（如果已登录）
2. `isSelf = (currentUserId == review.UserID)`
3. 未登录请求：`isSelf = false`
4. 评论返回中不再包含 `userId` 字段

### 联系家教接口
1. 路由：`GET /api/v1/tutors/:id/contact`
2. 中间件：`RequireAuth()`
3. 查询 tutors 表获取 wechat_id
4. 返回未脱敏的真实 wechat_id
5. 家教详情页（`GetTutorDetail`）继续返回脱敏的微信号（公开信息）

### 前端配合变更
1. `utils/api.js` 新增 `getTutorContact(tutorId)` 方法
2. `pages/tutor-detail/tutor-detail.js` 的 `onContact()` 方法改为：
   - 先调用 `getTutorContact(tutorId)` 获取真实微信号
   - 然后复制到剪贴板
   - 未登录时引导登录

## 数据模型变更
无。数据库存储不变，脱敏仅在序列化层处理。

## 边界条件
- 未登录用户访问评论时，`isSelf` 统一为 `false`（不暴露登录状态）
- `isSelf` 在前端用于显示"编辑/删除"按钮，不影响评分计算
- 联系家教接口对 verified=false 的家教返回 `wechatId: null`，前端可据此提示"该家教尚未认证"
