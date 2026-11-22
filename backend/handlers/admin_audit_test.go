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

func TestApproveNonPendingConflicts(t *testing.T) {
	setupTestDB(t)
	seedTutor(t, "t_r", "已驳回", "rejected")
	seedTutor(t, "t_n", "未走审", "none")
	r := auditRouter()
	admin := tokenFor(t, "user_admin", "admin")

	if w := postAdmin(r, admin, "/api/v1/admin/tutor-applications/t_r/approve", ""); w.Code != 409 {
		t.Fatalf("rejected approve 应 409, got %d: %s", w.Code, w.Body.String())
	}
	if w := postAdmin(r, admin, "/api/v1/admin/tutor-applications/t_n/approve", ""); w.Code != 409 {
		t.Fatalf("none approve 应 409, got %d: %s", w.Code, w.Body.String())
	}
}
