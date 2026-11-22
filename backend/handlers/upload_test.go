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
	"tutor-api/middleware"
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

func TestUploadRejectsDisguisedContent(t *testing.T) {
	setupTestDB(t)
	uploadsDir = t.TempDir()
	r := uploadRouter()
	tok := tokenFor(t, "user_u", "user")

	// GIF 内容伪装 .png 扩展名 → 过扩展名白名单，必须被内容嗅探拦截
	body, ctype := multipartBody(t, "fake.png", []byte("GIF89axxxx"))
	req := httptest.NewRequest("POST", "/api/v1/tutor-applications/images", body)
	req.Header.Set("Content-Type", ctype)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Fatalf("伪装内容应 400, got %d: %s", w.Code, w.Body.String())
	}
	entries, err := os.ReadDir(uploadsDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("被拒文件不应落盘, err=%v entries=%d", err, len(entries))
	}
}

func TestUploadRequiresAuth(t *testing.T) {
	setupTestDB(t)
	uploadsDir = t.TempDir()
	r := uploadRouter()

	body, ctype := multipartBody(t, "cert.png", []byte{0x89, 'P', 'N', 'G'})
	req := httptest.NewRequest("POST", "/api/v1/tutor-applications/images", body)
	req.Header.Set("Content-Type", ctype)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Fatalf("无 token 应 401, got %d", w.Code)
	}
}
