# 对抗审计报告：rdauto-change-entropy-tiering.md

> 审计对象：`docs/requirements/rdauto-change-entropy-tiering.md` v1.0
> 日期：2026-06-17
> 方式：Defender / Attacker 顺序对抗，主会话裁决（取证源码，非纸面推演）
> 对照：上一轮 tdd-rhythm-worktree 对抗评分 48 被否决

---

## 0. 取证基线（事实层，争议之前先锁定）

审计前先核对 4 项源码事实，它们决定 D1 的走向：

**F1. fix-push-cleanup-hook 实际走 `flow_type: "development"`，不是 quick。**
- `.harness/tasks/fix-push-cleanup-hook/pipeline-state.json:246` → `"flow_type": "development"`
- `intent.task_type: "development"`，`intent.complexity_hint: "M"`，`intent.confidence: 0.95`
- state 里**根本没有 `intent_category` 字段** → auto-upgrade-to-quick 的 `state.intent.intent_category` 判定为空，分支不进。
- 结论：本方案动机案例（30 行走全套）的真实原因是 **flow-type 被选错**（手工填 development，没走 bug_fix→quick），不是框架缺"制品强度分流"。

**F2. quick flow 已经是"轻量路径"，且根本不经过 propose 阶段。**
- `quick_transitions`（harness-rules.yaml:937-954）：`pending→intake→dispatch→verify→complete`，**5 个阶段，没有 explore/propose/design-review/test/code-review/debate**。
- 制品校验门禁（dispatch-flow.md:105-112）**只在 propose 阶段强制 proposal.md+design.md+tasks.md**；quick flow 不走 propose，这些制品**从来不被强制**。
- `verify-quick`（cli-commands.js:822-860）只校验 `artifact_paths` 数组非空 + git diff 非空，**不强制任何 SPEC 标准制品**。
- 结论：quick flow 本身就是"2 件套甚至更轻"的轻量路径。文档 §3.1 描述的 LOW（tasks.md + 测试）与 quick flow 的实际产物高度重叠。

**F3. auto-upgrade-to-quick 已实现且有完整兜底。**
- cli-commands.js:178-194：`bug_fix/quick_change/code_review/testing` + confidence≥0.85 + affected_files≤3 → 自动升 quick。
- `upgrade-to-full`（cli-commands.js:868-910）：quick 中 sub-agent 返回 BLOCKED(task_too_large) → 升级回 development。
- 文档 §3.4 提的"Worker BLOCKED 升级"**复用的就是这个已存在机制**——文档却把它当成 entropy 的新兜底，实为既有能力。

**F4. hotfix 已跳过 architect/tester/debate + QG-ARCH-001。**
- harness-rules.yaml:303-334。即"制品强度降级 + 阶段数减少"在 hotfix 维度已落地。

> 基线裁决：**框架已有两套机制（flow-type 阶段分流 + quick 轻量路径 + hotfix 降级），共同覆盖了 entropy 想解决的场景。** F1 更直接证明：动机案例是 flow-type 选择 bug，不是制品分流缺失。

---

## 1. Defender 立场（防守）

### D-支撑1：entropy 与 flow-type 是正交维度，不是重复
- flow-type 决定**走哪些阶段**（阶段数）；entropy 决定**每阶段产什么**（制品强度）。文档 §3.2 的例子成立：LOW entropy + bug → hotfix flow（阶段少）+ 轻量制品；HIGH entropy + 新功能 → development flow（阶段全）+ 全套制品。
- 即便 quick flow 阶段少，quick 流下 sub-agent 若被注入"必须产出 proposal"的指令仍会产出——entropy 决定的是**指令层的制品要求**，与阶段数正交。

### D-支撑2：动机真实，问题确有系统性根源
- fix-push 30 行 vs 2400 行文档、文档量是代码量 80 倍——over-engineering 的诱因客观存在。
- 文档把"文档完整性当质量代理指标"列为根因，是对 Reviewer 行为的合理刻画。

### D-支撑3：误判有非对称兜底
- 文档 §3.4 三通路（PM override / Worker 升级 / Reviewer 补制）针对 HIGH 误判 LOW（漏设计）的严重方向。
- LOW 误判 HIGH（多写文档）只是冗余，非致命。

### D-支撑4：风险表诚实
- 文档自评"综合风险 HIGH，触及 SPEC 生命周期核心假设，需 Architect 重设计 + debate 把关"——没有粉饰复杂度风险。

> Defender 承认的弱点（诚实义务）：F1 表明动机案例的诊断不准（是 flow-type 选错，非缺 entropy），这削弱了"必须新增维度"的论证力度。

---

## 2. Attacker 攻击（默认怀疑）

