# SPEC: 评论防重 (P0-3)

## 能力描述
同一用户对同一家教仅允许一条评论，支持修改已有评论。

## 前置条件
- 数据库为测试数据，可丢弃重建

## 输入
- `POST /api/v1/reviews` 请求体：`{ "tutorId": "<家教ID>", "rating": 1-5, "content": "<评论内容>" }`

## 输出
- 新评论：`{ "message": "评论提交成功", "reviewId": "<ID>" }` HTTP 201
- 重复提交（未修改场景）：`{ "error": "您已评论过该家教" }` HTTP 409
- 修改已有评论：`{ "message": "评论修改成功", "reviewId": "<ID>" }` HTTP 200

## 行为规格

### 数据库约束
1. `reviews` 表新增 UNIQUE 约束：`UNIQUE(tutor_id, user_id)`
2. 删除现有数据库文件，重新初始化 schema

### 应用层逻辑
1. 提交评论前查询：`SELECT id FROM reviews WHERE tutor_id = ? AND user_id = ? AND status = 'active'`
2. 若不存在：INSERT 新评论（现有逻辑不变）
3. 若存在：
   - 更新已有评论的 `rating`、`content`、`created_at`（作为修改时间）
   - 重新计算家教平均评分
   - 返回 HTTP 200 + "评论修改成功"

### 修改评论流程
```
tx.Begin()
  UPDATE reviews SET rating = ?, content = ?, created_at = CURRENT_TIMESTAMP
    WHERE tutor_id = ? AND user_id = ? AND status = 'active'
  UPDATE tutors SET rating = (SELECT AVG(rating) FROM reviews WHERE tutor_id = ? AND status = 'active')
    WHERE id = ?
tx.Commit()
```

## 数据模型变更

### Schema 变更
```sql
-- reviews 表新增约束
CREATE TABLE reviews (
    ...
    UNIQUE(tutor_id, user_id)
);
```

### .env.example 更新
无新增配置项。

## 边界条件
- 并发提交同一用户同一家教评论时，数据库 UNIQUE 约束兜底，应用层返回 409
- 修改评论时评分和评论数不需要 +1（review_count 不变）
- `created_at` 更新为修改时间（简单实现，不区分创建/修改时间）
