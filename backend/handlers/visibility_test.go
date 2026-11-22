package handlers

import (
	"encoding/json"
	"testing"

	"tutor-api/database"
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
		Data  []struct {
			ID string `json:"id"`
		} `json:"data"`
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
