package models

import (
	"time"
)

// Review 评论数据库模型（不直接序列化到 API 响应）
type Review struct {
	ID        string    `json:"-"`
	TutorID   string    `json:"tutorId"`
	UserID    string    `json:"-"`
	Rating    int       `json:"rating"`
	Content   string    `json:"content"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

// ReviewResponse 评论 API 返回模型（含 isSelf，无 userId）
type ReviewResponse struct {
	ID        string    `json:"id"`
	TutorID   string    `json:"tutorId"`
	IsSelf    bool      `json:"isSelf"`
	Rating    int       `json:"rating"`
	Content   string    `json:"content"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

// ToResponse 将 Review 转为 ReviewResponse
func (r *Review) ToResponse(currentUserID string) ReviewResponse {
	return ReviewResponse{
		ID:        r.ID,
		TutorID:   r.TutorID,
		IsSelf:    r.UserID == currentUserID,
		Rating:    r.Rating,
		Content:   r.Content,
		Status:    r.Status,
		CreatedAt: r.CreatedAt,
	}
}

// ReviewCreateRequest 创建评论请求
type ReviewCreateRequest struct {
	TutorID string `json:"tutorId" binding:"required"`
	Rating  int    `json:"rating" binding:"required,min=1,max=5"`
	Content string `json:"content" binding:"required,min=5,max=500"`
}

// ReviewListResponse 评论列表响应
type ReviewListResponse struct {
	Total   int              `json:"total"`
	Page    int              `json:"page"`
	PerPage int              `json:"perPage"`
	Data    []ReviewResponse `json:"data"`
}
