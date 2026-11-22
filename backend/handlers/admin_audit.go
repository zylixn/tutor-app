package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"tutor-api/database"
	"tutor-api/models"
)

// ListApplications 审核列表
// GET /api/v1/admin/tutor-applications?status=pending&page=1&pageSize=20
func ListApplications(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")
	page := atoiDefault(c.Query("page"), 1)
	pageSize := atoiDefault(c.Query("pageSize"), 20)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}

	var total int
	if err := database.DB.QueryRow(
		"SELECT COUNT(*) FROM tutors WHERE audit_status = ?", status,
	).Scan(&total); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询总数失败"})
		return
	}

	rows, err := database.DB.Query(`SELECT id, name, gender, education, school, major,
		subjects, grades, hourly_rate, location, experience, bio, avatar, cert_images,
		audit_status, audit_note, COALESCE(submitted_at,''), wechat_id
		FROM tutors WHERE audit_status = ? ORDER BY submitted_at DESC, id DESC LIMIT ? OFFSET ?`,
		status, pageSize, (page-1)*pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询列表失败"})
		return
	}
	defer rows.Close()

	list := []models.TutorApplication{}
	for rows.Next() {
		var app models.TutorApplication
		if err := rows.Scan(&app.ID, &app.Name, &app.Gender, &app.Education, &app.School,
			&app.Major, &app.Subjects, &app.Grades, &app.HourlyRate, &app.Location,
			&app.Experience, &app.Bio, &app.Avatar, &app.CertImages,
			&app.AuditStatus, &app.AuditNote, &app.SubmittedAt, &app.WechatID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "解析列表失败"})
			return
		}
		list = append(list, app)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "遍历列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"total": total, "page": page, "perPage": pageSize, "data": list})
}

// ApproveApplication 通过申请
// POST /api/v1/admin/tutor-applications/:id/approve
func ApproveApplication(c *gin.Context) {
	id := c.Param("id")

	var status string
	err := database.DB.QueryRow(
		"SELECT audit_status FROM tutors WHERE id = ?", id,
	).Scan(&status)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "申请不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	if status == "approved" {
		c.JSON(http.StatusOK, gin.H{"id": id, "auditStatus": "approved"}) // 幂等
		return
	}
	if status != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "该申请当前不可通过（状态: " + status + "）"})
		return
	}

	if _, err := database.DB.Exec(
		"UPDATE tutors SET audit_status='approved', status='active', audit_note='' WHERE id=?", id,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "auditStatus": "approved"})
}

// RejectApplication 驳回申请（必附原因）
// POST /api/v1/admin/tutor-applications/:id/reject
func RejectApplication(c *gin.Context) {
	id := c.Param("id")

	var req struct {
		Note string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Note) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请填写驳回原因（1-200 字）"})
		return
	}
	noteLen := len([]rune(strings.TrimSpace(req.Note)))
	if noteLen > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "驳回原因不能超过 200 字"})
		return
	}

	res, err := database.DB.Exec(
		"UPDATE tutors SET audit_status='rejected', audit_note=? WHERE id=? AND audit_status='pending'",
		strings.TrimSpace(req.Note), id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "申请不存在或状态已变更"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "auditStatus": "rejected"})
}

// atoiDefault 字符串转 int，失败给默认值
func atoiDefault(s string, d int) int {
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return d
		}
		n = n*10 + int(ch-'0')
	}
	if s == "" {
		return d
	}
	return n
}
