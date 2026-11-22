# 家教小程序 - 微信小程序家教匹配平台 MVP

一个帮助家长和学生找到合适家教老师的微信小程序平台，同时为想做兼职的大学生和老师提供展示机会。

## 技术栈

**前端**
- 微信小程序原生开发 (WXML/WXSS/JS)
- 无框架依赖，轻量快速

**后端**
- Golang + Gin 框架
- SQLite 数据库 (modernc.org/sqlite - 纯 Go 实现)
- RESTful API

## 项目结构

```
/
├── miniprogram/              # 微信小程序前端
│   ├── pages/               # 小程序页面
│   │   ├── index/           # 首页 - 搜索和筛选
│   │   ├── tutor-detail/    # 家教详情页
│   │   ├── tutor-list/      # 家教列表页
│   │   └── write-review/    # 写评论页
│   ├── components/          # 自定义组件
│   │   └── filter-panel/    # 筛选面板组件
│   ├── utils/               # 工具函数
│   │   └── api.js           # API 请求封装
│   ├── images/              # 图标资源
│   ├── app.js               # 小程序入口
│   ├── app.json             # 小程序配置
│   └── app.wxss             # 全局样式
└── backend/                  # 后端服务 (Golang)
    ├── main.go              # 主程序入口
    ├── handlers/            # API 处理器
    ├── models/              # 数据模型
    ├── database/            # 数据库初始化
    └── middleware/          # 中间件
```

## 快速开始

### 1. 启动后端服务

```bash
cd backend
go run .              # 启动服务器 (端口 8080)
# 或编译后运行
go build -o tutor-api .
./tutor-api
```

服务器启动后访问 http://localhost:8080/health 检查状态。

### 2. 配置微信开发者工具

1. 下载并安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入项目（选择 `miniprogram` 目录）
3. 使用测试 AppID 或正式 AppID

### 3. 添加 Tab Bar 图标

在 `miniprogram/images/` 目录添加以下图标文件（81x81 PNG）：
- `home.png` / `home-active.png` - 首页图标
- `tutor.png` / `tutor-active.png` - 家教图标

> 可以使用 [iconfont](https://www.iconfont.cn/) 下载图标

### 4. 运行测试

在微信开发者工具中点击"编译"即可预览。

## API 端点

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/v1/tutors` | 获取家教列表（支持筛选和分页） |
| GET | `/api/v1/tutors/:id` | 获取家教详情（含评论） |
| POST | `/api/v1/tutors` | 创建家教（管理用） |
| POST | `/api/v1/reviews` | 提交评论 |

### 查询参数

`GET /api/v1/tutors` 支持以下查询参数：
- `subject` - 科目筛选
- `grade` - 年级筛选
- `location` - 地点筛选
- `minPrice` / `maxPrice` - 价格范围
- `page` / `pageSize` - 分页

## 功能特性

### 已实现
- ✅ 家教搜索和筛选（科目、年级、价格）
- ✅ 家教详情展示（资质、评价、联系方式）
- ✅ 用户评论功能
- ✅ 下拉刷新和上拉加载
- ✅ 平台认证标识

### 待开发
- 🔲 用户登录和授权
- 🔲 家教申请和认证流程
- 🔲 在线预约功能
- 🔲 支付集成
- 🔲 后台管理系统

## 测试数据

数据库初始化脚本会自动创建 10 个测试家教和 6 条评价数据。

## 开发说明

### 本地开发
后端 API 地址配置在 `miniprogram/app.js`:
```javascript
globalData: {
  apiBaseUrl: 'http://localhost:8080/api/v1'
}
```

### 生产部署
1. 后端部署到云服务器或云函数
2. 更新 `apiBaseUrl` 为生产地址
3. 在微信公众平台配置服务器域名

## 许可证

MIT