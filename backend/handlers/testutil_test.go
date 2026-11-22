package handlers

import (
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

// newTestRouter 组装被测路由（随任务逐步追加）
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
	return w
}
