# 家教入驻系统设计（产品功能系统 · 供给侧行动）

> 日期: 2026-11-22 · 模式: 自动决策（PM 授权"自动选择最优方案"）
> 范围: 提案 P2-1 入驻流程 + P2-5 图片上传（依赖）+ 极简审核端
> 不在本期: 完整 Web 管理台、收藏/搜索增强（P2-2/3）、OSS、订阅消息通知

## 1. 背景与目标

现状: 48 小时 MVP（Go+Gin+SQLite 后端 6 端点 + 4 页小程序），家教为运营手工录入的静态名录，登录在开发环境为 Mock。

核心假设（源自 PLAN.md）: "平台提供人工核验 + 发现能力，家长才会信任平台上的家教"。人工核验目前只能靠改数据库——**入驻系统把静态名录变成双边市场：家教自助入驻 → 管理员人工核验 → 上线展示**。

成功标准: 一位家教从扫码进入小程序，到档案通过核验并对家长可见，全程无需运营碰数据库；驳回可附原因且家教可见。

## 2. 关键决策（自动选定，含理由）

| 决策点 | 选定 | 理由 |
| --- | --- | --- |
| 方案 | A. 小程序内闭环 | 单人开发最快、零新增基础设施、复用现有 JWT/角色中间件。B（独立 Web 管理台）工作量翻倍，C（云开发重写）迁移成本远超收益 |
| 图片上传 | 纳入本期（凭证必传/头像可选） | 没有凭证材料的人工核验是空转；顺带解决 P2-5 |
| 审核端 | 极简审核页（小程序内，admin 角色可见） | 审核闭环不可少；完整管理台列后续 |
| 登录依赖 | 复用现有双 Provider（dev=Mock / prod=code2session） | `auth/` 已有骨架；P0-1 生产化属部署阶段 |
| 存储 | tutors 表加列，不建独立申请表 | 简单优先；pending 档案家长端不可见即可满足语义 |
| 图片存储 | 本地磁盘 `/uploads` + 静态路由 | 单机部署够用；OSS 列后续 |

## 3. 角色与权限

| 角色 | 身份 | 权限 |
| --- | --- | --- |
| 游客 | 无 | 浏览列表/详情（现有） |
| 家长 | openid（登录） | 联系家教、写评价（现有接口已要求登录） |
| 家教 | openid 绑定 tutors.user_id | 提交/查看自己的申请、编辑已通过档案（触发重审） |
| 管理员 | users.role='admin' | 审核列表、通过/驳回（复用 `RequireAdmin`） |

## 4. 入驻状态机

```
(登录家教) 填表提交 ──→ pending ──approve──→ approved（家长可见）
                          │                     │
                          └─reject(附原因)→ rejected   编辑关键字段 → pending（编辑即时可见）
                                                └──重新提交──→ pending
```

约束:
- 同一 openid 同时最多一个 `pending`（数据库唯一部分索引保证）
- 驳回必附 `audit_note`（1-200 字），仅本人可见
- approved 档案**编辑即时生效**（tutors 单行存储，无快照），同时 `audit_status` 回 `pending`、家长端继续展示（信任已建立），管理员可下架兜底。触发重审的字段清单: 姓名、性别、学历、学校、专业、科目、年级、时薪、所在地、简介、凭证照、头像。"编辑审后生效"需双行/快照机制，列入后续
- `status`(active/inactive) 保持上架语义不变，与审核解耦

## 5. 数据模型变更

tutors 表新增列（SQLite `ALTER TABLE ADD COLUMN`，启动时幂等迁移）:

```sql
user_id       TEXT DEFAULT ''              -- 绑定 openid
audit_status  TEXT DEFAULT 'none'          -- none/pending/approved/rejected
audit_note    TEXT DEFAULT ''
submitted_at  DATETIME
cert_images   TEXT DEFAULT '[]'            -- JSON 数组: /uploads/xxx.jpg
```

索引:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_tutors_pending_user
  ON tutors(user_id) WHERE audit_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tutors_audit ON tutors(audit_status);
```

家长端查询语义变更: 列表与详情过滤从 `status='active'` 改为 `status='active' AND audit_status='approved'`（存量手工数据启动迁移时批量置 `approved`）。

## 6. API 设计

前缀 `/api/v1`，全部 JSON；认证沿用 `Authorization: Bearer <JWT>`。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/tutor-applications` | 登录 | 创建并提交申请（首次）或更新重提；字段校验错误逐项返回 `{errors:{field:msg}}` |
| GET | `/tutor-applications/mine` | 登录 | 本人申请状态: 状态/驳回原因/档案 id |
| POST | `/tutor-applications/images` | 登录 | multipart 单图: jpg/png ≤5MB，uuid 命名存 `uploads/`，返回 URL |
| GET | `/admin/tutor-applications` | admin | `?status=pending` 待审列表（分页） |
| POST | `/admin/tutor-applications/:id/approve` | admin | 通过: 置 approved |
| POST | `/admin/tutor-applications/:id/reject` | admin | 驳回: body `{note}` 必填 1-200 字 |

