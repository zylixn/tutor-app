# 对抗审计报告：rdauto-shared-context-reuse.md

> 对抗编号：DB-shared-context-reuse
> 审计对象：`docs/requirements/rdauto-shared-context-reuse.md`（v1.0，草案待立项）
> 日期：2026-06-17
> 触发：PM 要求对抗审计（同批 tdd-rhythm-worktree 48 分被否决、change-entropy 50、review-scoring 44 均建议不立项）
> 证据基准：源码 + 真实 pipeline-state 样本（非纸面推演）

---

## 一、争议主题

方案主张：hub-and-spoke 模型导致"代码理解无法在角色间复用"，每个 Worker 独立重建上下文（fix-push-cleanup-hook 中 `pre-tool-use-git-guard.sh` 被读 4 遍），是结构性成本。拟在 `.harness/shared-state/<change>/context.md` 新增"只读代码地图"，由首个深度读代码的角色写入，orchestrator 在 dispatch 时注入给后续角色，并靠 schema（只允许事实、禁止主观/指令）防止变相通信。

---

## 二、Defender 论据（为方案辩护）

D-A. summary 确实薄：现有 `agent_history` 注入的是每阶段 ≤500 字、token 预算仅 1000 的 `summary`（cli-commands.js:426 `summary.slice(0,500)`；constants.js:53 `agent_history maxTokens 1000`）。500 字装不下"涉及文件清单 + 关键函数/行号 + 数据流 + 不变量"这种结构化代码地图。context.md 提供独立的、更大预算的结构化产物，是 summary 的补强而非重复。

D-B. summary 是"任务完成情况"自述（看真实样本：`产出 4 份标准制品...tasks.md 9 条任务覆盖...`），不是"代码地图"。两者语义不同：summary 回答"我做了什么"，context.md 回答"这段代码长什么样"。把代码理解硬塞进 summary 会稀释 summary 的进度汇报职责。

D-C. 事故实证（stash drop 误操作）确实暴露"无持久化中间理解产物"的真实痛点——回退只能靠 stash 这种脆弱机制。一份持久化的 context.md 能给事故恢复提供锚点。

D-D. schema 约束（只允许文件路径/行号/函数签名/不变量/客观根因，禁止主观/指令/评价）在原则上能划清"共享事实"与"角色对话"。文件路径是中立的。

D-E. concerns.json 已是跨角色共享（Reviewer 写、advance/developer 读）的先例，context.md 复用同一目录约定，不引入新机制范式，只是多一种文件。

---

## 三、Attacker 论据（默认怀疑，取证攻击）

### A1 [致命] 方案的"前置假设"在源码层面已被证伪——context 共享机制已存在

方案第一节断言："hub-and-spoke 禁止 Worker 间通信……**没有提供'共享只读上下文'的机制**：代码理解作为中间产物无处安放"。

**源码证伪**：
- `cli-commands.js:778,794` —— `cmdDispatchPrompt` 调用 `getPreviousSummary(state, phase)`，把前一阶段 summary 注入 `previous_summary` 字段
- `advance.js:39-48` —— `getPreviousSummary` 回溯取最近有 summary 的前序阶段
- `context-pack.js:374-391` —— full 模式下 `agent_history` 聚合 **所有** 已完成阶段的 summary
- `dispatch-with-skill.md` `<agent_history>` 段 —— 注入模板里明确写 `<!-- 此前各阶段摘要，帮助理解任务脉络 -->`
- `harness-rules.yaml:622-627` —— `proactive_summarization`：第 4 个 dispatch 前主动摘要前序角色，"各自 500 字摘要"

方案要解决的就是"第 4 个 dispatch 前的前序角色理解复用"——而 `proactive_summarization` 已经在干这件事。方案 §三.3.3 的"orchestrator 注入点"是对一个已存在注入点的重复发明。

### A2 [致命] 方案声称的"代码理解无处安放"被真实样本直接打脸

