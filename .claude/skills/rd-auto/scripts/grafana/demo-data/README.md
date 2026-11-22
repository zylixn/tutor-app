# AI 员工任务 Grafana 演示数据

完整的 AI 员工任务演示数据集，用于 Grafana 看板的功能演示和验收。
**所有 5 名员工均覆盖全部 5 个 AI 角色，每人有完整任务数据。**

## 文件说明

| 文件 | 用途 |
|------|------|
| `prometheus-metrics.txt` | Prometheus Exposition Format — 可直接推送到 Pushgateway，供 Grafana 消费 |
| `task-data-model.json` | 完整的任务数据模型 — 角色统计 + 活跃任务 + 高级聚合 + 员工绩效 + Pipeline 状态样本 |
| `push-demo.sh` | 一键推送脚本 — 读取 `prometheus-metrics.txt` 并推送到 Pushgateway |

## 数据覆盖

### 员工 → 团队映射

| 员工 | 团队 | 总任务数 | 总 Token | 平均得分 |
|------|------|----------|----------|----------|
| wangzk | group-di (数字智能工具组) | 48 | 811K | 89.6 |
| zhoucw | group-data (数据平台组) | 33 | 565K | 84.4 |
| lisi | group-infra (基础设施组) | 24 | 459K | 87.8 |
| zhaowu | group-platform (业务平台组) | 38 | 708K | 83.6 |
| sunqi | group-qa (质量工程组) | 31 | 332K | 90.6 |

### 角色覆盖（每人全 5 角色）

| 角色 | 总任务数 | 对应职责 |
|------|----------|----------|
| Architect | 39 | 系统设计、SPEC 生命周期 |
| Developer | 51 | 编码实现 |
| Tester | 40 | 测试验证 |
| Reviewer | 34 | 代码评审 |
| Debate | 10 | 对抗审计 |

## 数据模型（与 Grafana 看板的对应关系）

### AI 员工状态看板 (ai-employee-status)

| Panel | Prometheus 指标 |
|-------|-----------------|
| 按角色统计任务数 | `ai_dispatch_task_count{role, team}` |
| 一次通过率 | `ai_dispatch_first_pass_rate{role, team}` |
| 平均评审得分 | `ai_dispatch_avg_score{role, team}` |
| 平均耗时（分钟） | `ai_dispatch_avg_duration_ms{role, team} / 60000` |
| 活跃任务 | `ai_dispatch_task_wall_clock_ms{task, team}` |
| 按角色统计 Token | `ai_dispatch_tokens_input + ai_dispatch_tokens_output` |
| 任务耗时趋势 | `ai_dispatch_task_wall_clock_ms` |
| 阻塞任务 | `ai_dispatch_blocked_count > 0` |

### 底层数据模型 (pipeline-state.json)

每个任务的核心数据结构：

```jsonc
{
  "schema_version": 5,
  "change_name": "login-sso-refactor",
  "current_phase": "implement",
  "flow_type": "development",
  "pipeline": {
    "implement": {
      "status": "active",
      "dispatch_history": [{
        "token_usage": { "input_tokens": 45000, "output_tokens": 8000 },
        "context_mode": "full",
        "exit_status": "BLOCKED"
      }],
      "rework_reasons": ["code/implementation: null pointer"]
    }
  },
  "token_summary": {
    "by_phase": { /* ... */ },
    "by_role":  { /* ... */ },
    "by_model": { /* ... */ }
  },
  "quality_gates": {
    "QG-ARCH-001": "passed",
    "QG-DEV-001": "pending"
  }
}
```

## 使用方法

### 1. 推送演示数据到 Pushgateway

```bash
# 干跑（仅打印不推送）
bash push-demo.sh --dry-run

# 推送到默认 Pushgateway (http://192.168.5.114:9091)
bash push-demo.sh

# 推送到自定义 Pushgateway
bash push-demo.sh http://your-pushgateway:9091
```

### 2. 在 Grafana 中查看

推送后刷新以下看板（数据源 `afkjudv6hmv40a`）：

- **AI 员工状态看板**: http://192.168.5.114:3000/d/ai-employee-status
- **AI 概览看板**: http://192.168.5.114:3000/d/ai-overview
- **AI 交付深度看板**: http://192.168.5.114:3000/d/ai-delivery

### 3. JSON 数据模型分析

```bash
# 查看完整数据模型
cat task-data-model.json | jq '.employee_performance[] | {employee, total_tasks, avg_score_overall}'

# 查看角色级阻塞率
cat task-data-model.json | jq '.advanced.blocked_rate[]'
```

## 指标新鲜度

演示数据的时间戳固定为 `1748793600` (2026-06-01T00:00:00Z)，Grafana 会显示指标已过期。
推送脚本执行时会自动更新 `ai_dispatch_last_push_timestamp`。
