package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

// InitDB 初始化数据库连接
func InitDB(dbPath string) error {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建数据库目录失败: %w", err)
	}

	var err error
	DB, err = sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return fmt.Errorf("打开数据库失败: %w", err)
	}

	DB.SetMaxOpenConns(2)
	DB.SetMaxIdleConns(2)
	DB.SetConnMaxLifetime(0)

	if err = DB.Ping(); err != nil {
		return fmt.Errorf("数据库连接测试失败: %w", err)
	}

	fmt.Println("✅ 数据库连接成功 (WAL 模式)")
	return nil
}

// CloseDB 关闭数据库连接
func CloseDB() error {
	if DB != nil {
		return DB.Close()
	}
	return nil
}