refine-exit-status-routing 的 explore 阶段 summary（真实 pipeline-state）：
> `紧约束产出 1 份 design.md. D2 选项A(只P0停). ... 附带发现存量bug: `advance.js:343-350` P0 veto 读 concernsData.concerns 与实际 `{p0:[],p1:[]}` schema 不符, 本变更顺带修.`

这里已经包含方案 §3.1 想要的全部要素：**文件路径 + 精确行号（advance.js:343-350）+ 根因定位（schema 不符）**。fix-push-cleanup-hook 的 explore summary 同样含完整根因定位。

结论：方案声称要新增的"代码地图"，**已经在 agent_history 里跨角色传递了**。方案的增量是"结构化 + 更大预算"，而非"从无到有"。立项文档的"问题陈述"在事实层面是错的——这会让 PM 基于错误前提做立项决策。

### A3 [致命] D2 维度：验收标准 #3 的核心假设（"读 4 遍→读 1 遍 + 3 摘要"）无法成立

方案 §六验收标准 #3：`回溯验证：fix-push-cleanup-hook 若有 context.md，hook 实现从'读 4 遍'降到'读 1 遍 + 3 次摘要'`。

攻击：各角色读代码**目的根本不同**，共享摘要无法替代目的性阅读：
- Architect explore：定位根因（为什么 rm 静默失败）
- Architect propose：细化改动点（改哪几行、接口怎么变）
- Developer implement：精确改写（要看到完整上下文才能安全编辑）
- Reviewer code-review：对抗性找问题（注入是否彻底、边界条件）

其中 **Developer implement 和 Reviewer code-review 无论如何都要 Re-read 原文件**——Developer 不能基于别人的摘要就 Edit 代码（CLAUDE.md "精准变更"原则要求看到真实代码），Reviewer 不能基于 Architect 的"根因摘要"就放行改动。摘要只能省掉 explore→propose 之间的一段重复，而那部分 `agent_history` 已经覆盖了。

更关键：方案自己 §3.3 承认"角色可选择 Re-read 原文件深入"——这意味着 context.md 注入后，后续角色**仍会读原文件**，"读 4 遍"并不会变成"读 1 遍"。验收标准 #3 是一个不可证伪、也无法达成的伪指标。"读 4 遍"是定性观察，全程**没有任何 token 成本量化**（方案 §1 的"实证"只有次数，没有重建上下文的实际 token 消耗）。这是"想象痛点"而非"测量痛点"。

### A4 [重大] D3 维度：变相通信红线——schema 无法划清"事实"与"偏向"

`harness-rules.yaml:512-517`：
```yaml
communication:
  topology:
    - "PM <-> main_session (bidirectional)"
    - "Workers -> main_session (unidirectional report)"
  hub: main_session
  rule: "Workers MUST NOT communicate directly with each other"
```
`harness-rules.yaml:596-600` dispatch_restrictions.must_not_include 明确含 `其他 Worker 的原始对话历史`。

攻击：hub-and-spoke 禁通信的本质不是防"完整对话"，而是防"**串联偏见**"——A 的结论（哪怕以事实形式）塑造 B 的独立判断。context.md 的 schema 约束防不住这个：
- "选择放哪些事实"本身就是偏向。Architect 决定记 `advance.js:343-350` 这个 bug、不记别处，就是在引导 Developer/Reviewer 的注意力。
- "这个函数有副作用" / "这个模块耦合度高" / "根因在 X"——方案 §3.2 表格自己把这些归为"客观描述/允许"，但"有副作用""耦合高""根因在 X"都是**判断**不是中立事实。Architect 写"根因定位"（方案明列允许），但"根因"本身就是 Architect 的分析结论，注入给 Reviewer 就是在污染 Reviewer 的独立根因判断。

