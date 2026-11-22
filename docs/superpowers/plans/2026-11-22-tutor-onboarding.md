# 家教入驻系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 家教在小程序内自助入驻 → 管理员审核 → 档案对家长可见的完整闭环（规格: `docs/superpowers/specs/2026-11-22-tutor-onboarding-system-design.md`）。

**Architecture:** 方案 A（小程序内闭环）。后端在现有 Gin 单体上加 6 个端点（申请提交/查询/图片上传/审核三件套），tutors 表加 5 列（幂等迁移），家长端查询加 `audit_status='approved'` 过滤；前端新增 mine/apply/admin-audit 三页 + 登录与上传工具函数，沿用「成绩单公报」设计令牌（`app.wxss`）。

**Tech Stack:** Go 1.25 + Gin + modernc.org/sqlite（WAL）；微信小程序原生；stdlib `testing` + `httptest`（项目此前无测试，本计划建立测试基建）。

**执行须知（全局）:**
- 项目**当前无 git 仓库**，Task 0 先初始化；commit 用简明 conventional 格式（项目的 `ai-git-commit-spec` 需要"任务号"，本工作无任务号，故不适用该格式）
- 所有后端命令在 `backend/` 目录执行；测试命令 `go test ./... -run <name> -v`
- 服务启动验证: `go run .` 后 `curl localhost:8080/health`（若 8080 被占: `lsof -ti :8080 | xargs kill`）
- 设计令牌速查（小程序 WXSS 用）: `--paper:#F7F4EC --paper-deep --ink:#1F2A26 --ink-green:#175243 --ink-soft --ink-faint --line --line-strong --seal:#B5442D --serif --mono --fs-*`，通用类 `.masthead/.sec-title/.state-box/.btn-primary/.btn-ghost/.text-action/.skel-*` 均已在 `app.wxss`（页面可直接用；**组件内不可用**，需本地定义——新页面都是页面级，无此问题）

---

### Task 0: 初始化 git 仓库

**Files:**
- Create: `.gitignore`（项目根）

- [ ] **Step 1: 写 .gitignore**

```gitignore
# 依赖与构建
node_modules/
*.exe

# 数据与上传（运行时产物）
backend/database/*.db
backend/database/*.db-wal
backend/database/*.db-shm
backend/uploads/

# 环境与密钥
.env
*.local.json

# 系统文件
.DS_Store
```

- [ ] **Step 2: 初始化并首次提交**

```bash
cd /Users/wangwenhui/Desktop/workspace/code/wechat-app/家教小程序
git init
git add .gitignore
git commit -m "chore: init repository with gitignore"
git add -A
git commit -m "chore: snapshot existing codebase before onboarding system"
```

Expected: 两次提交成功，`git log --oneline` 显示 2 条。

---

### Task 1: 抽取 `database.EnsureSchema()`（表结构归位到 database 包）

现有建表 DDL 分散在 `main.go`（`initDatabaseSchema`/`executeInitSQL`），测试无法复用。抽取到 database 包，main.go 只留测试数据播种。

**Files:**
- Create: `backend/database/schema.go`
- Modify: `backend/main.go`
- Test: `backend/database/schema_test.go`

- [ ] **Step 1: 写失败测试**

`backend/database/schema_test.go`:

```go
package database

import (
	"path/filepath"
	"testing"
)

func TestEnsureSchemaCreatesTables(t *testing.T) {
	dir := t.TempDir()
	if err := InitDB(filepath.Join(dir, "test.db")); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer CloseDB()

	if err := EnsureSchema(); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}

	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('tutors','reviews','users')").Scan(&count)
	if err != nil {
		t.Fatalf("查询表失败: %v", err)
	}
	if count != 3 {
		t.Fatalf("期望 3 张表, 实际 %d", count)
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && go test ./database/ -v`
Expected: FAIL（`EnsureSchema` 未定义，编译错误）

- [ ] **Step 3: 实现 `backend/database/schema.go`**

```go
package database

import "fmt"

// EnsureSchema 幂等创建基础表与索引（不含测试数据、不含增量迁移列——迁移见 Migrate）
func EnsureSchema() error {
	ddl := `
	CREATE TABLE IF NOT EXISTS tutors (
	    id TEXT PRIMARY KEY,
	    name TEXT NOT NULL,
	    avatar TEXT DEFAULT '',
	    gender TEXT NOT NULL CHECK(gender IN ('male', 'female')),
	    education TEXT NOT NULL,
	    school TEXT NOT NULL,
	    major TEXT DEFAULT '',
	    subjects TEXT NOT NULL DEFAULT '[]',
	    grades TEXT NOT NULL DEFAULT '[]',
	    hourly_rate INTEGER NOT NULL DEFAULT 0,
	    location TEXT NOT NULL,
	    experience INTEGER DEFAULT 0,
	    verified INTEGER DEFAULT 0,
	    rating REAL DEFAULT 5.0,
	    review_count INTEGER DEFAULT 0,
	    bio TEXT DEFAULT '',
	    wechat_id TEXT NOT NULL,
	    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
	    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS reviews (
	    id TEXT PRIMARY KEY,
	    tutor_id TEXT NOT NULL,
	    user_id TEXT NOT NULL,
	    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
	    content TEXT NOT NULL,
	    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'hidden')),
	    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	    FOREIGN KEY (tutor_id) REFERENCES tutors(id),
	    UNIQUE(tutor_id, user_id)
	);

	CREATE TABLE IF NOT EXISTS users (
	    id TEXT PRIMARY KEY,
	    openid TEXT NOT NULL UNIQUE,
	    role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin')),
	    nickname TEXT DEFAULT '',
	    avatar_url TEXT DEFAULT '',
	    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_tutors_status ON tutors(status);
	CREATE INDEX IF NOT EXISTS idx_tutors_location ON tutors(location);
	CREATE INDEX IF NOT EXISTS idx_reviews_tutor_id ON reviews(tutor_id);
	CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);
	CREATE INDEX IF NOT EXISTS idx_users_openid ON users(openid);
	`
	if _, err := DB.Exec(ddl); err != nil {
		return fmt.Errorf("创建表失败: %w", err)
	}
	return nil
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && go test ./database/ -v`
Expected: PASS（1 个测试）

- [ ] **Step 5: 改造 `backend/main.go` 使用 EnsureSchema**

删除 `import` 中的 `"embed"`、`//go:embed database/init.sql`、`var initSQLFS`、`initDatabaseSchema`、`executeInitSQL` 两个函数，将 main 中 `if err := initDatabaseSchema(); err != nil {...}` 替换为:

```go
	if err := database.EnsureSchema(); err != nil {
		log.Fatalf("❌ 初始化数据库结构失败: %v", err)
	}
	if err := insertTestData(); err != nil {
		log.Fatalf("❌ 初始化测试数据失败: %v", err)
	}
```

`insertTestData` 函数本体保留不动（内部已有 count>0 短路）。

- [ ] **Step 6: 编译并启动验证**

Run: `cd backend && go build ./... && lsof -ti :8080 | xargs kill 2>/dev/null; (go run . &) && sleep 3 && curl -s localhost:8080/health && lsof -ti :8080 | xargs kill`
Expected: `{"message":"家教小程序 API 服务运行中","status":"ok"}`（若之前有旧实例占用 8080，先被清掉）

- [ ] **Step 7: Commit**

```bash
git add backend/database/schema.go backend/database/schema_test.go backend/main.go
git commit -m "refactor: extract EnsureSchema into database package for test reuse"
```

---

### Task 2: 幂等迁移 `database.Migrate()`（5 列 + 索引 + 存量回填）

**Files:**
- Create: `backend/database/migrate.go`
- Modify: `backend/database/schema.go`（基础 DDL 直接含新列，新装一步到位）
- Test: `backend/database/migrate_test.go`

- [ ] **Step 1: 更新 schema.go 基础 DDL 含新列**

在 schema.go 的 tutors DDL 中，`status TEXT DEFAULT 'active' ...` 行之后、`created_at` 之前插入:

```sql
	    user_id TEXT DEFAULT '',
	    audit_status TEXT DEFAULT 'none',
	    audit_note TEXT DEFAULT '',
	    submitted_at DATETIME,
	    cert_images TEXT DEFAULT '[]',
```

（新装数据库一次到位；存量库由 Migrate 补列。）

- [ ] **Step 2: 写失败测试（存量旧库升级 + 回填）**

`backend/database/migrate_test.go`:

