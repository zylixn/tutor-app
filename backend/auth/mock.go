package auth

// MockAuthProvider 开发环境 Mock 鉴权（现有硬编码逻辑）
type MockAuthProvider struct{}

// Authenticate 返回 dev_openid_ + code，模拟微信登录
func (p *MockAuthProvider) Authenticate(code string) (*AuthResult, error) {
	return &AuthResult{
		OpenID:     "dev_openid_" + code,
		SessionKey: "mock_session_key",
	}, nil
}
