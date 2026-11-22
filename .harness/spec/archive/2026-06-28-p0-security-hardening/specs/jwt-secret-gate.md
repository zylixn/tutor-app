# SPEC: JWT Secret 安全门禁 (P0-2)

## 能力描述
生产环境启动时校验 JWT Secret 配置，拒绝使用默认值或空值。

## 前置条件
- 新增 `APP_ENV` 环境变量

## 输入
- 环境变量 `JWT_SECRET` 和 `APP_ENV`

## 输出
- 启动行为：
  - 生产 + JWT_SECRET 为空/默认值 → `log.Fatal`，拒绝启动，退出码 1
  - 非生产 + JWT_SECRET 为空 → 使用默认值 + `log.Println` 警告
  - JWT_SECRET 已配置 → 正常启动

## 行为规格

### 配置校验逻辑
```
if APP_ENV == "production" || APP_ENV == "staging":
    if JWT_SECRET == "" || JWT_SECRET == "dev-secret-change-in-production":
        log.Fatal("❌ 生产环境必须设置 JWT_SECRET 且不能使用默认值")
        os.Exit(1)
elif JWT_SECRET == "":
    JWT_SECRET = "dev-secret-change-in-production"
    log.Println("⚠️  JWT_SECRET 未设置，使用开发默认值")
```

### APP_ENV 环境变量
| 值 | 含义 |
|----|------|
| `development`（默认） | 开发环境，允许默认 JWT Secret |
| `staging` | 预发布环境，校验逻辑同 production |
| `production` | 生产环境，强制校验 |

## 数据模型变更
无。

## 配置项
| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `APP_ENV` | 否 | `development` | 运行环境 |
| `JWT_SECRET` | 生产必需 | `dev-secret-change-in-production` | JWT 签名密钥 |

## 边界条件
- `APP_ENV` 值不在枚举范围内时，视为 `development`
- 启动失败时输出明确的错误信息和修复指引
