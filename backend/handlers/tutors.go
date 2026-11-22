package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"tutor-api/database"
	"tutor-api/models"
)

// escapeLike 转义 LIKE 查询中的通配符 % 和 _
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

// buildTutorWhere 根据 TutorQueryParams 构建 WHERE 条件和参数
func buildTutorWhere(params *TutorQueryParams) (string, []interface{}) {
	var conditions []string
	var args []interface{}

	if params.Subject != "" {
		conditions = append(conditions, `EXISTS (SELECT 1 FROM json_each(subjects) WHERE json_each.value = ?)`)
		args = append(args, params.Subject)
	}

	if params.Grade != "" {
		conditions = append(conditions, `EXISTS (SELECT 1 FROM json_each(grades) WHERE json_each.value = ?)`)
		args = append(args, params.Grade)
	}

	if params.Location != "" {
		conditions = append(conditions, "location LIKE ? ESCAPE '\\'")
		args = append(args, "%"+escapeLike(params.Location)+"%")
	}

	if params.MinPrice > 0 {
		conditions = append(conditions, "hourly_rate >= ?")
		args = append(args, params.MinPrice)
	}
	if params.MaxPrice > 0 {
		conditions = append(conditions, "hourly_rate <= ?")
		args = append(args, params.MaxPrice)
	}

	if len(conditions) == 0 {
		return "", args
	}
	return " AND " + strings.Join(conditions, " AND "), args
}

// TutorQueryParams 家教查询参数
type TutorQueryParams struct {
	Subject  string `form:"subject"`
	Grade    string `form:"grade"`
	Location string `form:"location"`
	MinPrice int    `form:"minPrice"`
	MaxPrice int    `form:"maxPrice"`
	Page     int    `form:"page"`
	PageSize int    `form:"pageSize"`
}

// ReviewQueryParams 评论查询参数
type ReviewQueryParams struct {
	TutorID  string `form:"tutorId" binding:"required"`
	Page     int    `form:"page"`
	PageSize int    `form:"pageSize"`
}

// scanTutor 从 rows 扫描一条家教记录
func scanTutor(scanner interface {
	Scan(dest ...interface{}) error
}) (models.Tutor, error) {
	var tutor models.Tutor
	var subjectsJSON, gradesJSON string
	err := scanner.Scan(
		&tutor.ID, &tutor.Name, &tutor.Avatar, &tutor.Gender, &tutor.Education,
		&tutor.School, &tutor.Major, &subjectsJSON, &gradesJSON, &tutor.HourlyRate,
		&tutor.Location, &tutor.Experience, &tutor.Verified, &tutor.Rating,
		&tutor.ReviewCount, &tutor.Bio, &tutor.WechatID, &tutor.Status,
		&tutor.CreatedAt, &tutor.UpdatedAt,
	)
	if err != nil {
		return tutor, err
	}
	// 使用 StringArray.Scan 解析 JSON
	tutor.Subjects.Scan(subjectsJSON)
	tutor.Grades.Scan(gradesJSON)
	return tutor, nil
}

// GetTutors 获取家教列表
// GET /api/v1/tutors
func GetTutors(c *gin.Context) {
	var params TutorQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数解析失败: " + err.Error()})
		return
	}

	if params.Page <= 0 {
		params.Page = 1
	}
	if params.PageSize <= 0 {
		params.PageSize = 20
	}
	if params.PageSize > 100 {
		params.PageSize = 100
	}

	whereClause, args := buildTutorWhere(&params)

	countQuery := "SELECT COUNT(*) FROM tutors WHERE status = 'active' AND audit_status = 'approved'" + whereClause
	var total int
	if err := database.DB.QueryRow(countQuery, args...).Scan(&total); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询总数失败: " + err.Error()})
		return
	}

	offset := (params.Page - 1) * params.PageSize
	dataQuery := `
		SELECT id, name, avatar, gender, education, school, major, subjects, grades,
		       hourly_rate, location, experience, verified, rating, review_count, bio, wechat_id, status, created_at, updated_at
		FROM tutors
		WHERE status = 'active' AND audit_status = 'approved'
	` + whereClause + " ORDER BY rating DESC, review_count DESC LIMIT ? OFFSET ?"

	dataArgs := append(args, params.PageSize, offset)
	rows, err := database.DB.Query(dataQuery, dataArgs...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询家教列表失败: " + err.Error()})
		return
	}
	defer rows.Close()

	tutors := []models.Tutor{}
	for rows.Next() {
		tutor, err := scanTutor(rows)
		if err != nil {
			// 容错：记录错误但继续处理后续行
			log.Printf("解析家教数据失败: %v", err)
			continue
		}
		tutors = append(tutors, tutor)
	}

	models.MaskWechatIDs(tutors)
	c.JSON(http.StatusOK, models.TutorListResponse{
		Total:   total,
		Page:    params.Page,
		PerPage: params.PageSize,
		Data:    tutors,
	})
}

