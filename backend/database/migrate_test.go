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
