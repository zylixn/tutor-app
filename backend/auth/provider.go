package auth

// AuthResult 鉴权结果
type AuthResult struct {
	OpenID     string
	SessionKey string // 保留但不持久化
}

// AuthProvider 鉴权提供者接口
type AuthProvider interface {
	Authenticate(code string) (*AuthResult, error)
}