### A1（→D1，致命）：动机案例诊断错误，根因被误判
- fix-push 走 development 的真实原因（F1）：主会话手工把 `task_type` 填成 `development`、没填 `intent_category`，导致 auto-upgrade-to-quick（cli-commands.js:178）不触发。
- **如果当初 task_type 填 `bug_fix` 且 confidence 0.95 + affected_files≤3，它本来就会自动升 quick，走 `intake→dispatch→verify→complete`，根本不会产出 proposal/design/spec**。
- 因此"30 行走全套"不是框架缺陷，是**调用层（主会话填 intent-json）没遵守 flow-type 选择规则**。entropy 是给一个**被误诊的根因**开的新药。
- 推论：修 `parse-intent` 让 bugfix+根因明确强制 quick/hotfix（替代 A），1/N 成本解决同一问题。

### A2（→D1，致命）：LOW 制品矩阵与 quick flow 实际产物几乎完全重叠
- 文档 §3.1 LOW = tasks.md + 测试。quick flow 实际产物（F2）= dispatch 产出 + git diff，**比 LOW 还轻**。
- entropy 想"在 development flow 内做制品降级"——但 **flow-type=development 的语义就是"需要完整追溯"**。在 development 内偷偷降制品，等于让 development flow 名实不符，制造 flow-type × entropy 的笛卡尔积歧义（quick/LOW、quick/MID、dev/LOW、dev/MID、dev/HIGH、hotfix/LOW...），新 PM 难以预测自己的变更会走哪套。
- 这是典型的**两个正交维度叠加导致组合爆炸**：11 维 flow-type × 3 级 entropy = 高认知负担，违反框架自身 `simplicity_first` 围栏（harness-rules.yaml:644）。

### A3（→D2）：entropy 判定维度在 intake 阶段不可计算
- `affected_files`（预估）：intake 时还没分析代码，靠 PM 口述或关键词猜——F1 案例 confidence 0.95 都没救活 flow-type，说明 intake 阶段信号本身就不可靠。
- `root_cause_clarity`：文档自承"PM 可标注"——**纯主观**，且 PM 倾向于乐观标注（少写文档），系统性偏向 LOW（漏设计的危险方向）。
- `is_new_module` 边界模糊：新增文件 vs 新增目录 vs 现有模块加文件，无客观判据。
- 三维都不可靠 → entropy 等级基本是**掷骰子**。误判兜底（A-反驳）是事后补救，不能挽救"intake 阶段就定错级别"的系统性偏差。

### A4（→D3）：LOW 制品砍掉 proposal/design 后无法重建决策上下文
- fix-push 的 design.md/risk-assessment 即便"重"，归档后记录了"为什么选方案 A（cwd 兜底+warn 降级）而非方案 B/C"。
- tasks.md 只有"做什么"，没有"为什么这么选、考虑过什么、放弃了什么"。半年后看 commit，LOW 制品无法回答"当时为什么没选另一条路"。
- 文档 §五把此风险标为 LOW（"tasks.md + 测试 + git history 已够"）——**低估**。git history 记录的是 what，不是 alternatives considered。

### A5（→D4）：moving parts 与门禁链路复杂度
- 影响面（文档 §四）触及 orchestrator intake + harness-rules.yaml + rd-auto SKILL + QG-ARCH-001 + 三通路兜底。任一处不一致就出 bug。
- QG-ARCH-001 按 entropy 分级 = **门禁强度随主观判定浮动**，削弱了门禁的"硬"属性（QG 本应是不可商量的）。
- 框架学习成本：PM 现在要同时理解 flow-type（阶段）× entropy（制品）× context-mode（token）三个正交维度，违背"PM 只说人话"（SKILL.md 核心原则）。

### A6（→D-支撑3）：兜底链路存在失效路径
- PM override：PM 若就是误判的那个（A1 已证 PM 会误判），override 反而固化错误。
- Worker BLOCKED 升级：依赖 Worker 主动声明 task_too_large——Worker 在 LOW 制品要求下可能**不会去探查完整设计**，因此根本意识不到任务"too large"，BLOCKED 不触发 → 漏设计静默通过。
- Reviewer 补制：code-review 在 quick/dev-LOW 下若阶段已被跳过（无 design-review），Reviewer 没有"设计审查"前置，只能在事后猜"是不是缺设计"——事后补制的设计是**写给自己看的 retrofit**，无决策价值。

---

## 3. 被忽视场景

### S1：MID 熵的边界稳定性
- affected_files 4-8 判 MID，但"4 文件 vs 3 文件"的工程意义差异极小，却跨越 LOW/MID 两档制品要求。临界点抖动导致同一变更两次跑出不同制品强度，可追溯性不一致。

### S2：entropy 与 team mode / fanout 的交互未定义
- harness-rules.yaml:781 fanout blocklist 已对 quick/hotfix/docs force_legacy。entropy LOW 若允许 team mode？文档未提。entropy 与 recommend-mode 的耦合关系空白。

