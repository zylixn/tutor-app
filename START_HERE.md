# 🚀 家教小程序启动清单

## ✅ 已完成
- 前端页面（首页、详情页）
- Golang 后端 API
- MySQL 数据库脚本
- 测试数据（3条）
- API 封装

## 📋 启动步骤

### 第一步: 数据库 (5分钟)

```bash
# 确保 MySQL 运行
mysql -u root -p < backend/init.sql
```

### 第二步: 后端 (5分钟)

```bash
cd backend

# 编辑 .env，设置你的数据库密码
nano .env

# 安装依赖并启动
go mod download
go run main.go
```

看到 "Server starting on :8080" 表示成功。

### 第三步: 前端 (5分钟)

1. 打开微信开发者工具
2. 导入项目（选择家教小程序目录）
3. 点击"编译"

## ⚠️ 常见问题

**后端启动失败？**
- 检查 MySQL 是否运行
- 检查 .env 配置
- 检查端口 8080 是否被占用

**前端无法连接？**
- 确认后端已启动
- 检查 app.js 中的 apiBaseUrl
- 真机测试需改为局域网 IP

**数据库错误？**
- 确认已运行 init.sql
- 确认数据库 tutor_platform 已创建

## 🎯 测试功能

访问 http://localhost:8080/api/v1/tutors
应返回 3 条家教数据。

在小程序中:
- 搜索家教
- 查看详情
- 点击"联系家教"（复制微信号）
- 提交评价

## 📱 下一步

配置完成后:
1. 添加 tab bar 图标
2. 补充更多测试数据
3. 真机测试
4. 准备审核

---

**需要帮助？检查 backend/README.md**