```go
package database

import (
	"path/filepath"
	"testing"
)

// legacySchema 模拟升级前的旧表结构（无审核列）
const legacySchema = `
	CREATE TABLE tutors (
	    id TEXT PRIMARY KEY,
	    name TEXT NOT NULL,
	    avatar TEXT DEFAULT '',
	    gender TEXT NOT NULL CHECK(gender IN ('male', 'female')),
	    education TEXT NOT NULL,
	    school TEXT NOT NULL,
	    major TEXT DEFAULT '',
	    subjects TEXT NOT NULL DEFAULT '[]',
	    grades TEXT NOT NULL DEFAULT '[]',
	    hourly_rate INTEGER NOT NULL DEFAULT 0,
	    location TEXT NOT NULL,
	    experience INTEGER DEFAULT 0,
	    verified INTEGER DEFAULT 0,
	    rating REAL DEFAULT 5.0,
	    review_count INTEGER DEFAULT 0,
	    bio TEXT DEFAULT '',
	    wechat_id TEXT NOT NULL,
	    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
	    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
`

func TestMigrateAddsColumnsAndBackfills(t *testing.T) {
	dir := t.TempDir()
	if err := InitDB(filepath.Join(dir, "test.db")); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer CloseDB()

	// 建旧结构并插入一条存量上线档案
	if _, err := DB.Exec(legacySchema); err != nil {
		t.Fatalf("建旧表: %v", err)
	}
	if _, err := DB.Exec(`INSERT INTO tutors (id, name, gender, education, school, location, wechat_id, status)
		VALUES ('t_old', '老王', 'male', '硕士', '某大学', '海淀区', 'w@test', 'active')`); err != nil {
		t.Fatalf("插存量数据: %v", err)
	}

	// 迁移
	if err := Migrate(); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	// 断言: 新列存在且存量上线档案被回填为 approved
	var auditStatus string
	if err := DB.QueryRow("SELECT audit_status FROM tutors WHERE id='t_old'").Scan(&auditStatus); err != nil {
		t.Fatalf("读 audit_status 失败(列不存在?): %v", err)
	}
	if auditStatus != "approved" {
		t.Fatalf("存量档案应回填 approved, 实际 %q", auditStatus)
	}

	// 幂等: 再跑一次不报错
	if err := Migrate(); err != nil {
		t.Fatalf("二次 Migrate 应幂等: %v", err)
	}
}

func TestMigratePartialUniqueIndexBlocksDoublePending(t *testing.T) {
	dir := t.TempDir()
	if err := InitDB(filepath.Join(dir, "test.db")); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer CloseDB()

	if err := EnsureSchema(); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}
	if err := Migrate(); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	ins := func(id string) error {
		_, err := DB.Exec(`INSERT INTO tutors (id, name, gender, education, school, location, wechat_id, user_id, audit_status, status)
			VALUES (?, 'x', 'male', '本科', 'x大学', 'x区', 'w', 'user_a', 'pending', 'inactive')`, id)
		return err
	}
	if err := ins("t_p1"); err != nil {
		t.Fatalf("第一条 pending 应成功: %v", err)
	}
	if err := ins("t_p2"); err == nil {
		t.Fatal("同 user 第二条 pending 应被唯一部分索引拒绝")
	}
}
```

- [ ] **Step 3: 运行确认失败**

Run: `cd backend && go test ./database/ -run TestMigrate -v`
Expected: FAIL（`Migrate` 未定义）

- [ ] **Step 4: 实现 `backend/database/migrate.go`**

```go
package database

import "fmt"

// Migrate 幂等增量迁移: 补列 → 补索引 → 存量回填
func Migrate() error {
	existing := map[string]bool{}
	rows, err := DB.Query("PRAGMA table_info(tutors)")
	if err != nil {
		return fmt.Errorf("读取表结构失败: %w", err)
	}
	for rows.Next() {
		var cid int
		var name, ctype string
		var notNull, pk int
		var dfltValue interface{}
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dfltValue, &pk); err != nil {
			rows.Close()
			return fmt.Errorf("扫描列失败: %w", err)
		}
		existing[name] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("遍历列失败: %w", err)
	}

	additions := []string{
		"ALTER TABLE tutors ADD COLUMN user_id TEXT DEFAULT ''",
		"ALTER TABLE tutors ADD COLUMN audit_status TEXT DEFAULT 'none'",
		"ALTER TABLE tutors ADD COLUMN audit_note TEXT DEFAULT ''",
		"ALTER TABLE tutors ADD COLUMN submitted_at DATETIME",
		"ALTER TABLE tutors ADD COLUMN cert_images TEXT DEFAULT '[]'",
	}
	for _, ddl := range additions {
		col := strings.SplitN(strings.TrimPrefix(ddl, "ALTER TABLE tutors ADD COLUMN "), " ", 2)[0]
		if !existing[col] {
			if _, err := DB.Exec(ddl); err != nil {
				return fmt.Errorf("加列失败 (%s): %w", col, err)
			}
		}
	}

	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_tutors_audit ON tutors(audit_status)",
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_tutors_pending_user ON tutors(user_id) WHERE audit_status = 'pending'",
	}
	for _, ddl := range indexes {
		if _, err := DB.Exec(ddl); err != nil {
			return fmt.Errorf("建索引失败: %w", err)
		}
	}

	// 存量上线档案回填为已核验（none → approved；pending/rejected 不动）
	if _, err := DB.Exec("UPDATE tutors SET audit_status = 'approved' WHERE status = 'active' AND audit_status = 'none'"); err != nil {
		return fmt.Errorf("存量回填失败: %w", err)
	}
	return nil
}
```

在 migrate.go 的 import 中补 `"strings"`。

- [ ] **Step 5: 运行确认通过**

Run: `cd backend && go test ./database/ -v`
Expected: 全部 PASS（schema 1 个 + migrate 2 个）

- [ ] **Step 6: main.go 接入迁移**

main.go 中 `database.EnsureSchema()` 调用之后插入:

```go
	if err := database.Migrate(); err != nil {
		log.Fatalf("❌ 数据库迁移失败: %v", err)
	}
```

- [ ] **Step 7: 启动验证 + Commit**

Run: `cd backend && go build ./... && (go run . &) && sleep 3 && curl -s localhost:8080/health && lsof -ti :8080 | xargs kill`
Expected: health ok

```bash
git add backend/database/migrate.go backend/database/migrate_test.go backend/database/schema.go backend/main.go
git commit -m "feat: idempotent migration adds audit columns, indexes and backfill"
```

---

### Task 3: 家长端可见性过滤（approved 才可见）

**Files:**
- Modify: `backend/handlers/tutors.go`（4 处 WHERE）
- Test: `backend/handlers/testutil_test.go`（新建）、`backend/handlers/visibility_test.go`（新建）

- [ ] **Step 1: 建测试基建**

`backend/handlers/testutil_test.go`:

```go
package handlers

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"tutor-api/database"
	"tutor-api/middleware"
)

// setupTestDB 每个测试独立的临时 SQLite（handlers 依赖全局 database.DB）
func setupTestDB(t *testing.T) {
	t.Helper()
	if err := database.InitDB(filepath.Join(t.TempDir(), "test.db")); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	if err := database.EnsureSchema(); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}
	if err := database.Migrate(); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	t.Cleanup(func() { database.CloseDB() })
}

// newTestRouter 组装被测路由（与本计划最终 main.go 路由一致，随任务追加）
func newTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")
	v1.GET("/tutors", GetTutors)
	v1.GET("/tutors/:id", middleware.OptionalAuth(), GetTutorDetail)
	v1.GET("/tutors/:id/contact", middleware.RequireAuth(), GetTutorContact)
	return r
}

// tokenFor 签发测试 JWT
func tokenFor(t *testing.T, userID, role string) string {
	t.Helper()
	middleware.InitJWT("test-secret")
	tok, err := middleware.GenerateToken(userID, role, 1)
	if err != nil {
		t.Fatalf("签发 token: %v", err)
	}
	return tok
}

// doJSON 便捷请求
func doJSON(r *gin.Engine, method, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code == 0 {
		t.Error("no response")
	}
	_ = http.StatusOK
	return w
}
```

- [ ] **Step 2: 写失败测试**

`backend/handlers/visibility_test.go`:

```go
package handlers

import (
	"encoding/json"
	"testing"
)

// seedTutor 直插一条指定审核状态的档案
func seedTutor(t *testing.T, id, name, auditStatus string) {
	t.Helper()
	_, err := database.DB.Exec(`INSERT INTO tutors
		(id, name, gender, education, school, location, wechat_id, status, audit_status)
		VALUES (?, ?, 'male', '硕士', '某大学', '海淀区', 'w', 'active', ?)`,
		id, name, auditStatus)
	if err != nil {
		t.Fatalf("seed %s: %v", id, err)
	}
}

func TestParentListOnlyShowsApproved(t *testing.T) {
	setupTestDB(t)
	seedTutor(t, "t_ok", "已核验", "approved")
	seedTutor(t, "t_pending", "审核中", "pending")
	seedTutor(t, "t_none", "未走审核", "none")
	r := newTestRouter()

	w := doJSON(r, "GET", "/api/v1/tutors", "")
	var body struct {
		Total int `json:"total"`
		Data  []struct{ ID string `json:"id"` } `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("解析响应: %v", err)
	}
	if body.Total != 1 || len(body.Data) != 1 || body.Data[0].ID != "t_ok" {
		t.Fatalf("家长列表应只见 approved, got total=%d body=%s", body.Total, w.Body.String())
	}
}

func TestParentDetailBlocksUnapproved(t *testing.T) {
	setupTestDB(t)
	seedTutor(t, "t_pending", "审核中", "pending")
	r := newTestRouter()

	w := doJSON(r, "GET", "/api/v1/tutors/t_pending", "")
	if w.Code != 404 {
		t.Fatalf("pending 详情应 404, got %d: %s", w.Code, w.Body.String())
	}
}
```

注意: `import` 需补 `"tutor-api/database"`（visibility_test.go 顶部）。

- [ ] **Step 3: 运行确认失败**

Run: `cd backend && go test ./handlers/ -v`
Expected: FAIL（pending/none 档案目前也返回）

- [ ] **Step 4: 修改 tutors.go 四处 WHERE**

1. `countQuery`（约 118 行）: `"SELECT COUNT(*) FROM tutors WHERE status = 'active'" + whereClause` → `"SELECT COUNT(*) FROM tutors WHERE status = 'active' AND audit_status = 'approved'" + whereClause`
2. 列表查询（约 130 行）: `WHERE status = 'active'` → `WHERE status = 'active' AND audit_status = 'approved'`
3. `GetTutorDetail` 中档案查询的 `WHERE id = ?`（配合其原有条件）→ `WHERE id = ? AND status = 'active' AND audit_status = 'approved'`
4. `GetTutorContact`（约 242 行）: `WHERE id = ? AND status = 'active'` → `WHERE id = ? AND status = 'active' AND audit_status = 'approved'`

- [ ] **Step 5: 运行确认通过**

Run: `cd backend && go test ./handlers/ -v`
Expected: 2 个测试 PASS

- [ ] **Step 6: 全量回归 + Commit**

Run: `cd backend && go test ./... && go build ./...`
Expected: 全部 PASS

```bash
git add backend/handlers/
git commit -m "feat: parent-facing queries only expose approved tutors"
```

---

### Task 4: 申请提交与查询 API（POST/GET mine）

**Files:**
- Create: `backend/models/application.go`、`backend/handlers/tutor_application.go`
- Test: `backend/handlers/tutor_application_test.go`

- [ ] **Step 1: 写模型**

`backend/models/application.go`:

```go
package models

