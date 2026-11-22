package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"tutor-api/auth"
	"tutor-api/config"
	"tutor-api/database"
	"tutor-api/handlers"
	"tutor-api/middleware"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("❌ 加载配置失败: %v", err)
	}
	fmt.Printf("⚙️  配置加载成功: Port=%s, DB=%s\n", cfg.ServerPort, cfg.DBPath)

	middleware.InitJWT(cfg.JWTSecret)

	// 初始化鉴权提供者
	initAuthProvider(cfg)

	if err := database.InitDB(cfg.DBPath); err != nil {
		log.Fatalf("❌ 初始化数据库失败: %v", err)
	}
	defer database.CloseDB()

	if err := database.EnsureSchema(); err != nil {
		log.Fatalf("❌ 初始化数据库结构失败: %v", err)
	}
	if err := insertTestData(); err != nil {
		log.Fatalf("❌ 初始化测试数据失败: %v", err)
	}

	router := gin.Default()
	router.Use(middleware.SetupCORS(cfg.CORSOrigin))

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "message": "家教小程序 API 服务运行中"})
	})

	v1 := router.Group("/api/v1")
	{
		v1.GET("/tutors", handlers.GetTutors)
		v1.GET("/tutors/:id", middleware.OptionalAuth(), handlers.GetTutorDetail)
		v1.GET("/tutors/:id/contact", middleware.RequireAuth(), handlers.GetTutorContact)
		v1.GET("/reviews", middleware.OptionalAuth(), handlers.GetReviews)
		v1.POST("/reviews", middleware.RequireAuth(), handlers.SubmitReview)
		v1.POST("/tutors", middleware.RequireAuth(), middleware.RequireAdmin(), handlers.CreateTutor)
		v1.POST("/auth/login", handlers.Login)
	}

	srv := &http.Server{
		Addr:         ":" + cfg.ServerPort,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		fmt.Printf("🚀 服务器启动成功，监听端口 %s\n", cfg.ServerPort)
		fmt.Printf("📚 API 文档:\n")
		fmt.Printf("   GET    /api/v1/tutors       - 获取家教列表\n")
		fmt.Printf("   GET    /api/v1/tutors/:id   - 获取家教详情\n")
		fmt.Printf("   POST   /api/v1/tutors       - 创建家教 (需管理员)\n")
		fmt.Printf("   POST   /api/v1/reviews      - 提交评论 (需登录)\n")
			fmt.Printf("   GET    /api/v1/tutors/:id/contact - 获取家教联系方式 (需登录)\n")
			fmt.Printf("   GET    /api/v1/reviews      - 获取评论列表\n")
		fmt.Printf("   POST   /api/v1/auth/login   - 登录\n")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("❌ 启动服务器失败: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	fmt.Println("🛑 正在关闭服务器...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("服务器强制关闭:", err)
	}
	fmt.Println("✅ 服务器已优雅关闭")
}

