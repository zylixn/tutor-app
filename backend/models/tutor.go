package models

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// StringArray 自定义类型：在 DB 中存储为 JSON 字符串，在 Go/JSON 中为 []string
type StringArray []string

// Scan 实现 sql.Scanner 接口
func (s *StringArray) Scan(value interface{}) error {
	if value == nil {
		*s = StringArray{}
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case string:
		bytes = []byte(v)
	case []byte:
		bytes = v
	default:
		*s = StringArray{}
		return nil
	}
	if len(bytes) == 0 {
		*s = StringArray{}
		return nil
	}
	return json.Unmarshal(bytes, s)
}

// Value 实现 driver.Valuer 接口
func (s StringArray) Value() (driver.Value, error) {
	if len(s) == 0 {
		return "[]", nil
	}
	bytes, err := json.Marshal([]string(s))
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

// Tutor 家教信息模型
type Tutor struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Avatar      string      `json:"avatar"`
	Gender      string      `json:"gender"`
	Education   string      `json:"education"`
	School      string      `json:"school"`
	Major       string      `json:"major"`
	Subjects    StringArray `json:"subjects"`
	Grades      StringArray `json:"grades"`
	HourlyRate  int         `json:"hourlyRate"`
	Location    string      `json:"location"`
	Experience  int         `json:"experience"`
	Verified    bool        `json:"verified"`
	Rating      float64     `json:"rating"`
	ReviewCount int         `json:"reviewCount"`
	Bio         string      `json:"bio"`
	WechatID    string      `json:"wechatId"`
	Status      string      `json:"status"`
	CreatedAt   time.Time   `json:"createdAt"`
	UpdatedAt   time.Time   `json:"updatedAt"`
}

// MaskWechatID 对微信号进行脱敏（保留前2后2位，中间 ****）
func (t *Tutor) MaskWechatID() {
	id := t.WechatID
	if len(id) <= 4 {
		t.WechatID = "****"
		return
	}
	t.WechatID = id[:2] + "****" + id[len(id)-2:]
}

// MaskWechatIDs 对列表中所有家教脱敏
func MaskWechatIDs(tutors []Tutor) {
	for i := range tutors {
		tutors[i].MaskWechatID()
	}
}

// TutorListResponse 家教列表响应
type TutorListResponse struct {
	Total   int     `json:"total"`
	Page    int     `json:"page"`
	PerPage int     `json:"perPage"`
	Data    []Tutor `json:"data"`
}

// TutorDetailResponse 家教详情响应
type TutorDetailResponse struct {
	Tutor   Tutor            `json:"tutor"`
	Reviews []ReviewResponse `json:"reviews"`
}

// TutorCreateRequest 创建家教请求
type TutorCreateRequest struct {
	Name       string   `json:"name" binding:"required"`
	Avatar     string   `json:"avatar"`
	Gender     string   `json:"gender" binding:"required,oneof=male female"`
	Education  string   `json:"education" binding:"required"`
	School     string   `json:"school" binding:"required"`
	Major      string   `json:"major"`
	Subjects   []string `json:"subjects" binding:"required,min=1"`
	Grades     []string `json:"grades" binding:"required,min=1"`
	HourlyRate int      `json:"hourlyRate" binding:"required,min=0"`
	Location   string   `json:"location" binding:"required"`
	Experience int      `json:"experience"`
	Bio        string   `json:"bio"`
	WechatID   string   `json:"wechatId" binding:"required"`
}
