package database

import (
	"fmt"
	"strings"
)

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