// GetTutorDetail 获取单个家教详情（含评论）
// GET /api/v1/tutors/:id
func GetTutorDetail(c *gin.Context) {
	tutorID := c.Param("id")
	if tutorID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少家教ID"})
		return
	}

	query := `
		SELECT id, name, avatar, gender, education, school, major, subjects, grades,
		       hourly_rate, location, experience, verified, rating, review_count, bio, wechat_id, status, created_at, updated_at
		FROM tutors
		WHERE id = ? AND status = 'active' AND audit_status = 'approved'
	`
	tutor, err := scanTutor(database.DB.QueryRow(query, tutorID))

	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "家教不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询家教详情失败: " + err.Error()})
		return
	}
	tutor.MaskWechatID()

	reviewQuery := `
		SELECT id, tutor_id, user_id, rating, content, status, created_at
		FROM reviews
		WHERE tutor_id = ? AND status = 'active'
		ORDER BY created_at DESC
		LIMIT 20
	`
	rows, err := database.DB.Query(reviewQuery, tutorID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询评论失败: " + err.Error()})
		return
	}
	defer rows.Close()

	reviews := []models.Review{}
	for rows.Next() {
		var review models.Review
		if err := rows.Scan(
			&review.ID, &review.TutorID, &review.UserID, &review.Rating,
			&review.Content, &review.Status, &review.CreatedAt,
		); err != nil {
			log.Printf("解析评论数据失败: %v", err)
			continue
		}
		reviews = append(reviews, review)
	}

	// 获取当前用户ID（未登录时为空字符串）
	currentUserID, _ := c.Get("userId")
	uid, _ := currentUserID.(string)

	reviewResponses := make([]models.ReviewResponse, 0, len(reviews))
	for _, r := range reviews {
		reviewResponses = append(reviewResponses, r.ToResponse(uid))
	}

	c.JSON(http.StatusOK, models.TutorDetailResponse{
		Tutor:   tutor,
		Reviews: reviewResponses,
	})
}

// GetTutorContact 获取家教联系方式（需登录）
// GET /api/v1/tutors/:id/contact
func GetTutorContact(c *gin.Context) {
	tutorID := c.Param("id")
	if tutorID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少家教ID"})
		return
	}

	var wechatID string
	var verified bool
	err := database.DB.QueryRow(
		"SELECT wechat_id, verified FROM tutors WHERE id = ? AND status = 'active' AND audit_status = 'approved'",
		tutorID,
	).Scan(&wechatID, &verified)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "家教不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}

	if !verified {
		c.JSON(http.StatusOK, gin.H{
			"wechatId": nil,
			"message":  "该家教尚未通过平台认证",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"wechatId": wechatID})
}

// CreateTutor 创建家教（管理用）
// POST /api/v1/tutors
func CreateTutor(c *gin.Context) {
	var req models.TutorCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据无效: " + err.Error()})
		return
	}

	tutorID := "tutor_" + uuid.New().String()[:8]

	subjectsJSON, err := json.Marshal(req.Subjects)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "科目数据序列化失败"})
		return
	}
	gradesJSON, err := json.Marshal(req.Grades)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "年级数据序列化失败"})
		return
	}

	query := `
		INSERT INTO tutors (
			id, name, avatar, gender, education, school, major, subjects, grades,
			hourly_rate, location, experience, verified, rating, review_count, bio, wechat_id, status, audit_status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')
	`
	_, err = database.DB.Exec(query,
		tutorID, req.Name, req.Avatar, req.Gender, req.Education, req.School, req.Major,
		string(subjectsJSON), string(gradesJSON), req.HourlyRate, req.Location,
		req.Experience, false, 5.0, 0, req.Bio, req.WechatID, "active",
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建家教失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "创建成功",
		"id":      tutorID,
	})
}
