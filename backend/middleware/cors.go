package middleware

import (
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// SetupCORS 设置 CORS 中间件
func SetupCORS(allowOrigin string) gin.HandlerFunc {
	config := cors.DefaultConfig()

	if allowOrigin == "*" {
		config.AllowAllOrigins = true
		config.AllowCredentials = false // AllowAllOrigins 与 AllowCredentials 不能同时为 true
	} else {
		config.AllowAllOrigins = false
		config.AllowOrigins = []string{allowOrigin}
		config.AllowCredentials = true
	}

	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Authorization", "Accept"}
	config.ExposeHeaders = []string{"Content-Length", "Access-Control-Allow-Origin"}
	config.MaxAge = 12 * 3600

	return cors.New(config)
}
