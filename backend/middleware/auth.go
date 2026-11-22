package middleware

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// jwtClaims JWT payload 结构
type jwtClaims struct {
	UserID string `json:"userId"`
	Role   string `json:"role"` // user / admin
	Exp    int64  `json:"exp"`
	Iat    int64  `json:"iat"`
}

// JWTSecret 全局密钥（从配置注入）
var JWTSecret string

// InitJWT 初始化 JWT 密钥
func InitJWT(secret string) {
	JWTSecret = secret
}

// GenerateToken 生成 JWT token（HMAC-SHA256）
func GenerateToken(userID, role string, expireHours int) (string, error) {
	claims := jwtClaims{
		UserID: userID,
		Role:   role,
		Exp:    time.Now().Add(time.Duration(expireHours) * time.Hour).Unix(),
		Iat:    time.Now().Unix(),
	}

	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payloadEnc := base64.RawURLEncoding.EncodeToString(payload)

	signingInput := header + "." + payloadEnc
	mac := hmac.New(sha256.New, []byte(JWTSecret))
	mac.Write([]byte(signingInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return signingInput + "." + sig, nil
}

// VerifyToken 验证 JWT token，返回 claims
func VerifyToken(tokenStr string) (*jwtClaims, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, ErrInvalidToken
	}

	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(JWTSecret))
	mac.Write([]byte(signingInput))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return nil, ErrInvalidToken
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrInvalidToken
	}

	var claims jwtClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, ErrInvalidToken
	}

	if time.Now().Unix() > claims.Exp {
		return nil, ErrTokenExpired
	}

	return &claims, nil
}

var (
	ErrInvalidToken = &jwtError{message: "无效的 token"}
	ErrTokenExpired = &jwtError{message: "token 已过期"}
)

type jwtError struct {
	message string
}

func (e *jwtError) Error() string {
	return e.message
}

// OptionalAuth 可选鉴权中间件 — 有 token 则解析，无 token 则跳过
func OptionalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.Next()
			return
		}

		claims, err := VerifyToken(parts[1])
		if err != nil {
			c.Next()
			return
		}

		c.Set("userId", claims.UserID)
		c.Set("userRole", claims.Role)
		c.Next()
	}
}

// RequireAuth 鉴权中间件 — 验证 JWT token
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "缺少 Authorization header"})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization 格式错误"})
			c.Abort()
			return
		}

		claims, err := VerifyToken(parts[1])
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			c.Abort()
			return
		}

		c.Set("userId", claims.UserID)
		c.Set("userRole", claims.Role)
		c.Next()
	}
}

// RequireAdmin 管理员权限中间件 — 在 RequireAuth 之后使用
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get("userRole")
		if !exists || role != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "需要管理员权限"})
			c.Abort()
			return
		}
		c.Next()
	}
}