方案的缓解（§5：schema + Reviewer 抽查）是把红线执行成本转嫁给 Reviewer，而 Reviewer 本就要做对抗审查，再加一道 context.md 主观性抽查是净增负担。**这是用一个新文件系统性地、在每次 change 里、持续地突破 hub-and-spoke 红线，去换一个未被量化的 token 节省。**

### A5 [重大] D4 维度：过时刷新制造新的"Worker 通信口子"，且刷新无强制机制

方案 §5：`摘要过时（代码改了 context 没更新）—— Developer 改动后可刷新 context；context 标 timestamp`。

攻击：
- "Developer 改动后刷新 context" = Developer 写 context.md 给 Reviewer 读 = **又一条 Worker 间通信通道**，且 Developer 是最没资格写"代码地图"的角色（他刚改完，视角是"我改了什么"而非"这段代码长什么样"）。这和 §3.1"写入者：首个深度读代码的角色（Architect）"自相矛盾——到底谁写？
- "标 timestamp" + "可 Re-read 核实"只是免责声明，不构成机制。角色会信任注入的内容（因为它是"前序角色的权威理解"），过时摘要误导决策的风险是 MEDIUM 但缓解是 LOW 等级的"标注"——缓解力度与风险不匹配。
- 没有强制刷新触发器（没有 hook 在 implement 后校验 context.md mtime vs 代码 mtime）。在 CI 自动化链（非交互）里，过时 context.md 会静默误导 Reviewer/Tester。

### A6 [重大] D5 维度：与 design.md / concerns.json / context-pack 的边界会混乱

四类文件职责重叠：
- `context.md`（方案）：代码现状的客观描述——但 design.md 的 `## Decisions` + problem-analysis.md 已经描述代码现状与问题
- `spec_docs` 注入（context-pack.js:337-372）已经把 design.md Decisions 段 + tasks.md 进度注入
- 同一段"根因"，Architect 可能写在 proposal.md / problem-analysis.md / context.md 三处

方案 §3.4 用一张表区分 context.md（事实/无需审批）vs design.md（决策/需审批），但实际产出中"事实"与"决策"无法干净分离——"这个 bug 的根因是 schema 不符"既是事实描述也是 Architect 的分析判断（决策的前提）。多一处持久化产物 = 多一处一致性维护成本 = 多一处过时风险。

---

## 四、被忽视场景

N1. **探索/简单 change 不需要**：方案默认每个 change 都产 context.md，但 minimal/read_only 模式（context-pack.js:306-312）本就是为探索/检查类任务省 token 的。给 5 分钟探索任务强制产一份代码地图是负担。

N2. **fanout 并行场景**（dispatch-fanout.md 存在）：并行 Worker 同时读 context.md 无冲突，但若 context.md 由其中一个 Worker 写，会破坏并行独立性。方案完全没提 fanout。

N3. **CI 自动化链的一致性**：方案聚焦本地交互链，但 `.claude/tools/scripts/ci/*` 的非交互执行面是否同步注入 context.md？CLAUDE.md 明确"改流程时必须同时检查本地 skill 侧和 CI 脚本侧"——方案影响面表（§四）完全没提 CI 侧。

N4. **context.md 的生命周期清理**：shared-state `lifecycle: "change complete 时自动清理"`（yaml）。context.md 跟着清理没问题，但方案没说明 rework 循环（code-review→rework→code-review）里 context.md 如何更新——rework 改了代码，旧 context.md 会误导第二轮 review。

N5. **token 预算冲突**：TOTAL_TOKEN_BUDGET=5000（constants.js:56），现有 6 个 source 已分完。context.md 作为第 7 个 source 注入会挤压 acceptance_criteria（优先级 1，5000）或 agent_history。方案没给 context.md 在 budget 里的位置——是替换 agent_history 还是并列？并列则总预算超标。

---

## 五、替代方案评估

