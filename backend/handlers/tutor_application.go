package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"tutor-api/database"
	"tutor-api/models"
)

// TutorApplicationRequest 入驻申请请求体
type TutorApplicationRequest struct {
	Name       string   `json:"name"`
	Gender     string   `json:"gender"`
	Education  string   `json:"education"`
	School     string   `json:"school"`
	Major      string   `json:"major"`
	Subjects   []string `json:"subjects"`
	Grades     []string `json:"grades"`
	HourlyRate int      `json:"hourlyRate"`
	Location   string   `json:"location"`
	Experience int      `json:"experience"`
	Bio        string   `json:"bio"`
	Avatar     string   `json:"avatar"`
	CertImages []string `json:"certImages"`
	WechatID   string   `json:"wechatId"`
}

// validateApplication 字段级校验（规格 §6）
func validateApplication(req *TutorApplicationRequest) map[string]string {
	errs := map[string]string{}
	if strings.TrimSpace(req.Name) == "" {
		errs["name"] = "请填写姓名"
	}
	if req.Gender != "male" && req.Gender != "female" {
		errs["gender"] = "请选择性别"
	}
	if req.Education == "" {
		errs["education"] = "请选择学历"
	}
	if strings.TrimSpace(req.School) == "" {
		errs["school"] = "请填写学校"
	}
	if len(req.Subjects) == 0 {
		errs["subjects"] = "请至少选择一个科目"
	}
	if len(req.Grades) == 0 {
		errs["grades"] = "请至少选择一个年级"
	}
	if req.HourlyRate < 50 || req.HourlyRate > 500 {
		errs["hourlyRate"] = "时薪需在 50-500 元之间"
	}
	if strings.TrimSpace(req.Location) == "" {
		errs["location"] = "请填写所在地"
	}
	bioLen := len([]rune(strings.TrimSpace(req.Bio)))
	if bioLen < 30 || bioLen > 500 {
		errs["bio"] = "简介需 30-500 字"
	}
	if len(req.CertImages) == 0 {
		errs["certImages"] = "请至少上传一张资质凭证"
	}
	return errs
}

// SubmitTutorApplication 创建并提交申请 / 驳回后重提 / 已通过档案编辑重审
// POST /api/v1/tutor-applications
func SubmitTutorApplication(c *gin.Context) {
	userID := c.GetString("userId")

	var req TutorApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据无效: " + err.Error()})
		return
	}
	if errs := validateApplication(&req); len(errs) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"errors": errs})
		return
	}

	var tutorID, auditStatus string
	err := database.DB.QueryRow(
		"SELECT id, audit_status FROM tutors WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1",
		userID,
	).Scan(&tutorID, &auditStatus)

	switch {
	case err == sql.ErrNoRows:
		// 首次入驻: 新建档案（inactive，审核通过才 active）
		newID := "tutor_" + uuid.New().String()[:8]
		_, e := database.DB.Exec(`INSERT INTO tutors
			(id, name, avatar, gender, education, school, major, subjects, grades,
			 hourly_rate, location, experience, verified, rating, review_count,
			 bio, wechat_id, status, user_id, audit_status, submitted_at, cert_images)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,5.0,0,?,?,?,?,?,CURRENT_TIMESTAMP,?)`,
			newID, req.Name, req.Avatar, req.Gender, req.Education, req.School, req.Major,
			models.StringArray(req.Subjects), models.StringArray(req.Grades),
			req.HourlyRate, req.Location, req.Experience,
			req.Bio, req.WechatID, "inactive", userID, "pending",
			models.StringArray(req.CertImages))
		if e != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "提交申请失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"id": newID, "auditStatus": "pending"})
		return

	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询申请失败"})
		return
	}

	// 已有记录
	if auditStatus == "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "已有待审核的申请，请等待审核结果"})
		return
	}

	// rejected → 重新提交；approved → 编辑重审（编辑即时可见，见规格 §4）
	_, e := database.DB.Exec(`UPDATE tutors SET
		name=?, avatar=?, gender=?, education=?, school=?, major=?, subjects=?, grades=?,
		hourly_rate=?, location=?, experience=?, bio=?, wechat_id=?, cert_images=?,
		audit_status='pending', audit_note='', submitted_at=CURRENT_TIMESTAMP
		WHERE id=?`,
		req.Name, req.Avatar, req.Gender, req.Education, req.School, req.Major,
		models.StringArray(req.Subjects), models.StringArray(req.Grades),
		req.HourlyRate, req.Location, req.Experience, req.Bio, req.WechatID,
		models.StringArray(req.CertImages), tutorID)
	if e != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新申请失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": tutorID, "auditStatus": "pending"})
}

// GetMyApplication 本人申请状态
// GET /api/v1/tutor-applications/mine
func GetMyApplication(c *gin.Context) {
	userID := c.GetString("userId")

	var app models.TutorApplication
	err := database.DB.QueryRow(`SELECT id, name, gender, education, school, major,
		subjects, grades, hourly_rate, location, experience, bio, avatar, cert_images,
		audit_status, audit_note, COALESCE(submitted_at,''), wechat_id
		FROM tutors WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1`, userID,
	).Scan(&app.ID, &app.Name, &app.Gender, &app.Education, &app.School, &app.Major,
		&app.Subjects, &app.Grades, &app.HourlyRate, &app.Location, &app.Experience,
		&app.Bio, &app.Avatar, &app.CertImages,
		&app.AuditStatus, &app.AuditNote, &app.SubmittedAt, &app.WechatID)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, gin.H{"auditStatus": "none"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询申请失败"})
		return
	}
	c.JSON(http.StatusOK, app)
}
