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