| 替代 | 描述 | vs 方案 | 评分 |
|------|------|---------|------|
| **A（推荐）扩展现有 agent_history** | 不新增文件。把 `agent_history` 的 `maxTokens` 从 1000 提到 2000-2500，并在 architect/developer agent 定义里要求 summary 含结构化代码要点（文件:行号、不变量）。注入逻辑零改动（已存在）。 | 等价收益、零新文件、不碰红线、零新 schema。方案的全部"真增量"（更大预算+结构化要求）用这个就能拿到。 | **优** |
| **B dispatch-prompt 注入"前序角色读过的文件清单"** | 只注入路径列表（`Architect 读过: advance.js, cli-commands.js`），各角色自己 Re-read。 | 比 A 弱——清单省不了 Re-read（A3 已论证），等于变相承认摘要没用。 | 中下 |
| **C 维持现状** | context-pack + proactive_summarization 已覆盖跨角色理解复用。不动。 | 解决了方案想解决的 80%，零成本。剩下 20%（更大预算）用 A 补。 | **优** |
| 方案原案 | context.md + schema + 注入逻辑 + Architect 契约 + Reviewer 抽查 | 新增 4-5 处改动，触碰红线，重复发明，伪验收指标。 | 差 |

**最佳替代：A + C 组合**——扩展现有 agent_history 预算并约束 summary 结构，维持现有注入链。一行 maxTokens 调整 + agent 定义里两句话，拿到方案的全部真增量，零红线、零新机制。

---

## 六、评分与裁决

### 评分维度（0-100）

| 维度 | 分数 | 依据 |
|------|------|------|
| 问题真实性 | 8/25 | 痛点部分真实（stash drop 事故），但核心前提（"无共享机制""代码理解无处安放"）被源码与真实样本证伪。token 成本未量化，"读 4 遍"是想象成本。 |
| 方案增量性 | 3/25 | 与 context-pack.agent_history 严重重复，注入点重复发明。真增量（更大预算+结构化）可用替代 A 一行配置达成。 |
| 红线安全 | 8/25 | 系统性突破 hub-and-spoke（yaml:517 硬规则）。schema 防不住"选哪些事实=偏向"，Developer 刷新 context 制造新通信口子。缓解转嫁 Reviewer。 |
| 边界清晰 | 10/15 | context.md vs design.md 表格有思考，但事实/决策实际不可分，多产物一致性成本被低估。fanout/CI/rework 场景缺失。 |
| 可验收性 | 4/10 | 验收 #3（读4遍→读1遍+3摘要）伪指标、不可证伪。其余标准可测但建立在错误前提上。 |

**总分：33 / 100**

### 裁决

**不通过（不立项）。**

方案建立在两个被源码证伪的错误前提上（"无共享机制""代码理解无处安放"——`agent_history`/`previous_summary`/`proactive_summarization` 早已实现，真实 summary 样本含文件:行号级根因），且系统性触碰 hub-and-spoke 通信红线（yaml:517）——schema 约束防不住"选择哪些事实=偏向"，Developer 刷新 context 更是新通信口子。最佳替代是**扩展 `agent_history` 的 token 预算（constants.js:53，1000→2000）+ 在 architect agent 定义里要求 summary 含结构化代码要点**，一行配置拿到方案全部真增量，零新文件、零红线。

立项前必须：先用真实 token 量化证明"读 4 遍"的实际重建成本 > 扩展 agent_history 预算后的边际收益；否则属于重复发明 + 红线扩张。

---

## 七、致命漏洞速览

- P0-1：问题前提被源码证伪（A1+A2）——"无共享机制"为假
- P0-2：验收 #3 伪指标、核心收益不可证伪（A3）
- P0-3：系统性突破 hub-and-spoke 通信红线（A4）
- P1-1：Developer 刷新 context 自相矛盾 + 制造新通信口子（A5）
- P1-2：与 design.md/spec_docs/concerns.json 边界混乱（A6）
- P1-3：fanout / CI / rework 场景完全缺失（N2/N3/N4）
