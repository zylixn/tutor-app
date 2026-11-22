package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// uploadsDir 上传目录（测试可覆盖）
var uploadsDir = "uploads"

const maxImageBytes = 5 * 1024 * 1024 // 5MB

// UploadApplicationImage 上传资质/头像图片
// POST /api/v1/tutor-applications/images  (multipart, field: image)
func UploadApplicationImage(c *gin.Context) {
	// 5MB 图片 + multipart 编码开销，防止超限 body 先被暂存成临时文件（DoS 面）
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 6<<20)
	file, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择图片文件"})
		return
	}
	if file.Size > maxImageBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "图片不能超过 5MB"})
		return
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{".jpg": true, ".jpeg": true, ".png": true}
	if !allowedExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 JPG/PNG 格式"})
		return
	}

	// 内容嗅探双重校验（防扩展名伪装）
	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "读取文件失败"})
		return
	}
	head := make([]byte, 512)
	n, _ := f.Read(head)
	f.Close()
	ctype := http.DetectContentType(head[:n])
	if ctype != "image/jpeg" && ctype != "image/png" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件内容不是有效的 JPG/PNG 图片"})
		return
	}

	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建上传目录失败"})
		return
	}
	name := uuid.New().String() + ext // uuid 命名: 防穿越/防覆盖
	if err := c.SaveUploadedFile(file, filepath.Join(uploadsDir, name)); err != nil {
		os.Remove(filepath.Join(uploadsDir, name)) // 清理部分写入的孤儿文件
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存文件失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": "/uploads/" + name})
}
