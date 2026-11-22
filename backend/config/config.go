package config

import (
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
)

// Config 应用配置结构
type Config struct {
	ServerPort      string
	DBPath          string
	CORSOrigin      string
	JWTSecret       string
	AppEnv          string // development / staging / production
	WechatAppID     string
	WechatAppSecret string
}

var AppConfig *Config

// LoadConfig 加载配置
func LoadConfig() (*Config, error) {
	if err := godotenv.Load(); err != nil {
		log.Println("未找到 .env 文件，使用环境变量或默认值")
	}

	config := &Config{
		ServerPort:      getEnv("SERVER_PORT", "8080"),
		DBPath:          getEnv("DB_PATH", "./database/tutors.db"),
		CORSOrigin:      getEnv("CORS_ORIGIN", "*"),
		JWTSecret:       getEnv("JWT_SECRET", ""),
		AppEnv:          getEnv("APP_ENV", "development"),
		WechatAppID:     getEnv("WECHAT_APP_ID", ""),
		WechatAppSecret: getEnv("WECHAT_APP_SECRET", ""),
	}

	// JWT Secret 校验：生产/staging 环境拒绝空值或默认值
	if config.AppEnv == "production" || config.AppEnv == "staging" {
		if config.JWTSecret == "" || config.JWTSecret == "dev-secret-change-in-production" {
			return nil, fmt.Errorf("❌ %s 环境必须设置 JWT_SECRET 且不能使用默认值", config.AppEnv)
		}
	} else if config.JWTSecret == "" {
		config.JWTSecret = "dev-secret-change-in-production"
		log.Println("⚠️  JWT_SECRET 未设置，使用开发默认值，生产环境必须配置！")
	}

	AppConfig = config
	return config, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
