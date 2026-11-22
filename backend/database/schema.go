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
