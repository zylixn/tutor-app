# SPEC: 微信登录鉴权 (P0-1)

## 能力描述
替换 Mock 登录为真实微信 `jscode2session` 鉴权，开发环境保留 Mock 模式。

## 前置条件
- 微信小程序 AppID 和 AppSecret（需在微信公众平台获取）
- Go 标准库 `net/http` 调用微信 API

## 输入
- `POST /api/v1/auth/login` 请求体：`{ "code": "<wx.login() 返回的 code>" }`

## 输出
- 成功：`{ "token": "<JWT>", "userId": "<用户ID>", "role": "user|admin" }`
- 微信 API 错误：`{ "error": "微信登录失败: <errcode> <errmsg>" }` HTTP 502
- code 无效/过期：HTTP 401

## 行为规格

### 生产环境 (`APP_ENV=production`)
1. 接收前端 `code`
2. 调用微信 `https://api.weixin.qq.com/sns/jscode2session?appid=APPID&secret=SECRET&js_code=CODE&grant_type=authorization_code`
3. 解析返回 JSON，获取 `openid`
4. 如返回 `errcode` 不为 0，映射为 HTTP 错误：
   - `40029`（invalid code）→ 401
   - `45011`（频率限制）→ 429
   - 其他 → 502
5. 超时设置：3s 连接 + 5s 读取
6. 不重试（code 一次性，过期需前端重新 `wx.login()`）
7. 用 openid 查找/创建用户，生成 JWT token

### 开发环境 (`APP_ENV=development` 或未设置)
1. 保持现有 Mock 逻辑：`openID := "dev_openid_" + code`
2. 无外部 HTTP 调用

## 配置项
| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `APP_ENV` | 否 | `development` | 运行环境 |
| `WECHAT_APP_ID` | 生产必需 | 空 | 微信小程序 AppID |
| `WECHAT_APP_SECRET` | 生产必需 | 空 | 微信小程序 AppSecret |

## 数据模型变更
无。`users` 表结构不变。

## 边界条件
- `WECHAT_APP_ID` 或 `WECHAT_APP_SECRET` 在生产环境为空时，启动时警告，登录时返回 503
- 微信 API 不可达时返回 502
- `code` 为空字符串时返回 400
