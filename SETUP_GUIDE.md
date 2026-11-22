# 家教小程序 - 快速开始指南

## 第一步: 导入项目 (5分钟)

1. 下载并安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 打开微信开发者工具
3. 选择"小程序" → "导入项目"
4. 项目目录选择: `/Users/wangwenhui/Desktop/workspace/code/wechat-app/家教小程序`
5. AppID: 可以选择"测试号"或输入你的 AppID
6. 点击"导入"

## 第二步: 开通云开发 (5分钟)

1. 在微信开发者工具中，点击顶部菜单"云开发"
2. 首次使用会提示开通，点击"开通"
3. 创建环境:
   - 环境名称: `tutor-platform` (或任意名称)
   - 环境ID: 自动生成，记下来（类似 `tutor-xxx`）
4. 复制环境 ID

## 第三步: 配置环境 (2分钟)

编辑 `app.js`:
```javascript
wx.cloud.init({
  env: '你的环境ID', // 替换这里
  traceUser: true,
})
```

编辑 `app.js` 的 globalData:
```javascript
globalData: {
  userInfo: null,
  envId: '你的环境ID' // 替换这里
}
```

## 第四步: 创建数据库 (3分钟)

1. 在微信开发者工具中，点击"云开发控制台"
2. 进入"数据库"
3. 创建集合:
   - 点击"添加集合"，名称输入 `tutors`
   - 再次点击"添加集合"，名称输入 `reviews`
4. 设置权限:
   - 点击 `tutors` 集合 → "权限设置"
   - 选择"所有用户可读，仅创建者可写"
   - 对 `reviews` 集合做同样操作

## 第五步: 添加测试数据 (10分钟)

在云开发控制台 → 数据库 → `tutors` 集合 → "添加记录":

```json
{
  "name": "张老师",
  "avatar": "https://thirdwx.qlogo.cn/mmopen/vi_32/xxx",
  "gender": "男",
  "education": "硕士",
  "school": "清华大学",
  "major": "数学系",
  "subjects": ["数学", "物理"],
  "grades": ["初中", "高中"],
  "hourlyRate": 150,
  "location": "北京市海淀区",
  "experience": "3年",
  "bio": "清华大学数学系硕士，专注于初高中数学物理辅导...",
  "credentials": [
    {
      "type": "学生证",
      "verified": true
    }
  ],
  "verified": true,
  "verifiedAt": "2026-06-18",
  "rating": 4.8,
  "reviewCount": 12,
  "wechatId": "zhang_teacher_123",
  "status": "active",
  "availability": "周末全天，工作日晚间",
  "createdAt": "2026-06-18"
}
```

添加 5-10 条测试数据。

## 第六步: 部署云函数 (5分钟)

1. 在微信开发者工具中，找到 `cloud-functions` 文件夹
2. 右键每个云函数文件夹:
   - `getTutors` → "上传并部署：云端安装依赖"
   - `getTutorDetail` → "上传并部署：云端安装依赖"
   - `submitReview` → "上传并部署：云端安装依赖"
3. 等待部署完成

## 第七步: 添加图标 (5分钟)

在 `images` 文件夹中添加 4 个图标文件:
- `home.png` (首页图标，灰色)
- `home-active.png` (首页图标，蓝色)
- `tutor.png` (家教图标，灰色)
- `tutor-active.png` (家教图标，蓝色)

建议使用:
- [Iconfont](https://www.iconfont.cn/)
- [IconPark](https://iconpark.oceanengine.com/)

尺寸建议: 81px × 81px

## 第八步: 测试 (5分钟)

1. 在微信开发者工具中点击"编译"
2. 测试功能:
   - 搜索家教
   - 查看家教详情
   - 点击"联系家教"
   - 提交评价

## 第九步: 预览 (2分钟)

1. 点击"预览"按钮
2. 用微信扫描二维码
3. 在真机上测试

## 第十步: 上传与审核 (1-3天)

1. 点击"上传"
2. 填写版本号和项目备注
3. 登录 [微信公众平台](https://mp.weixin.qq.com/)
4. 开发管理 → 开发版本 → 提交审核
5. 填写审核信息
6. 等待审核结果（通常 1-3 天）

---

## 常见问题

**Q: 编译报错"未找到 cloud functions"**
A: 确保已在 `app.json` 中添加 `"cloud": true`

**Q: 云函数调用失败**
A: 检查云函数是否已部署，环境ID是否正确

**Q: 数据库查询为空**
A: 确认集合已创建，有数据，权限设置正确

**Q: 图标不显示**
A: 检查图片路径和文件名是否正确

---

## 下一步

✅ 技术实现已完成
📋 **最重要的任务:** 找到绝望的早期采用者（采访5个家长）
🎯 **验证假设:** 家长是否信任平台认证的家教？

祝你好运！ 🚀
