package models

// TutorApplication 入驻申请（tutors 表的审核侧投影）
type TutorApplication struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Gender      string      `json:"gender"`
	Education   string      `json:"education"`
	School      string      `json:"school"`
	Major       string      `json:"major"`
	Subjects    StringArray `json:"subjects"`
	Grades      StringArray `json:"grades"`
	HourlyRate  int         `json:"hourlyRate"`
	Location    string      `json:"location"`
	Experience  int         `json:"experience"`
	Bio         string      `json:"bio"`
	Avatar      string      `json:"avatar"`
	CertImages  StringArray `json:"certImages"`
	AuditStatus string      `json:"auditStatus"`
	AuditNote   string      `json:"auditNote"`
	SubmittedAt string      `json:"submittedAt"`
	WechatID    string      `json:"wechatId"`
}