规则:
- 提交必填: 姓名、性别、学历、学校、科目(≥1)、年级(≥1)、时薪(50-500)、所在地、简介(30-500 字)、凭证照(≥1)
- approve 仅对 pending 生效；重复操作返回幂等结果
- 已有记录时的提交语义按 §4 状态机: pending → 409；rejected → 重提；approved → 编辑重审
- **存量档案认领**: 运营手工录入的档案 `user_id=''`，本人入驻会新建第二条——首版不做认领流程，由管理员在审核时识别同名/同校重复并驳回（`audit_note` 说明），人工在数据库合并；"我要认领我的档案"流程列入后续
- 触发重审的编辑字段清单见 §4

代码组织: 新增 `handlers/tutor_application.go`（或按现有 handlers 拆分风格），数据库访问延续现有 handlers 内函数模式（Repository 抽象属 P1-1，不顺带扩张）。

## 7. 图片上传

- 存储: `backend/uploads/`（.gitignore），router.Static(`/uploads`, "./uploads")
- 校验: Content-Type 与扩展名双重白名单（image/jpeg, image/png），5MB 上限，uuid4 文件名，固定扩展名拼接（防路径穿越）
- 失败处理: 超限/类型错误返回 400 带明示字段；前端可重试
- 后续: OSS/云存储迁移时仅替换存储层 URL 生成

## 8. 小程序端

新增 3 页，沿用「成绩单公报」设计语言（design/brief.md），tab 新增第 3 项「我的」（图标程序化生成，墨绿/灰褐双态）:

| 页面 | 内容 |
| --- | --- |
| `pages/mine/mine` | 未登录: 登录引导卡；家教: 申请状态卡（待审核/已通过→我的档案/驳回→原因+重新提交）；管理员: 审核入口（显示待审数） |
| `pages/apply/apply` | 四步表单: 基本信息→教学信息（科目/年级/时薪）→凭证上传（必传≥1，头像可选）→预览提交；字段级错误就地显示；提交后回 mine |
| `pages/admin-audit/admin-audit` | 待审列表（申请摘要）→ 详情 → 通过/驳回（驳回弹原因输入） |

状态四态沿用公报语言: 加载=付梓中骨架、空=启事、错误=墨字+红「重试」、成功=已收录印。

## 9. 安全要点

- 全部写接口要求登录；admin 接口经 `RequireAdmin`
- 上传双重校验 + uuid 命名 + 固定目录（防穿越/防覆盖）
- 同 openid 唯一 pending（部分唯一索引）
- 驳回原因仅本人可见（mine 接口按 openid 过滤）
- 不新增 secrets；生产 JWT_SECRET 要求已在 config 层有校验（P0-2 上线阶段处理）

## 10. 错误处理

- 后端: 字段校验错误 400 + `{errors:{...}}`；权限 401/403；冲突 409；上传类型/大小 400 明示原因
- 前端: 表单错误就地标注；上传失败保留已填内容可重试；网络错误用全局提示 + 重试；四态齐备
- 现有 `utils/api.js` 统一携带 token 与 401 处理（跳登录）

## 11. 测试策略

后端 handler 单测:
1. 首次提交成功 → pending；2. 同 openid 二次 pending 提交 → 409；3. 非管理员调审核接口 → 403；4. approve 后家长端列表可见该档案；5. reject 无 note → 400；6. approved 编辑关键字段 → 回 pending 且家长端仍可见；7. 上传超 5MB / 非白名单类型 → 400。

前端手工清单: 四步表单必填校验、断网提交、驳回→原因显示→重新提交闭环、admin 通过后列表即时可见。

## 12. 分期实施

- M1 后端: 迁移函数 + 6 个 API + 上传 + 单测
- M2 小程序: mine tab + apply 四步表单
- M3 小程序: admin-audit 审核端 + 状态卡
- 后续阶段（不在本期）: 收藏/搜索增强、完整 Web 管理台、OSS、微信订阅消息（审核结果通知）、真实微信登录生产化（P0-1）

## 13. 明确不做（YAGNI）

- 不做申请草稿云端保存（本地缓存即可）
- 不做多角色申请（教机构/机构账号）
- 不做在线签约/支付
- 不做审核工作流（多级审批）
