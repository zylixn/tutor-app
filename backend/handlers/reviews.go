package handlers

import (
	"database/sql"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"tutor-api/auth"
	"tutor-api/database"
	"tutor-api/middleware"
	"tutor-api/models"
)

// authProvider 鉴权提供者（由 main.go 初始化时设置）
var authProvider auth.AuthProvider

// SetAuthProvider 设置鉴权提供者
func SetAuthProvider(provider auth.AuthProvider) {
	authProvider = provider
}

// LoginRequest 登录请求
type LoginRequest struct {
	Code string `json:"code" binding:"required"`
}

// Login 微信小程序登录
// POST /api/v1/auth/login
func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据无效: " + err.Error()})
		return
	}

	// 使用 authProvider 鉴权
	result, err := authProvider.Authenticate(req.Code)
	if err != nil {
		// 根据错误类型返回不同状态码
		if wxErr, ok := err.(*auth.WechatAuthError); ok {
			c.JSON(wxErr.HTTPStatus, gin.H{"error": wxErr.Error()})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "鉴权失败"})
		return
	}

	openID := result.OpenID

	var userID string
	var role string
	err = database.DB.QueryRow("SELECT id, role FROM users WHERE openid = ?", openID).Scan(&userID, &role)
	if err == sql.ErrNoRows {
		userID = "user_" + uuid.New().String()[:8]
		role = "user"
		_, err = database.DB.Exec(
			"INSERT INTO users (id, openid, role) VALUES (?, ?, ?)",
			userID, openID, role,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建用户失败"})
			return
		}
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户失败"})
		return
	}

	token, err := middleware.GenerateToken(userID, role, 72)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成 token 失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":  token,
		"userId": userID,
		"role":   role,
	})
}

// SubmitReview 提交评论（需登录）
// POST /api/v1/reviews
func SubmitReview(c *gin.Context) {
	var req models.ReviewCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据无效: " + err.Error()})
		return
	}

	// 从 JWT context 获取用户ID（binding tag 已校验 rating/content 范围）
	userID, exists := c.Get("userId")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "无法获取用户身份"})
		return
	}

	var tutorExists bool
	err := database.DB.QueryRow("SELECT 1 FROM tutors WHERE id = ? AND status = 'active'", req.TutorID).Scan(&tutorExists)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "家教不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "检查家教失败: " + err.Error()})
		return
	}

	// 检查是否已有评论
	var existingID string
	err = database.DB.QueryRow(
		"SELECT id FROM reviews WHERE tutor_id = ? AND user_id = ? AND status = 'active'",
		req.TutorID, userID,
	).Scan(&existingID)

	if err == nil {
		// 已有评论 → 修改模式（使用事务保证原子性）
		tx, err := database.DB.Begin()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "开启事务失败"})
			return
		}
		defer tx.Rollback()

		_, err = tx.Exec(`
			UPDATE reviews SET rating = ?, content = ?, created_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, req.Rating, req.Content, existingID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "修改评论失败"})
			return
		}

		_, err = tx.Exec(`
			UPDATE tutors SET
				rating = (SELECT AVG(rating) FROM reviews WHERE tutor_id = ? AND status = 'active'),
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, req.TutorID, req.TutorID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "更新家教评分失败"})
			return
		}

		if err = tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "提交事务失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message":  "评论修改成功",
			"reviewId": existingID,
		})
		return
	}

	if err != sql.ErrNoRows {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询评论失败"})
		return
	}

	// 无已有评论 → 新增模式
	reviewID := "review_" + uuid.New().String()[:8]

	tx, err := database.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "开启事务失败: " + err.Error()})
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO reviews (id, tutor_id, user_id, rating, content, status)
		VALUES (?, ?, ?, ?, ?, 'active')
	`, reviewID, req.TutorID, userID, req.Rating, req.Content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "提交评论失败: " + err.Error()})
		return
	}

	_, err = tx.Exec(`
		UPDATE tutors SET
			review_count = review_count + 1,
			rating = (SELECT AVG(rating) FROM reviews WHERE tutor_id = ? AND status = 'active'),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.TutorID, req.TutorID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新家教评分失败: " + err.Error()})
		return
	}

	if err = tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "提交事务失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":  "评论提交成功",
		"reviewId": reviewID,
	})
}

// updateTutorRating 更新家教评分（AVG + updated_at）
func updateTutorRating(tutorID string) {
	database.DB.Exec(`
		UPDATE tutors SET
			rating = (SELECT AVG(rating) FROM reviews WHERE tutor_id = ? AND status = 'active'),
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, tutorID, tutorID)
}

// GetReviews 获取评论列表（含分页）
// GET /api/v1/reviews?tutorId=xxx&page=1&pageSize=20
func GetReviews(c *gin.Context) {
	var params ReviewQueryParams
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

	offset := (params.Page - 1) * params.PageSize

	dataQuery := `
		SELECT id, tutor_id, user_id, rating, content, status, created_at
		FROM reviews
		WHERE tutor_id = ? AND status = 'active'
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`
	rows, err := database.DB.Query(dataQuery, params.TutorID, params.PageSize, offset)
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

	var total int
	err = database.DB.QueryRow("SELECT COUNT(*) FROM reviews WHERE tutor_id = ? AND status = 'active'", params.TutorID).Scan(&total)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询评论总数失败: " + err.Error()})
		return
	}

	// 获取当前用户ID（未登录时为空字符串）
	currentUserID, _ := c.Get("userId")
	uid, _ := currentUserID.(string)

	responses := make([]models.ReviewResponse, 0, len(reviews))
	for _, r := range reviews {
		responses = append(responses, r.ToResponse(uid))
	}

	c.JSON(http.StatusOK, models.ReviewListResponse{
		Total:   total,
		Page:    params.Page,
		PerPage: params.PageSize,
		Data:    responses,
	})
}
