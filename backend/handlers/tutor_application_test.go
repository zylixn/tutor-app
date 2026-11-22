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
	for _, field := range []string{"name", "hourlyRate", "subjects", "bio", "wechatId"} {
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
	if note != "" {
		t.Fatalf("重提后 audit_note 应清空, got %q", note)
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
	if err := database.DB.QueryRow("SELECT audit_status, status FROM tutors WHERE user_id='user_a'").Scan(&status, &tutorStatus); err != nil {
		t.Fatal(err)
	}
	if status != "pending" || tutorStatus != "active" {
		t.Fatalf("编辑后应 pending+active(家长端仍可见), got %s/%s", status, tutorStatus)
	}
}

func TestSubmitSubjectRules(t *testing.T) {
	setupTestDB(t)
	r := applyRouter()
	tok := tokenFor(t, "user_subj", "user")

	// 自定义课外科目（钢琴/古筝）合法
	body := `{"name":"王雨桐","gender":"female","education":"硕士","school":"华东师范大学","major":"音乐","subjects":["钢琴","古筝"],"grades":["小学"],"hourlyRate":150,"location":"杨浦区","experience":3,"bio":"测试简介需要满三十个字，这里补充一些描述内容以便通过校验规则。","certImages":["/uploads/x.jpg"],"wechatId":"w1"}`
	if w := postApply(r, tok, body); w.Code != 200 {
		t.Fatalf("自定义课外科目应被接受, got %d: %s", w.Code, w.Body.String())
	}

	// 超长科目名（>12 字）→ 400
	bad := `{"name":"王雨桐","gender":"female","education":"硕士","school":"华东师范大学","major":"音乐","subjects":["这是一个超过十二个字的超长科目名称示例"],"grades":["小学"],"hourlyRate":150,"location":"杨浦区","experience":3,"bio":"测试简介需要满三十个字，这里补充一些描述内容以便通过校验规则。","certImages":["/uploads/x.jpg"],"wechatId":"w1"}`
	if w := postApply(r, tok, bad); w.Code != 400 {
		t.Fatalf("超长科目应 400, got %d: %s", w.Code, w.Body.String())
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