// TutorApplication 入驻申请（tutors 表的审核侧投影）
type TutorApplication struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Gender      string      `json:"gender"`
	Education   string      `json:"education"`
	School      string      `json:"school"`
	Major       string      `json:"major"`
	Subjects    StringArray `json:"subjects"`
	Grades      StringArray `json:"grades"`
	HourlyRate  int         `json:"hourlyRate"`
	Location    string      `json:"location"`
	Experience  int         `json:"experience"`
	Bio         string      `json:"bio"`
	Avatar      string      `json:"avatar"`
	CertImages  StringArray `json:"certImages"`
	AuditStatus string      `json:"auditStatus"`
	AuditNote   string      `json:"auditNote"`
	SubmittedAt string      `json:"submittedAt"`
	WechatID    string      `json:"wechatId"`
}
```

- [ ] **Step 2: 写失败测试**

`backend/handlers/tutor_application_test.go`:

```go
package handlers

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func applyRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")
	v1.POST("/tutor-applications", middleware.RequireAuth(), SubmitTutorApplication)
	v1.GET("/tutor-applications/mine", middleware.RequireAuth(), GetMyApplication)
	return r
}

func postApply(r *gin.Engine, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/api/v1/tutor-applications", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

const validApplyBody = `{
	"name":"王雨桐","gender":"female","education":"硕士","school":"华东师范大学",
	"major":"数学","subjects":["数学"],"grades":["高中"],"hourlyRate":180,
	"location":"上海市杨浦区","experience":5,
	"bio":"市重点中学在职教师，十五年教龄，讲课逻辑清晰，善于从错题反推知识漏洞。",
	"certImages":["/uploads/cert-1.jpg"],"wechatId":"wangyutong"
}`

func TestSubmitCreatesPendingApplication(t *testing.T) {
	setupTestDB(t)
	r := applyRouter()
	tok := tokenFor(t, "user_a", "user")

	w := postApply(r, tok, validApplyBody)
	if w.Code != 200 {
		t.Fatalf("期望 200, got %d: %s", w.Code, w.Body.String())
	}
	var auditStatus string
	err := database.DB.QueryRow(
		"SELECT audit_status FROM tutors WHERE user_id='user_a'").Scan(&auditStatus)
	if err != nil {
		t.Fatalf("未找到申请记录: %v", err)
	}
	if auditStatus != "pending" {
		t.Fatalf("期望 pending, got %q", auditStatus)
	}
}

func TestSubmitValidationErrorsAreFieldLevel(t *testing.T) {
	setupTestDB(t)
	r := applyRouter()
	tok := tokenFor(t, "user_b", "user")

	w := postApply(r, tok, `{"name":"","hourlyRate":10,"subjects":[],"bio":"短"}`)
	if w.Code != 400 {
		t.Fatalf("期望 400, got %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Errors map[string]string `json:"errors"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("解析: %v", err)
	}
	for _, field := range []string{"name", "hourlyRate", "subjects", "bio"} {
		if body.Errors[field] == "" {
			t.Fatalf("字段 %s 缺少错误信息: %s", field, w.Body.String())
		}
	}
}

func TestSecondPendingSubmitConflicts(t *testing.T) {
	setupTestDB(t)
	r := applyRouter()
	tok := tokenFor(t, "user_a", "user")

	if w := postApply(r, tok, validApplyBody); w.Code != 200 {
		t.Fatalf("首次提交: %d %s", w.Code, w.Body.String())
	}
	w := postApply(r, tok, validApplyBody)
	if w.Code != 409 {
		t.Fatalf("重复 pending 应 409, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRejectedCanResubmit(t *testing.T) {
	setupTestDB(t)
	r := applyRouter()
	tok := tokenFor(t, "user_a", "user")

	if w := postApply(r, tok, validApplyBody); w.Code != 200 {
		t.Fatalf("首次提交: %d %s", w.Code, w.Body.String())
	}
	if _, err := database.DB.Exec(
		"UPDATE tutors SET audit_status='rejected', audit_note='凭证不清' WHERE user_id='user_a'"); err != nil {
		t.Fatal(err)
	}
	w := postApply(r, tok, validApplyBody)
	if w.Code != 200 {
		t.Fatalf("驳回后重提应 200, got %d: %s", w.Code, w.Body.String())
	}
	var status, note string
	if err := database.DB.QueryRow(
		"SELECT audit_status, audit_note FROM tutors WHERE user_id='user_a'").Scan(&status, &note); err != nil {
		t.Fatal(err)
	}
	if status != "pending" {
		t.Fatalf("重提后应回 pending, got %q", status)
	}
}

func TestGetMineReturnsStatus(t *testing.T) {
	setupTestDB(t)
	r := applyRouter()
	tok := tokenFor(t, "user_a", "user")

	if w := postApply(r, tok, validApplyBody); w.Code != 200 {
		t.Fatalf("提交: %d %s", w.Code, w.Body.String())
	}
	w := doJSON(r, "GET", "/api/v1/tutor-applications/mine", tok)
	if w.Code != 200 {
		t.Fatalf("mine: %d %s", w.Code, w.Body.String())
	}
	var body struct {
		AuditStatus string `json:"auditStatus"`
		AuditNote   string `json:"auditNote"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.AuditStatus != "pending" {
		t.Fatalf("期望 pending, got %q (%s)", body.AuditStatus, w.Body.String())
	}
}

func TestGetMineEmptyReturnsNone(t *testing.T) {
	setupTestDB(t)
	r := applyRouter()
	tok := tokenFor(t, "user_nobody", "user")

	w := doJSON(r, "GET", "/api/v1/tutor-applications/mine", tok)
	if w.Code != 200 {
		t.Fatalf("mine: %d", w.Code)
	}
	if !bytes.Contains(w.Body.Bytes(), []byte(`"auditStatus":"none"`)) {
		t.Fatalf("空申请应返回 none: %s", w.Body.String())
	}
}

func TestApprovedEditReturnsToPending(t *testing.T) {
	setupTestDB(t)
	r := applyRouter()
	tok := tokenFor(t, "user_a", "user")

	if w := postApply(r, tok, validApplyBody); w.Code != 200 {
		t.Fatalf("首次提交: %d %s", w.Code, w.Body.String())
	}
	if _, err := database.DB.Exec(
		"UPDATE tutors SET audit_status='approved', status='active' WHERE user_id='user_a'"); err != nil {
		t.Fatal(err)
	}
	w := postApply(r, tok, validApplyBody)
	if w.Code != 200 {
		t.Fatalf("已通过档案编辑: %d %s", w.Code, w.Body.String())
	}
	var status, tutorStatus string
	database.DB.QueryRow("SELECT audit_status, status FROM tutors WHERE user_id='user_a'").Scan(&status, &tutorStatus)
	if status != "pending" || tutorStatus != "active" {
		t.Fatalf("编辑后应 pending+active(家长端仍可见), got %s/%s", status, tutorStatus)
	}
}
```

`import` 需补 `"tutor-api/database"` 与 `"tutor-api/middleware"`。

- [ ] **Step 3: 运行确认失败**

Run: `cd backend && go test ./handlers/ -run TestSubmit -v && go test ./handlers/ -run TestGetMine -v`
Expected: FAIL（`SubmitTutorApplication` 未定义）

- [ ] **Step 4: 实现 `backend/handlers/tutor_application.go`**

```go
package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"tutor-api/database"
	"tutor-api/models"
)

// TutorApplicationRequest 入驻申请请求体
type TutorApplicationRequest struct {
	Name       string   `json:"name"`
	Gender     string   `json:"gender"`
	Education  string   `json:"education"`
	School     string   `json:"school"`
	Major      string   `json:"major"`
	Subjects   []string `json:"subjects"`
	Grades     []string `json:"grades"`
	HourlyRate int      `json:"hourlyRate"`
	Location   string   `json:"location"`
	Experience int      `json:"experience"`
	Bio        string   `json:"bio"`
	Avatar     string   `json:"avatar"`
	CertImages []string `json:"certImages"`
	WechatID   string   `json:"wechatId"`
}

// validateApplication 字段级校验（规格 §6）
func validateApplication(req *TutorApplicationRequest) map[string]string {
	errs := map[string]string{}
	if strings.TrimSpace(req.Name) == "" {
		errs["name"] = "请填写姓名"
	}
	if req.Gender != "male" && req.Gender != "female" {
		errs["gender"] = "请选择性别"
	}
	if req.Education == "" {
		errs["education"] = "请选择学历"
	}
	if strings.TrimSpace(req.School) == "" {
		errs["school"] = "请填写学校"
	}
	if len(req.Subjects) == 0 {
		errs["subjects"] = "请至少选择一个科目"
	}
	if len(req.Grades) == 0 {
		errs["grades"] = "请至少选择一个年级"
	}
	if req.HourlyRate < 50 || req.HourlyRate > 500 {
		errs["hourlyRate"] = "时薪需在 50-500 元之间"
	}
	if strings.TrimSpace(req.Location) == "" {
		errs["location"] = "请填写所在地"
	}
	bioLen := len([]rune(strings.TrimSpace(req.Bio)))
	if bioLen < 30 || bioLen > 500 {
		errs["bio"] = "简介需 30-500 字"
	}
	if len(req.CertImages) == 0 {
		errs["certImages"] = "请至少上传一张资质凭证"
	}
	return errs
}

// SubmitTutorApplication 创建并提交申请 / 驳回后重提 / 已通过档案编辑重审
// POST /api/v1/tutor-applications
func SubmitTutorApplication(c *gin.Context) {
	userID := c.GetString("userId")

	var req TutorApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据无效: " + err.Error()})
		return
	}
	if errs := validateApplication(&req); len(errs) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"errors": errs})
		return
	}

	var tutorID, auditStatus string
	err := database.DB.QueryRow(
		"SELECT id, audit_status FROM tutors WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1",
		userID,
	).Scan(&tutorID, &auditStatus)

	switch {
	case err == sql.ErrNoRows:
		// 首次入驻: 新建档案（inactive，审核通过才 active）
		newID := "tutor_" + uuid.New().String()[:8]
		_, e := database.DB.Exec(`INSERT INTO tutors
			(id, name, avatar, gender, education, school, major, subjects, grades,
			 hourly_rate, location, experience, verified, rating, review_count,
			 bio, wechat_id, status, user_id, audit_status, submitted_at, cert_images)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,5.0,0,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`,
			newID, req.Name, req.Avatar, req.Gender, req.Education, req.School, req.Major,
			models.StringArray(req.Subjects), models.StringArray(req.Grades),
			req.HourlyRate, req.Location, req.Experience,
			req.Bio, req.WechatID, "inactive", userID, "pending",
			models.StringArray(req.CertImages))
		if e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "提交申请失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"id": newID, "auditStatus": "pending"})
		return

	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询申请失败"})
		return
	}

	// 已有记录
	if auditStatus == "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "已有待审核的申请，请等待审核结果"})
		return
	}

	// rejected → 重新提交；approved → 编辑重审（编辑即时可见，见规格 §4）
	_, e := database.DB.Exec(`UPDATE tutors SET
		name=?, avatar=?, gender=?, education=?, school=?, major=?, subjects=?, grades=?,
		hourly_rate=?, location=?, experience=?, bio=?, wechat_id=?, cert_images=?,
		audit_status='pending', audit_note='', submitted_at=CURRENT_TIMESTAMP
		WHERE id=?`,
		req.Name, req.Avatar, req.Gender, req.Education, req.School, req.Major,
		models.StringArray(req.Subjects), models.StringArray(req.Grades),
		req.HourlyRate, req.Location, req.Experience, req.Bio, req.WechatID,
		models.StringArray(req.CertImages), tutorID)
	if e != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新申请失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": tutorID, "auditStatus": "pending"})
}

// GetMyApplication 本人申请状态
// GET /api/v1/tutor-applications/mine
func GetMyApplication(c *gin.Context) {
	userID := c.GetString("userId")

	var app models.TutorApplication
	err := database.DB.QueryRow(`SELECT id, name, gender, education, school, major,
		subjects, grades, hourly_rate, location, experience, bio, avatar, cert_images,
		audit_status, audit_note, COALESCE(submitted_at,''), wechat_id
		FROM tutors WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1`, userID,
	).Scan(&app.ID, &app.Name, &app.Gender, &app.Education, &app.School, &app.Major,
		&app.Subjects, &app.Grades, &app.HourlyRate, &app.Location, &app.Experience,
		&app.Bio, &app.Avatar, &app.CertImages,
		&app.AuditStatus, &app.AuditNote, &app.SubmittedAt, &app.WechatID)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, gin.H{"auditStatus": "none"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询申请失败"})
		return
	}
	c.JSON(http.StatusOK, app)
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd backend && go test ./handlers/ -v`
Expected: 本任务 6 个 + Task 3 的 2 个全 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/models/application.go backend/handlers/tutor_application.go backend/handlers/tutor_application_test.go
git commit -m "feat: tutor application submit and status query APIs"
```

---

### Task 5: 图片上传 API

**Files:**
- Create: `backend/handlers/upload.go`
- Modify: `.gitignore`（Task 0 已含 `backend/uploads/`）
- Test: `backend/handlers/upload_test.go`

- [ ] **Step 1: 写失败测试**

`backend/handlers/upload_test.go`:

```go
package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func uploadRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")
	v1.POST("/tutor-applications/images", middleware.RequireAuth(), UploadApplicationImage)
	return r
}

func multipartBody(t *testing.T, filename string, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("image", filename)
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(content)
	w.Close()
	return &buf, w.FormDataContentType()
}

func TestUploadAcceptsPNG(t *testing.T) {
	setupTestDB(t)
	uploadsDir = t.TempDir()
	r := uploadRouter()
	tok := tokenFor(t, "user_u", "user")

	// 真实 PNG 头 + 内容
	png := append([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, make([]byte, 100)...)
	body, ctype := multipartBody(t, "cert.png", png)
	req := httptest.NewRequest("POST", "/api/v1/tutor-applications/images", body)
	req.Header.Set("Content-Type", ctype)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("期望 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("解析响应: %v", err)
	}
	if resp.URL == "" || filepath.Ext(resp.URL) != ".png" {
		t.Fatalf("应返回 .png URL: %s", w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(uploadsDir, filepath.Base(resp.URL))); err != nil {
		t.Fatalf("文件未落盘: %v", err)
	}
}

func TestUploadRejectsWrongType(t *testing.T) {
	setupTestDB(t)
	uploadsDir = t.TempDir()
	r := uploadRouter()
	tok := tokenFor(t, "user_u", "user")

	body, ctype := multipartBody(t, "evil.gif", []byte("GIF89axxxx"))
	req := httptest.NewRequest("POST", "/api/v1/tutor-applications/images", body)
	req.Header.Set("Content-Type", ctype)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Fatalf("gif 应 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUploadRejectsOversize(t *testing.T) {
	setupTestDB(t)
	uploadsDir = t.TempDir()
	r := uploadRouter()
	tok := tokenFor(t, "user_u", "user")

	big := append([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, make([]byte, 6*1024*1024)...)
	body, ctype := multipartBody(t, "big.png", big)
	req := httptest.NewRequest("POST", "/api/v1/tutor-applications/images", body)
	req.Header.Set("Content-Type", ctype)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Fatalf(">5MB 应 400, got %d", w.Code)
	}
}
```

（首行 import 修正为 `"bytes"`，上面 `boundary "bytes"` 为笔误勿照抄。）

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && go test ./handlers/ -run TestUpload -v`
Expected: FAIL（`UploadApplicationImage`、`uploadsDir` 未定义）

- [ ] **Step 3: 实现 `backend/handlers/upload.go`**

```go
package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// uploadsDir 上传目录（测试可覆盖）
var uploadsDir = "uploads"

const maxImageBytes = 5 * 1024 * 1024 // 5MB

// UploadApplicationImage 上传资质/头像图片
// POST /api/v1/tutor-applications/images  (multipart, field: image)
func UploadApplicationImage(c *gin.Context) {
	file, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择图片文件"})
		return
	}
	if file.Size > maxImageBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "图片不能超过 5MB"})
		return
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{".jpg": true, ".jpeg": true, ".png": true}
	if !allowedExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 JPG/PNG 格式"})
		return
	}

	// 内容嗅探双重校验（防扩展名伪装）
	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "读取文件失败"})
		return
	}
	head := make([]byte, 512)
	n, _ := f.Read(head)
	f.Close()
	ctype := http.DetectContentType(head[:n])
	if ctype != "image/jpeg" && ctype != "image/png" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件内容不是有效的 JPG/PNG 图片"})
		return
	}

	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建上传目录失败"})
		return
	}
	name := uuid.New().String() + ext // uuid 命名: 防穿越/防覆盖
	if err := c.SaveUploadedFile(file, filepath.Join(uploadsDir, name)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存文件失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": "/uploads/" + name})
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && go test ./handlers/ -run TestUpload -v`
Expected: 3 个 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/handlers/upload.go backend/handlers/upload_test.go
git commit -m "feat: image upload API with type/size validation"
```

---

### Task 6: 管理员审核 API（列表/通过/驳回）

**Files:**
- Create: `backend/handlers/admin_audit.go`
- Modify: `backend/handlers/testutil_test.go`（admin 路由加入 newTestRouter 之外的独立 router）
- Test: `backend/handlers/admin_audit_test.go`

- [ ] **Step 1: 写失败测试**

`backend/handlers/admin_audit_test.go`:

```go
package handlers

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"tutor-api/database"
	"tutor-api/middleware"
)

func auditRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")
	v1.GET("/admin/tutor-applications", middleware.RequireAuth(), middleware.RequireAdmin(), ListApplications)
	v1.POST("/admin/tutor-applications/:id/approve", middleware.RequireAuth(), middleware.RequireAdmin(), ApproveApplication)
	v1.POST("/admin/tutor-applications/:id/reject", middleware.RequireAuth(), middleware.RequireAdmin(), RejectApplication)
	return r
}

func postAdmin(r *gin.Engine, tok, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestNonAdminBlocked(t *testing.T) {
	setupTestDB(t)
	r := auditRouter()
	tok := tokenFor(t, "user_plain", "user")
	w := doJSON(r, "GET", "/api/v1/admin/tutor-applications", tok)
	if w.Code != 403 {
		t.Fatalf("非管理员应 403, got %d", w.Code)
	}
}

func TestListPendingApplications(t *testing.T) {
	setupTestDB(t)
	seedTutor(t, "t_p", "待审", "pending")
	seedTutor(t, "t_a", "已过", "approved")
	r := auditRouter()
	tok := tokenFor(t, "user_admin", "admin")

	w := doJSON(r, "GET", "/api/v1/admin/tutor-applications?status=pending", tok)
	if w.Code != 200 {
		t.Fatalf("list: %d %s", w.Code, w.Body.String())
	}
	var body struct {
		Total int `json:"total"`
		Data  []struct {
			ID          string `json:"id"`
			AuditStatus string `json:"auditStatus"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &body)
	if body.Total != 1 || body.Data[0].ID != "t_p" {
		t.Fatalf("应只列 pending: %s", w.Body.String())
	}
}

func TestApproveActivatesTutor(t *testing.T) {
	setupTestDB(t)
	seedTutor(t, "t_p", "待审", "pending")
	r := auditRouter()
	admin := tokenFor(t, "user_admin", "admin")

	w := postAdmin(r, admin, "/api/v1/admin/tutor-applications/t_p/approve", "")
	if w.Code != 200 {
		t.Fatalf("approve: %d %s", w.Code, w.Body.String())
	}
	var status, tutorStatus string
	database.DB.QueryRow("SELECT audit_status, status FROM tutors WHERE id='t_p'").Scan(&status, &tutorStatus)
	if status != "approved" || tutorStatus != "active" {
		t.Fatalf("通过后应 approved+active, got %s/%s", status, tutorStatus)
	}
	// 幂等：再通过一次仍 200
	if w := postAdmin(r, admin, "/api/v1/admin/tutor-applications/t_p/approve", ""); w.Code != 200 {
		t.Fatalf("重复 approve 应幂等 200, got %d", w.Code)
	}
}

func TestRejectRequiresNote(t *testing.T) {
	setupTestDB(t)
	seedTutor(t, "t_p", "待审", "pending")
	r := auditRouter()
	admin := tokenFor(t, "user_admin", "admin")

	if w := postAdmin(r, admin, "/api/v1/admin/tutor-applications/t_p/reject", `{"note":""}`); w.Code != 400 {
		t.Fatalf("空原因应 400, got %d", w.Code)
	}
	if w := postAdmin(r, admin, "/api/v1/admin/tutor-applications/t_p/reject", `{"note":"凭证照片模糊，请重传"}`); w.Code != 200 {
		t.Fatalf("驳回: %d %s", w.Code, w.Body.String())
	}
	var status, note string
	database.DB.QueryRow("SELECT audit_status, audit_note FROM tutors WHERE id='t_p'").Scan(&status, &note)
	if status != "rejected" || note != "凭证照片模糊，请重传" {
		t.Fatalf("驳回状态/原因不符: %s / %s", status, note)
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && go test ./handlers/ -run "TestNonAdmin|TestListPending|TestApprove|TestReject" -v`
Expected: FAIL（三个 handler 未定义）

- [ ] **Step 3: 实现 `backend/handlers/admin_audit.go`**

```go
package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"tutor-api/database"
	"tutor-api/models"
)

// ListApplications 审核列表
// GET /api/v1/admin/tutor-applications?status=pending&page=1&pageSize=20
func ListApplications(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")
	page := atoiDefault(c.Query("page"), 1)
	pageSize := atoiDefault(c.Query("pageSize"), 20)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}

	var total int
	if err := database.DB.QueryRow(
		"SELECT COUNT(*) FROM tutors WHERE audit_status = ?", status,
	).Scan(&total); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询总数失败"})
		return
	}

	rows, err := database.DB.Query(`SELECT id, name, gender, education, school, major,
		subjects, grades, hourly_rate, location, experience, bio, avatar, cert_images,
		audit_status, audit_note, COALESCE(submitted_at,''), wechat_id
		FROM tutors WHERE audit_status = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?`,
		status, pageSize, (page-1)*pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询列表失败"})
		return
	}
	defer rows.Close()

	list := []models.TutorApplication{}
	for rows.Next() {
		var app models.TutorApplication
		if err := rows.Scan(&app.ID, &app.Name, &app.Gender, &app.Education, &app.School,
			&app.Major, &app.Subjects, &app.Grades, &app.HourlyRate, &app.Location,
			&app.Experience, &app.Bio, &app.Avatar, &app.CertImages,
			&app.AuditStatus, &app.AuditNote, &app.SubmittedAt, &app.WechatID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "解析列表失败"})
			return
		}
		list = append(list, app)
	}
	c.JSON(http.StatusOK, gin.H{"total": total, "page": page, "perPage": pageSize, "data": list})
}

// ApproveApplication 通过申请
// POST /api/v1/admin/tutor-applications/:id/approve
func ApproveApplication(c *gin.Context) {
	id := c.Param("id")

	var status string
	err := database.DB.QueryRow(
		"SELECT audit_status FROM tutors WHERE id = ?", id,
	).Scan(&status)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "申请不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	if status == "approved" {
		c.JSON(http.StatusOK, gin.H{"id": id, "auditStatus": "approved"}) // 幂等
		return
	}
	if status != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "该申请当前不可通过（状态: " + status + "）"})
		return
	}

	if _, err := database.DB.Exec(
		"UPDATE tutors SET audit_status='approved', status='active', audit_note='' WHERE id=?", id,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "auditStatus": "approved"})
}

// RejectApplication 驳回申请（必附原因）
// POST /api/v1/admin/tutor-applications/:id/reject
func RejectApplication(c *gin.Context) {
	id := c.Param("id")

	var req struct {
		Note string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Note) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写驳回原因（1-200 字）"})
		return
	}
	noteLen := len([]rune(strings.TrimSpace(req.Note)))
	if noteLen > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "驳回原因不能超过 200 字"})
		return
	}

	res, err := database.DB.Exec(
		"UPDATE tutors SET audit_status='rejected', audit_note=? WHERE id=? AND audit_status='pending'",
		strings.TrimSpace(req.Note), id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "申请不存在或状态已变更"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "auditStatus": "rejected"})
}

// atoiDefault 字符串转 int，失败给默认值
func atoiDefault(s string, d int) int {
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return d
		}
		n = n*10 + int(ch-'0')
	}
	if s == "" {
		return d
	}
	return n
}
```

- [ ] **Step 4: 运行确认通过 + Commit**

Run: `cd backend && go test ./... && go build ./...`
Expected: 全 PASS

```bash
git add backend/handlers/admin_audit.go backend/handlers/admin_audit_test.go
git commit -m "feat: admin audit APIs (list/approve/reject)"
```

---

### Task 7: 路由接线 + 静态目录 + 端到端冒烟

**Files:**
- Modify: `backend/main.go`（路由注册 + uploads 静态目录）

- [ ] **Step 1: 注册路由与静态目录**

main.go 中 `v1` 组内（`POST /auth/login` 之后）追加:

```go
		// 入驻系统
		v1.POST("/tutor-applications", middleware.RequireAuth(), handlers.SubmitTutorApplication)
		v1.GET("/tutor-applications/mine", middleware.RequireAuth(), handlers.GetMyApplication)
		v1.POST("/tutor-applications/images", middleware.RequireAuth(), handlers.UploadApplicationImage)
		v1.GET("/admin/tutor-applications", middleware.RequireAuth(), middleware.RequireAdmin(), handlers.ListApplications)
		v1.POST("/admin/tutor-applications/:id/approve", middleware.RequireAuth(), middleware.RequireAdmin(), handlers.ApproveApplication)
		v1.POST("/admin/tutor-applications/:id/reject", middleware.RequireAuth(), middleware.RequireAdmin(), handlers.RejectApplication)
```

router 创建之后、路由之前加静态目录:

```go
	router.Static("/uploads", "./uploads")
```

- [ ] **Step 2: 端到端冒烟（真实 HTTP 全链路）**

Run: `cd backend && go build ./... && (go run . &) && sleep 3`，然后按顺序执行（每步标注期望结果）:

```bash
# ① 家教账号登录（dev mock: 任意 code）
TOKEN=$(curl -s -X POST localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"code":"dev_tutor_001"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# ② 提交入驻申请 → 期望 {"id":"tutor_xxx","auditStatus":"pending"}
curl -s -X POST localhost:8080/api/v1/tutor-applications -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"测试家教","gender":"female","education":"硕士","school":"某大学","major":"数学","subjects":["数学"],"grades":["高中"],"hourlyRate":150,"location":"杨浦区","experience":3,"bio":"测试简介需要满三十个字，这里补充一些描述内容以便通过校验规则。","certImages":["/uploads/x.jpg"],"wechatId":"t_w"}'

# ③ 家长端列表此时应看不到"测试家教"（pending 不可见）
curl -s "localhost:8080/api/v1/tutors" | grep -c 测试家教   # 期望 0

# ④ 提权为管理员并重新登录拿新 token（role 写在 JWT 里）
sqlite3 database/tutors.db "UPDATE users SET role='admin' WHERE openid='dev_openid_dev_tutor_001'"
ADMIN=$(curl -s -X POST localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"code":"dev_tutor_001"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# ⑤ 审核列表应含该申请 → 拿到 id
APPID=$(curl -s "localhost:8080/api/v1/admin/tutor-applications?status=pending" \
  -H "Authorization: Bearer $ADMIN" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")

# ⑥ 通过 → 期望 {"auditStatus":"approved"}；列表此时应能看到"测试家教"
curl -s -X POST "localhost:8080/api/v1/admin/tutor-applications/$APPID/approve" -H "Authorization: Bearer $ADMIN"
curl -s "localhost:8080/api/v1/tutors" | python3 -c "import sys,json;d=json.load(sys.stdin);print([t['name'] for t in d['data']])"

# ⑦ 收尾: 停服务
lsof -ti :8080 | xargs kill
```

Expected: ② 200 pending；③ 0；⑥ 名单含"测试家教"。

- [ ] **Step 3: Commit**

```bash
git add backend/main.go
git commit -m "feat: wire onboarding routes and uploads static serving"
```

---

### Task 8: 小程序登录与上传工具函数

**Files:**
- Modify: `miniprogram/utils/api.js`

- [ ] **Step 1: 追加登录/上传/申请封装**

api.js 末尾 `module.exports` 之前追加:

```js
/**
 * 微信登录（wx.login → code → 后端换 JWT），并持久化
 */
const login = () => new Promise((resolve, reject) => {
  wx.login({
    success: (res) => {
      if (!res.code) { reject(new Error('wx.login 未返回 code')); return }
      request('POST', '/auth/login', { code: res.code }).then((data) => {
        const app = getApp()
        app.globalData.token = data.token
        app.globalData.userId = data.userId
        app.globalData.role = data.role
        wx.setStorageSync('token', data.token)
        wx.setStorageSync('userId', data.userId)
        wx.setStorageSync('role', data.role)
        resolve(data)
      }).catch(reject)
    },
    fail: reject
  })
})

/**
 * 确保已登录（storage 恢复 → 必要时静默登录）
 */
const ensureLogin = async () => {
  const app = getApp()
  if (!app.globalData.token) {
    app.globalData.token = wx.getStorageSync('token') || null
    app.globalData.role = wx.getStorageSync('role') || null
    app.globalData.userId = wx.getStorageSync('userId') || null
  }
  if (!app.globalData.token) {
    await login()
  }
  return app.globalData
}

/**
 * 上传图片（wx.uploadFile，独立于 request 的 multipart 流程）
 */
const uploadImage = (filePath) => new Promise((resolve, reject) => {
  const app = getApp()
  wx.uploadFile({
    url: app.globalData.apiBaseUrl + '/tutor-applications/images',
    filePath,
    name: 'image',
    header: {
      Authorization: app.globalData.token ? 'Bearer ' + app.globalData.token : ''
    },
    success: (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(JSON.parse(res.data).url)
      } else {
        let msg = '上传失败'
        try { msg = JSON.parse(res.data).error || msg } catch (e) {}
        wx.showToast({ title: msg, icon: 'none' })
        reject(res)
      }
    },
    fail: reject
  })
})

/**
 * 提交入驻申请
 */
const submitApplication = (data) => request('POST', '/tutor-applications', data)

/**
 * 查询我的申请
 */
const getMyApplication = () => request('GET', '/tutor-applications/mine')

/**
 * 管理员: 待审列表 / 通过 / 驳回
 */
const listApplications = (status = 'pending') => request('GET', `/admin/tutor-applications?status=${status}`)
const approveApplication = (id) => request('POST', `/admin/tutor-applications/${id}/approve`)
const rejectApplication = (id, note) => request('POST', `/admin/tutor-applications/${id}/reject`, { note })
```

`module.exports` 更新为:

```js
module.exports = {
  getTutors,
  getTutorDetail,
  submitReview,
  createTutor,
  getTutorContact,
  login,
  ensureLogin,
  uploadImage,
  submitApplication,
  getMyApplication,
  listApplications,
  approveApplication,
  rejectApplication
}
```

- [ ] **Step 2: 语法自检**

Run: `node --check miniprogram/utils/api.js`
Expected: 无输出（语法通过）

- [ ] **Step 3: Commit**

```bash
git add miniprogram/utils/api.js
git commit -m "feat: miniprogram login/upload/application api helpers"
```

---

### Task 9: 「我的」页（角色分发 + 申请状态卡）

**Files:**
- Create: `miniprogram/pages/mine/mine.{js,json,wxml,wxss}`
- Modify: `miniprogram/app.json`（页面注册 + tab，图标 Task 12 补——先注册页面，tab 条目在本任务一并加，图标文件 Task 12 生成前 DevTools 会缺图警告，可接受）

- [ ] **Step 1: 注册页面与 tab**

app.json `pages` 数组加 `"pages/mine/mine"`；`tabBar.list` 追加:

```json
        {
          "pagePath": "pages/mine/mine",
          "text": "我的",
          "iconPath": "images/mine.png",
          "selectedIconPath": "images/mine-active.png"
        }
```

- [ ] **Step 2: 页面四件套**

`mine.json`:

```json
{
  "navigationBarTitleText": "我的"
}
```

`mine.js`:

```js
const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    loggedIn: false,
    role: 'user',
    application: null,   // {auditStatus, auditNote, name, ...} 或 null
    pendingCount: 0
  },

  onLoad() {
    this.init()
  },

  onShow() {
    if (this.data.loggedIn) { this.refresh() }
  },

  async init() {
    try {
      const g = await api.ensureLogin()
      this.setData({ loggedIn: true, role: g.role || 'user', loading: false })
      this.refresh()
    } catch (e) {
      this.setData({ loading: false, loggedIn: false })
    }
  },

  async refresh() {
    try {
      const app = await api.getMyApplication()
      const application = app.auditStatus === 'none' ? null : app
      this.setData({ application })
      if (this.data.role === 'admin') { this.loadPendingCount() }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async loadPendingCount() {
    try {
      const res = await api.listApplications('pending')
      this.setData({ pendingCount: res.total })
    } catch (e) { /* 静默 */ }
  },

  onLogin() { this.init() },

  goApply() { wx.navigateTo({ url: '/pages/apply/apply' }) },
  goAdmin() { wx.navigateTo({ url: '/pages/admin-audit/admin-audit' }) },
  goMyProfile() {
    const app = this.data.application
    wx.navigateTo({ url: '/pages/tutor-detail/tutor-detail?id=' + app.id })
  }
})
```

`mine.wxml`:

```xml
<view class="container">
  <view class="masthead">
    <text class="masthead-title">我的</text>
    <text class="masthead-issue">家教公报</text>
  </view>

  <view wx:if="{{loading}}" class="state-box"><text class="state-copy">调阅中</text></view>

  <view wx:elif="{{!loggedIn}}" class="state-box">
    <text class="state-kicker">启事</text>
    <text class="state-copy">登录后使用</text>
    <view class="state-btn" bindtap="onLogin">微信登录</view>
  </view>

  <block wx:else>
    <!-- 家教: 申请状态卡 -->
    <view class="sheet status-card" wx:if="{{application}}">
      <view class="status-line">
        <text class="status-label">入驻状态</text>
        <text class="status-value {{application.auditStatus}}">{{application.auditStatus === 'approved' ? '已通过' : application.auditStatus === 'pending' ? '审核中' : '已驳回'}}</text>
      </view>
      <view wx:if="{{application.auditNote}}" class="audit-note">核验意见：{{application.auditNote}}</view>
      <view class="status-actions">
        <view wx:if="{{application.auditStatus === 'approved'}}" class="link-action" bindtap="goMyProfile">查看我的档案</view>
        <view wx:if="{{application.auditStatus !== 'pending'}}" class="link-action" bindtap="goApply">{{application.auditStatus === 'approved' ? '编辑档案' : '重新提交'}}</view>
      </view>
    </view>

    <!-- 未入驻: 入驻引导 -->
    <view class="sheet status-card" wx:else>
      <view class="status-line">
        <text class="status-label">教师入驻</text>
        <text class="status-value">未入驻</text>
      </view>
      <view class="apply-guide">填写教学资料，经核验后刊入本期名录</view>
      <view class="state-btn" bindtap="goApply">申请入驻</view>
    </view>

    <!-- 管理员入口 -->
    <view class="sheet admin-card" wx:if="{{role === 'admin'}}" bindtap="goAdmin">
      <view class="status-line">
        <text class="status-label">公报编辑部</text>
        <text class="status-value">待审 {{pendingCount}} 件</text>
      </view>
      <view class="link-action">进入审核 →</view>
    </view>
  </block>
</view>
```

`mine.wxss`:

```css
.status-card { padding: 30rpx; margin-top: 28rpx; }
.status-line { display: flex; justify-content: space-between; align-items: baseline; }
.status-label { font-size: var(--fs-sub); color: var(--ink-soft); letter-spacing: 4rpx; }
.status-value { font-family: var(--serif); font-weight: 900; font-size: 34rpx; color: var(--ink); }
.status-value.pending { color: var(--ink-green); }
.status-value.rejected { color: var(--seal); }
.audit-note { margin-top: 16rpx; font-size: var(--fs-sub); color: var(--ink-soft); line-height: 1.7; border-top: 1rpx solid var(--line); padding-top: 16rpx; }
.status-actions { display: flex; gap: 32rpx; margin-top: 20rpx; }
.link-action { color: var(--ink-green); font-size: var(--fs-sub); letter-spacing: 2rpx; }
.apply-guide { margin-top: 14rpx; font-size: var(--fs-sub); color: var(--ink-soft); line-height: 1.7; }
.status-card .state-btn { margin-top: 28rpx; }
.admin-card { margin-top: 24rpx; }
```

- [ ] **Step 3: 语法自检 + Commit**

Run: `node --check miniprogram/pages/mine/mine.js`

```bash
git add miniprogram/pages/mine/ miniprogram/app.json
git commit -m "feat: mine page with application status card and admin entry"
```

---

### Task 10: 入驻申请页（四步表单）

**Files:**
- Create: `miniprogram/pages/apply/apply.{js,json,wxml,wxss}`

- [ ] **Step 1: 注册页面**

app.json `pages` 加 `"pages/apply/apply"`（不加 tab）。

- [ ] **Step 2: 页面四件套**

`apply.json`:

```json
{
  "navigationBarTitleText": "教师入驻"
}
```

`apply.js`:

```js
const api = require('../../utils/api')

const EDU_OPTIONS = ['本科', '硕士', '博士']
const SUBJECT_OPTIONS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '全科']
const GRADE_OPTIONS = ['小学', '初中', '高中']

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
    eduOptions: EDU_OPTIONS,
    subjectOptions: SUBJECT_OPTIONS,
    gradeOptions: GRADE_OPTIONS
  },

  onLoad() { this.init() },

  async init() {
    try {
      await api.ensureLogin()
      // 已有档案 → 带入内容（编辑/重提场景）
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
          }
        })
      }
    } catch (e) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      wx.navigateBack()
    }
  },

  /* —— 通用输入 —— */
  onField(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value, [`errors.${field}`]: '' })
  },
  onPickGender(e) { this.setData({ 'form.gender': e.currentTarget.dataset.value, 'errors.gender': '' }) },
  onPickEdu(e) { this.setData({ 'form.education': e.currentTarget.dataset.value, 'errors.education': '' }) },
  toggleSubject(e) { this.toggleList('subjects', e.currentTarget.dataset.value) },
  toggleGrade(e) { this.toggleList('grades', e.currentTarget.dataset.value) },
  toggleList(field, value) {
    const list = this.data.form[field]
    const next = list.includes(value) ? list.filter(v => v !== value) : list.concat(value)
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
  clearAvatar() { this.setData({ 'form.avatar': '' }) },

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
        const stepOf = { name: 1, gender: 1, education: 1, school: 1, major: 1, subjects: 2, grades: 2, hourlyRate: 2, location: 2, experience: 2, bio: 3, certImages: 3 }
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
```

`apply.wxml`:

```xml
<view class="container">
  <view class="masthead">
    <text class="masthead-title">教师入驻</text>
    <text class="masthead-issue">第 {{step}} 步 / 共 4 步</text>
  </view>

  <!-- 步骤一: 基本信息 -->
  <block wx:if="{{step === 1}}">
    <view class="form-sec">
      <view class="f-row">
        <text class="f-label">姓名</text>
        <input class="f-input" value="{{form.name}}" data-field="name" bindinput="onField" placeholder="真实姓名" />
      </view>
      <view class="f-err" wx:if="{{errors.name}}">{{errors.name}}</view>
      <view class="f-row">
        <text class="f-label">性别</text>
        <view class="opt-group">
          <text class="opt {{form.gender === 'male' ? 'on' : ''}}" data-value="male" bindtap="onPickGender">男</text>
          <text class="opt {{form.gender === 'female' ? 'on' : ''}}" data-value="female" bindtap="onPickGender">女</text>
        </view>
      </view>
      <view class="f-err" wx:if="{{errors.gender}}">{{errors.gender}}</view>
      <view class="f-row">
        <text class="f-label">学历</text>
        <view class="opt-group">
          <text wx:for="{{eduOptions}}" wx:key="*this" class="opt {{form.education === item ? 'on' : ''}}" data-value="{{item}}" bindtap="onPickEdu">{{item}}</text>
        </view>
      </view>
      <view class="f-err" wx:if="{{errors.education}}">{{errors.education}}</view>
      <view class="f-row">
        <text class="f-label">学校</text>
        <input class="f-input" value="{{form.school}}" data-field="school" bindinput="onField" placeholder="毕业院校" />
      </view>
      <view class="f-err" wx:if="{{errors.school}}">{{errors.school}}</view>
      <view class="f-row">
        <text class="f-label">专业</text>
        <input class="f-input" value="{{form.major}}" data-field="major" bindinput="onField" placeholder="如：数学系" />
      </view>
    </view>
  </block>

  <!-- 步骤二: 教学信息 -->
  <block wx:if="{{step === 2}}">
    <view class="form-sec">
      <view class="f-label">授课科目</view>
      <view class="opt-group wrap">
        <text wx:for="{{subjectOptions}}" wx:key="*this" class="opt {{form.subjects.indexOf(item) > -1 ? 'on' : ''}}" data-value="{{item}}" bindtap="toggleSubject">{{item}}</text>
      </view>
      <view class="f-err" wx:if="{{errors.subjects}}">{{errors.subjects}}</view>
      <view class="f-label mt-lg">授课年级</view>
      <view class="opt-group wrap">
        <text wx:for="{{gradeOptions}}" wx:key="*this" class="opt {{form.grades.indexOf(item) > -1 ? 'on' : ''}}" data-value="{{item}}" bindtap="toggleGrade">{{item}}</text>
      </view>
      <view class="f-err" wx:if="{{errors.grades}}">{{errors.grades}}</view>
      <view class="f-row mt-lg">
        <text class="f-label">时薪（元/时）</text>
        <input class="f-input" type="number" value="{{form.hourlyRate}}" data-field="hourlyRate" bindinput="onField" placeholder="50-500" />
      </view>
      <view class="f-err" wx:if="{{errors.hourlyRate}}">{{errors.hourlyRate}}</view>
      <view class="f-row">
        <text class="f-label">教龄（年）</text>
        <input class="f-input" type="number" value="{{form.experience}}" data-field="experience" bindinput="onField" placeholder="如 3" />
      </view>
      <view class="f-row">
        <text class="f-label">所在地</text>
        <input class="f-input" value="{{form.location}}" data-field="location" bindinput="onField" placeholder="如：上海市杨浦区" />
      </view>
      <view class="f-err" wx:if="{{errors.location}}">{{errors.location}}</view>
    </view>
  </block>

  <!-- 步骤三: 简介与凭证 -->
  <block wx:if="{{step === 3}}">
    <view class="form-sec">
      <view class="f-label">个人简介（30-500 字）</view>
      <view class="paper-grid apply-grid">
        <textarea class="grid-textarea" value="{{form.bio}}" data-field="bio" bindinput="onField" maxlength="500" placeholder="教学经验、风格、可授课时间…" show-confirm-bar="{{false}}"/>
      </view>
      <view class="f-err" wx:if="{{errors.bio}}">{{errors.bio}}</view>
      <view class="f-label mt-lg">微信号（家长联系用，刊出时脱敏）</view>
      <input class="f-input underline" value="{{form.wechatId}}" data-field="wechatId" bindinput="onField" placeholder="微信号" />
      <view class="f-label mt-lg">资质凭证（必传，教师证/成绩单等）</view>
      <view class="cert-row">
        <view class="cert-item" wx:for="{{form.certImages}}" wx:key="*this">
          <image class="cert-img" src="{{item}}" mode="aspectFill"/>
          <view class="cert-del" data-index="{{index}}" bindtap="removeCert">×</view>
        </view>
        <view class="cert-add" wx:if="{{form.certImages.length < 3}}" bindtap="chooseCert">＋</view>
      </view>
      <view class="f-err" wx:if="{{errors.certImages}}">{{errors.certImages}}</view>
      <view class="f-label mt-lg">头像（可选）</view>
      <view class="cert-row">
        <view class="cert-item" wx:if="{{form.avatar}}">
          <image class="cert-img" src="{{form.avatar}}" mode="aspectFill"/>
          <view class="cert-del" bindtap="clearAvatar">×</view>
        </view>
        <view class="cert-add" wx:if="{{!form.avatar}}" bindtap="chooseAvatar">＋</view>
      </view>
    </view>
  </block>

  <!-- 步骤四: 预览确认 -->
  <block wx:if="{{step === 4}}">
    <view class="form-sec preview">
      <view class="p-row"><text class="p-k">姓名</text><text>{{form.name}}</text></view>
      <view class="p-row"><text class="p-k">学历</text><text>{{form.education}} · {{form.school}}{{form.major ? ' · ' + form.major : ''}}</text></view>
      <view class="p-row"><text class="p-k">科目</text><text class="subj">{{previewSubjects}}</text></view>
      <view class="p-row"><text class="p-k">年级</text><text>{{previewGrades}}</text></view>
      <view class="p-row"><text class="p-k">时薪</text><text class="num">{{form.hourlyRate}} 元/时</text></view>
      <view class="p-row"><text class="p-k">简介</text><text class="p-bio">{{form.bio}}</text></view>
      <view class="p-row"><text class="p-k">凭证</text><text>{{form.certImages.length}} 张</text></view>
      <view class="apply-note">提交后由公报编辑部人工核验，结果将在「我的」页通知</view>
    </view>
  </block>

  <!-- 底部操作 -->
  <view class="apply-actions">
    <button wx:if="{{step > 1}}" class="action-btn btn-ghost" bindtap="prevStep">上一步</button>
    <button wx:if="{{step < 4}}" class="action-btn btn-primary" bindtap="nextStep">下一步</button>
    <button wx:if="{{step === 4}}" class="action-btn btn-primary {{submitting ? 'disabled' : ''}}" bindtap="submit">{{submitting ? '存入中…' : '存入公报'}}</button>
  </view>
</view>
```

> 注意: WXML 表达式**不支持方法调用**（如 `.join()`），一切预览/拼接字符串都在 js 里预计算后 setData（上面代码已按此写法）。

`apply.wxss`:

```css
.form-sec { border-top: 1rpx solid var(--line); padding: 28rpx 4rpx; }
.f-row { display: flex; align-items: center; gap: 20rpx; padding: 18rpx 0; border-bottom: 1rpx solid var(--line); }
.f-label { font-size: var(--fs-sub); color: var(--ink-faint); letter-spacing: 4rpx; }
.f-row .f-label { width: 200rpx; flex-shrink: 0; }
.f-input { flex: 1; font-size: var(--fs-body); color: var(--ink); }
.f-input.underline { border-bottom: 2rpx solid var(--line-strong); padding: 8rpx 4rpx; }
.f-err { color: var(--seal); font-size: var(--fs-label); padding: 8rpx 4rpx 0; }
.opt-group { display: flex; flex-wrap: wrap; gap: 14rpx; }
.opt-group.wrap { margin-top: 16rpx; }
.opt { padding: 10rpx 30rpx; border: 1rpx solid var(--line-strong); border-radius: 2rpx; font-size: var(--fs-sub); color: var(--ink-soft); }
.opt.on { background: var(--ink-green); color: var(--paper); border-color: var(--ink-green); }
.apply-grid { margin-top: 16rpx; }
.grid-textarea { width: 100%; height: 240rpx; padding: 16rpx 20rpx 40rpx; background: transparent; border: none; font-size: var(--fs-body); line-height: 52rpx; box-sizing: border-box; }
.cert-row { display: flex; gap: 16rpx; margin-top: 16rpx; flex-wrap: wrap; }
.cert-item { position: relative; width: 140rpx; height: 140rpx; border: 1rpx solid var(--line-strong); border-radius: 2rpx; }
.cert-img { width: 100%; height: 100%; }
.cert-del { position: absolute; top: -14rpx; right: -14rpx; width: 40rpx; height: 40rpx; background: var(--ink); color: var(--paper); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 26rpx; }
.cert-add { width: 140rpx; height: 140rpx; border: 2rpx dashed var(--line-strong); border-radius: 2rpx; display: flex; align-items: center; justify-content: center; font-size: 48rpx; color: var(--ink-faint); }
.preview .p-row { display: flex; gap: 20rpx; padding: 14rpx 0; border-bottom: 1rpx solid var(--line); font-size: var(--fs-sub); }
.preview .p-k { width: 110rpx; color: var(--ink-faint); letter-spacing: 4rpx; flex-shrink: 0; }
.preview .p-bio { line-height: 1.7; }
.apply-note { margin-top: 24rpx; font-size: var(--fs-label); color: var(--ink-faint); line-height: 1.7; }
.apply-actions { display: flex; gap: 20rpx; padding: 36rpx 0 20rpx; }
.apply-actions .action-btn { flex: 1; height: 88rpx; font-size: var(--fs-body); letter-spacing: 4rpx; border-radius: 2rpx; border: none; line-height: 84rpx; }
.apply-actions .btn-primary { background: var(--ink-green); color: var(--paper); }
.apply-actions .btn-primary.disabled { background: var(--line-strong); }
.apply-actions .btn-ghost { color: var(--ink-green); border: 2rpx solid var(--ink-green); background: transparent; }
```

- [ ] **Step 3: 语法自检 + Commit**

Run: `node --check miniprogram/pages/apply/apply.js`

```bash
git add miniprogram/pages/apply/
git commit -m "feat: four-step tutor application form"
```

---

### Task 11: 审核页（admin-audit）

**Files:**
- Create: `miniprogram/pages/admin-audit/admin-audit.{js,json,wxml,wxss}`
- Modify: `miniprogram/app.json`（pages 注册）

- [ ] **Step 1: 注册 + 页面四件套**

app.json `pages` 加 `"pages/admin-audit/admin-audit"`。

`admin-audit.json`:

```json
{
  "navigationBarTitleText": "公报编辑部 · 审核"
}
```

`admin-audit.js`:

```js
const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    list: [],
    current: null,     // 正在查看的申请
    currentSubjects: '',
    currentGrades: '',
    rejectNote: '',
    acting: false
  },

  onLoad() { this.refresh() },

  async refresh() {
    try {
      const res = await api.listApplications('pending')
      this.setData({ list: res.data, loading: false, current: null })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    const current = this.data.list.find(x => x.id === id)
    if (!current) { return }
    // WXML 表达式不支持方法调用，展示字符串在此预计算
    this.setData({
      current,
      rejectNote: '',
      currentSubjects: (current.subjects || []).join('、'),
      currentGrades: (current.grades || []).join('、')
    })
  },
  backToList() { this.setData({ current: null }) },

  onNote(e) { this.setData({ rejectNote: e.detail.value }) },

  async approve() {
    if (this.data.acting) { return }
    this.setData({ acting: true })
    try {
      await api.approveApplication(this.data.current.id)
      wx.showToast({ title: '已刊入名录', icon: 'success' })
      this.refresh()
    } catch (err) {
      wx.showToast({ title: (err && err.error) || '操作失败', icon: 'none' })
    } finally {
      this.setData({ acting: false })
    }
  },

  async reject() {
    if (this.data.acting) { return }
    if (!this.data.rejectNote.trim()) {
      wx.showToast({ title: '请填写驳回原因', icon: 'none' })
      return
    }
    this.setData({ acting: true })
    try {
      await api.rejectApplication(this.data.current.id, this.data.rejectNote.trim())
      wx.showToast({ title: '已驳回', icon: 'none' })
      this.refresh()
    } catch (err) {
      wx.showToast({ title: (err && err.error) || '操作失败', icon: 'none' })
    } finally {
      this.setData({ acting: false })
    }
  }
})
```

`admin-audit.wxml`:

```xml
<view class="container">
  <view wx:if="{{loading}}" class="state-box"><text class="state-copy">调阅中</text></view>

  <!-- 列表 -->
  <block wx:elif="{{!current}}">
    <view class="masthead">
      <text class="masthead-title">待审名录</text>
      <text class="masthead-issue">共 {{list.length}} 件</text>
    </view>
    <view wx:if="{{list.length === 0}}" class="state-box">
      <text class="state-kicker">启事</text>
      <text class="state-copy">本期无待审稿件</text>
    </view>
    <view wx:for="{{list}}" wx:key="id" class="sheet audit-item" data-id="{{item.id}}" bindtap="openDetail">
      <view class="a-name">{{item.name}}<text class="a-meta">{{item.education}} · {{item.school}}</text></view>
      <view class="a-sub">{{item.subjects.join('、')}} · {{item.hourlyRate}} 元/时</view>
    </view>
  </block>

  <!-- 详情 -->
  <block wx:else>
    <view class="d-head-row">
      <text class="back-link" bindtap="backToList">‹ 返回列表</text>
    </view>
    <view class="masthead">
      <text class="masthead-title">{{current.name}}</text>
      <text class="masthead-issue">待审</text>
    </view>
    <view class="sheet detail-card">
      <view class="p-row"><text class="p-k">学历</text><text>{{current.education}} · {{current.school}}{{current.major ? ' · ' + current.major : ''}}</text></view>
      <view class="p-row"><text class="p-k">科目</text><text>{{currentSubjects}}</text></view>
      <view class="p-row"><text class="p-k">年级</text><text>{{currentGrades}}</text></view>
      <view class="p-row"><text class="p-k">时薪</text><text>{{current.hourlyRate}} 元/时</text></view>
      <view class="p-row"><text class="p-k">简介</text><text class="p-bio">{{current.bio}}</text></view>
      <view class="p-row"><text class="p-k">微信</text><text>{{current.wechatId}}</text></view>
    </view>
    <view class="f-label mt-lg">资质凭证（核验要点：证件信息与姓名一致）</view>
    <view class="cert-row">
      <image wx:for="{{current.certImages}}" wx:key="*this" class="cert-img-lg" src="{{item}}" mode="aspectFill"/>
    </view>
    <view class="f-label mt-lg">驳回原因（驳回时必填）</view>
    <textarea class="note-input" value="{{rejectNote}}" bindinput="onNote" maxlength="200" placeholder="如：凭证照片模糊，请重传"/>
    <view class="audit-actions">
      <button class="action-btn btn-ghost" bindtap="reject">驳回</button>
      <button class="action-btn btn-primary" bindtap="approve">通过并刊入</button>
    </view>
  </block>
</view>
```

`admin-audit.wxss`:

```css
.audit-item { padding: 26rpx 30rpx; margin-top: 22rpx; }
.a-name { font-family: var(--serif); font-size: var(--fs-name); font-weight: 900; }
.a-meta { font-size: var(--fs-label); color: var(--ink-faint); margin-left: 16rpx; font-family: -apple-system, sans-serif; font-weight: 400; }
.a-sub { margin-top: 8rpx; font-size: var(--fs-sub); color: var(--ink-soft); }
.d-head-row { padding: 8rpx 4rpx; }
.back-link { color: var(--ink-green); font-size: var(--fs-sub); }
.detail-card { padding: 26rpx 30rpx; margin-top: 16rpx; }
.p-row { display: flex; gap: 20rpx; padding: 12rpx 0; border-bottom: 1rpx solid var(--line); font-size: var(--fs-sub); }
.p-k { width: 100rpx; color: var(--ink-faint); letter-spacing: 4rpx; flex-shrink: 0; }
.p-bio { line-height: 1.7; }
.cert-row { display: flex; gap: 16rpx; margin-top: 16rpx; flex-wrap: wrap; }
.cert-img-lg { width: 200rpx; height: 200rpx; border: 1rpx solid var(--line-strong); }
.note-input { width: 100%; height: 160rpx; border: 1rpx solid var(--line-strong); border-radius: 2rpx; padding: 16rpx 20rpx; font-size: var(--fs-sub); box-sizing: border-box; margin-top: 16rpx; background: var(--paper); }
.audit-actions { display: flex; gap: 20rpx; padding: 32rpx 0 20rpx; }
.audit-actions .action-btn { flex: 1; height: 88rpx; font-size: var(--fs-body); letter-spacing: 4rpx; border-radius: 2rpx; border: none; line-height: 84rpx; }
.audit-actions .btn-primary { background: var(--ink-green); color: var(--paper); }
.audit-actions .btn-ghost { color: var(--seal); border: 2rpx solid var(--seal); background: transparent; }
.mt-lg { margin-top: 28rpx; }
```

- [ ] **Step 2: 语法自检 + Commit**

Run: `node --check miniprogram/pages/admin-audit/admin-audit.js`

```bash
git add miniprogram/pages/admin-audit/ miniprogram/app.json
git commit -m "feat: admin audit page with approve/reject"
```

---

### Task 12: 「我的」tab 图标 + app.json 校验

**Files:**
- Modify: `design/tools/gen-icons.mjs`（加 mine 字形 + 输出 2 枚）
- Generate: `miniprogram/images/mine.png`、`miniprogram/images/mine-active.png`

- [ ] **Step 1: gen-icons.mjs 加人形图标**

在 `drawTutor` 之后加:

```js
// mine：人形（圆头 + 肩弧）
function drawMine(px, C) {
  // 头
  fillCircle(px, C, 40.5, 30, 13);
  // 肩（半圆弧：用大圆裁掉下半屏外的部分，逐行填充）
  for (let y = 47; y <= 67; y++) {
    const half = 27 - (y - 47) * 0.18; // 顶部最宽，向下收
    for (let x = Math.round(40.5 - half); x <= Math.round(40.5 + half); x++) {
      put(px, x, y, C);
    }
  }
}
```

jobs 数组追加两项:

```js
  ['mine.png', drawMine, INACTIVE],
  ['mine-active.png', drawMine, ACTIVE],
```

- [ ] **Step 2: 生成并校验**

Run: `node design/tools/gen-icons.mjs && sips -g pixelWidth -g hasAlpha miniprogram/images/mine.png`
Expected: 输出 6 张图 + mine.png 81×81 hasAlpha

- [ ] **Step 3: app.json 校验 + Commit**

Run: `node -e "JSON.parse(require('fs').readFileSync('miniprogram/app.json','utf8'));console.log('ok')"`

```bash
git add design/tools/gen-icons.mjs miniprogram/images/mine.png miniprogram/images/mine-active.png
git commit -m "feat: mine tab icon"
```

---

### Task 13: 端到端手工验收清单（含管理员提权）

**Files:**
- Create: `docs/superpowers/plans/2026-11-22-onboarding-qa-checklist.md`

- [ ] **Step 1: 写验收清单文档**

```markdown
# 家教入驻系统 · 手工验收清单

## 准备
1. `cd backend && go run .`（端口 8080）
2. 微信开发者工具打开 `miniprogram/`，详情设置勾选「不校验合法域名」
3. 提权管理员（拿 openid: 先在「我的」页登录一次，然后）:
   sqlite3 backend/database/tutors.db "UPDATE users SET role='admin' WHERE openid='dev_openid_<对应code>'"
   （重新进小程序触发一次登录获取新 token）

## 验收路径
- [ ] 「我的」tab 显示，登录后为未入驻状态卡
- [ ] 申请入驻 → 四步表单：必填校验逐字段报红
- [ ] 步骤三上传凭证：选图→上传→缩略图出现；可删除；gif 被 toast 拒绝
- [ ] 提交成功 toast「已存入公报」→ 回「我的」显示「审核中」
- [ ] 家长端（首页/名录）此时**看不到**该家教
- [ ] 管理员登录 → 「我的」出现编辑部入口（待审 1 件）→ 审核页可见申请详情与凭证
- [ ] 不填原因驳回 → toast 拦截；填原因驳回 → 成功
- [ ] 家教端「我的」显示「已驳回 + 原因」→ 重新提交 → 回「审核中」
- [ ] 管理员通过 → 家长端首页/名录**能看到**该家教，详情正常
- [ ] 已通过档案再编辑提交 → 状态回「审核中」且家长端仍可见
- [ ] 断网提交 → 错误 toast，表单内容不丢
- [ ] 「我的」页加载/空/错误/成功四态符合公报语言
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-11-22-onboarding-qa-checklist.md
git commit -m "docs: onboarding manual QA checklist"
```

- [ ] **Step 3: 按清单执行验收**（需要真机/开发者工具与微信登录，由 PM 或其授权人执行；自动化部分已由 Task 7 冒烟覆盖）