func insertTestData() error {
	var count int
	err := database.DB.QueryRow("SELECT COUNT(*) FROM tutors").Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	fmt.Println("📊 正在插入测试数据...")

	tutors := []struct {
		id, name, avatar, gender, education, school, major, subjects, grades string
		hourlyRate, experience int
		location, bio, wechatID string
		verified bool
		rating float64
		reviewCount int
	}{
		{"tutor_001", "张明", "/images/avatars/male1.png", "male", "硕士", "北京大学", "数学系", `["数学","物理"]`, `["初中","高中"]`, 150, 5, "海淀区", "北大数学系硕士，5年家教经验，擅长初高中数学物理辅导，帮助学生快速提分。", "zhangming_edu", true, 4.9, 28},
		{"tutor_002", "李婷", "/images/avatars/female1.png", "female", "本科", "清华大学", "英语系", `["英语"]`, `["小学","初中","高中"]`, 120, 3, "朝阳区", "清华英语专业，专业八级，擅长英语口语和写作辅导，耐心细致。", "liting_eng", true, 4.8, 22},
		{"tutor_003", "王磊", "/images/avatars/male2.png", "male", "博士", "北京师范大学", "化学系", `["化学","生物"]`, `["初中","高中"]`, 180, 8, "西城区", "北师大化学博士，教学经验丰富，多篇论文发表，善于启发式教学。", "wanglei_chem", true, 4.95, 35},
		{"tutor_004", "赵雪", "/images/avatars/female2.png", "female", "硕士", "中国人民大学", "中文系", `["语文","历史"]`, `["小学","初中"]`, 100, 4, "东城区", "人大中文系硕士，擅长阅读写作教学，帮助学生培养文学素养。", "zhaoxue_liter", true, 4.7, 18},
		{"tutor_005", "陈浩", "/images/avatars/male3.png", "male", "本科", "北京理工大学", "计算机系", `["数学","编程"]`, `["初中","高中"]`, 130, 2, "丰台区", "北理工计算机本科，擅长数学和编程启蒙，培养学生逻辑思维。", "chenhao_code", false, 4.6, 12},
		{"tutor_006", "刘芳", "/images/avatars/female3.png", "female", "硕士", "首都师范大学", "教育系", `["全科"]`, `["小学"]`, 90, 6, "通州区", "首师大教育硕士，专注小学全科辅导，善于激发学习兴趣。", "liufang_primary", true, 4.85, 25},
		{"tutor_007", "孙伟", "/images/avatars/male4.png", "male", "本科", "北京航空航天大学", "物理系", `["物理","数学"]`, `["高中"]`, 140, 3, "昌平区", "北航物理本科，高考物理满分，擅长竞赛辅导和高考冲刺。", "sunwei_physics", true, 4.75, 15},
		{"tutor_008", "周敏", "/images/avatars/female4.png", "female", "硕士", "北京外国语大学", "法语系", `["英语","法语"]`, `["初中","高中"]`, 160, 5, "海淀区", "北外法语硕士，精通英法双语，可进行双语教学，适合有留学需求的学生。", "zhoumin_lang", true, 4.9, 30},
		{"tutor_009", "吴杰", "/images/avatars/male5.png", "male", "本科", "北京交通大学", "数学系", `["数学"]`, `["初中","高中"]`, 110, 2, "石景山区", "北交大数学本科，擅长几何和代数教学，思路清晰，讲解易懂。", "wujie_math", false, 4.5, 8},
		{"tutor_010", "郑琳", "/images/avatars/female5.png", "female", "硕士", "中央音乐学院", "钢琴系", `["钢琴","音乐理论"]`, `["小学","初中","高中"]`, 200, 10, "朝阳区", "央音钢琴硕士，10年教学经验，培养学生多次获奖，耐心细致。", "zhenglin_music", true, 4.95, 42},
	}

	for _, t := range tutors {
		verified := 0
		if t.verified {
			verified = 1
		}
		_, err := database.DB.Exec(`
			INSERT INTO tutors (id, name, avatar, gender, education, school, major, subjects, grades, hourly_rate, location, experience, verified, rating, review_count, bio, wechat_id, status)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
		`, t.id, t.name, t.avatar, t.gender, t.education, t.school, t.major, t.subjects, t.grades, t.hourlyRate, t.location, t.experience, verified, t.rating, t.reviewCount, t.bio, t.wechatID)
		if err != nil {
			return err
		}
	}

	reviews := []struct {
		id, tutorID, userID, content string
		rating int
	}{
		{"review_001", "tutor_001", "user_101", "张老师教学非常专业，孩子数学成绩从70分提高到了95分，非常感谢！", 5},
		{"review_002", "tutor_001", "user_102", "讲解清晰，很有耐心，孩子很喜欢张老师的课。", 5},
		{"review_003", "tutor_002", "user_103", "李老师的英语课很有趣，口语进步很大，会继续跟着学习。", 4},
		{"review_004", "tutor_003", "user_104", "王老师化学讲得特别好，孩子终于理解了之前不懂的概念，非常推荐！", 5},
		{"review_005", "tutor_006", "user_105", "刘老师对小学生很有方法，孩子学习兴趣提高了不少，成绩也有明显进步。", 5},
		{"review_006", "tutor_010", "user_106", "郑老师的钢琴课太棒了，孩子从零基础到现在能弹完整的曲子，进步很大！", 5},
	}

	for _, r := range reviews {
		_, err := database.DB.Exec(`
			INSERT INTO reviews (id, tutor_id, user_id, rating, content, status)
			VALUES (?, ?, ?, ?, ?, 'active')
		`, r.id, r.tutorID, r.userID, r.rating, r.content)
		if err != nil {
			return err
		}
	}

	fmt.Println("✅ 测试数据插入完成: 10 个家教, 6 条评论")
	return nil
}

// initAuthProvider 根据 APP_ENV 初始化鉴权提供者
func initAuthProvider(cfg *config.Config) {
	if cfg.AppEnv == "production" || cfg.AppEnv == "staging" {
		if cfg.WechatAppID == "" || cfg.WechatAppSecret == "" {
			log.Printf("⚠️  生产环境未配置 WECHAT_APP_ID / WECHAT_APP_SECRET，微信登录将不可用")
		}
		handlers.SetAuthProvider(auth.NewWechatAuthProvider(cfg.WechatAppID, cfg.WechatAppSecret))
		log.Printf("🔐 使用微信鉴权（%s 环境）", cfg.AppEnv)
	} else {
		handlers.SetAuthProvider(&auth.MockAuthProvider{})
		log.Println("🔐 使用 Mock 鉴权（开发环境）")
	}
}