### S3：归档/审计视角的回溯断链
- archive 阶段（harness-rules.yaml spec_lifecycle）依赖 proposal/design/spec 文档做"SPEC 状态流转"。LOW 砍掉这些，archive 校验（spec 完整性）会失败或形同虚设。文档 §四说"QG-ARCH-001 按 entropy 分级"——等于**为 LOW 开门禁口子**，门禁一旦分级就不再是 gate。

### S4：测试覆盖回归（ LOW 的"测试"指什么）
- LOW 制品 = tasks.md + 测试。但"测试"是单测？集成？回归？TDD Iron Law 在 LOW 下还强制吗？文档未定义，与 workflow.tdd_check（harness-rules.yaml:149）的关系未交代。

---

## 4. 替代方案评估

### 替代 A：只修 flow-type 选择规则（推荐）
- 改动点：`parse-intent` + intent-parsing.md，让 bug_fix/根因明确 + affected_files≤3 **强制** quick/hotfix，并**自动推断** intent_category（不再依赖手工填）。
- 修 F1 的真实 bug：主会话填 intent-json 时漏 intent_category 导致 upgrade 不触发——补一个"bug_fix 关键词→自动补 intent_category"的兜底。
- 成本：~1 个文件 + ~1 个测试，不新增维度。
- 解决度：**直接消除 fix-push 案例的根因**（A1 已证）。quick flow 本身已是轻量路径（F2），无需再造 LOW 制品矩阵。
- 评分：**最优**。1/N 成本，零新增认知维度。

### 替代 B：flow-type 内"制品可选"提示（次选）
- 在现有 flow-type 上加提示：bug_fix 走 development 时，Architect 可主动合并 explore+propose、spec.md 标可选。
- 不强制、不新增判定维度，靠 Architect 判断。
- 成本：低，文档级。
- 缺点：依赖 Architect 自觉，可能不一致；但比 entropy 笛卡尔积简单。
- 评分：**可接受**，作为 A 的补充而非替代。

### 替代 C：维持现状 + PM 培训（兜底）
- 上次教训（fix-push）的本质是 PM/主会话选错 flow-type。
- 写一条规则："bug 类修复默认 task_type=bug_fix / intent_category=bug_fix，禁止手填 development"。
- 成本：最低。
- 缺点：人治，易复发。但作为 A 的执行规范是必要的。
- 评分：**作为 A 的配套**，单独用不够。

> 替代排序：**A > B > C**。三者组合（A 修机器推断 + B 留 Architect 灵活度 + C 规范人）共同覆盖 entropy 想解决的全部场景，且零新增正交维度。

---

## 5. 评分（立项输入成熟度）

| 维度 | 分 | 说明 |
|------|----|------|
| 问题真实性 | 12/20 | over-engineering 客观存在，但动机案例根因被误诊（F1：flow-type 选错，非缺 entropy），扣 8 |
| 方案必要性（vs 已有机制） | 6/25 | quick/hotfix 已是轻量路径（F2/F4），entropy 与 flow-type 重叠且笛卡尔积（A2），扣 19 |
| 判定客观性 | 5/15 | affected_files/root_cause_clarity/is_new_module 三维在 intake 阶段不可靠（A3），扣 10 |
| 追溯完整性 | 7/15 | LOW 砍 proposal/design 断决策上下文（A4/S3），archive 门禁被打穿，扣 8 |
| 复杂度/成本 | 8/15 | moving parts 多 + 三通路兜底有失效路径（A5/A6），违反 simplicity_first，扣 7 |
| 风险诚实度 | 12/10 | 文档自评 HIGH 风险、承认需重设计——诚实加分（本项封顶 10） |

**合计：50/100**

> 对比 tdd-rhythm-worktree（48）：分数相近，但本方案的问题诊断错误更严重（动机案例被 F1 直接证伪），属于"给误诊的根因开新药"。略高于 48 是因为替代方案清晰（A/B/C 路径明确）。

---

## 6. 裁决

**改用替代方案（A 为主，B/C 配套），不立项 entropy 维度。**

理由一句话：**框架已有 flow-type（阶段分流）+ quick（轻量路径）+ hotfix（制品降级）三套机制覆盖了 entropy 想解决的场景，而动机案例（fix-push）的根因经源码取证（pipeline-state.json:246 flow_type=development + intent 缺 intent_category）是 flow-type 选择 bug，不是制品分流缺失——entropy 是对误诊根因的过度工程化，修 parse-intent 的 bug_fix→quick 自动推断（替代 A）即可 1/N 成本解决同一问题。**

P0 致命项：1（A1/A2 合并：动机误诊 + 与 quick 重叠，动摇立项前提）。
最佳替代：**替代 A**（修 flow-type 自动推断 + 自动补 intent_category，强制 bug_fix 走 quick）。
