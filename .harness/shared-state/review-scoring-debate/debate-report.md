# 对抗审计报告：rdauto-review-scoring-calibration.md（v1.0）

> 审计对象：`docs/requirements/rdauto-review-scoring-calibration.md` v1.0（评审评分校准）
> 审计日期：2026-06-17
> 审计方式：Defender/Attacker 顺序对抗 + 主会话裁决（基于源码取证，非纸面推演）
> 校准锚点：`tdd-rhythm-worktree-debate`（动机/证据错配 + 虚构前提 + 1/10 替代 → 48 分否决）

---

## 一句话裁决

**方案立论建立在对单一样本（fix-push 78→92）的过度解读上，其"博弈"指控被同期反例（refine-exit-status-routing 93 分一次过）直接证伪；核心实证（78 分及 C001/C002 维度拆分）在状态中从未落库、不可回溯；选项 C（维度去耦）所解决的"耦合"问题在现有 Reviewer 契约中根本不存在（契约已输出 7 维独立分）。存在成本 1/20 的替代方案（删一行 + 写一行 memory）。不予立项，改替代方案。**

---

## 0. 取证基础（对抗的事实底盘）

| 事实 | 取证 | 对方案的影响 |
|------|------|------------|
| **78 分从未落库** | `grep "78" .harness/tasks/fix-push-cleanup-hook/` 零命中；`scores.reviewer` 只存最终 92 | 致命：验收标准 #4（"回溯验证 78 分中 C001/C002 剥离后代码质量分 ≥85"）无法验证——首轮分数及维度分被 advance.js:173 覆盖，未持久化 |
| **C001/C002/C003/C004 在任何 concerns.json 中不存在** | 全仓 grep `C00[1-4]` 仅命中本需求文档自身；fix-push 无 shared-state concerns.json；agent-defs-slim 的 concerns 是 P0-001~P1-006（实质性技术问题，非"流程性"） | 致命：方案的"具体痛点"（C001 流程问题拖累 Developer 评分）是叙述构造，无对应的结构化证据 |
| **Reviewer 契约已输出 7 维独立分** | `reviewer.md:42-52` 评分维度表 + `reviewer-scoring-guide.md:129-150` 输出格式 `scores:{spec_compliance, code_quality, testing_coverage, performance, security, maintainability, documentation}` | 致命：选项 C（维度去耦）解决的"耦合"在契约层不存在——流程合规（spec_compliance）与代码质量（code_quality）本就是独立维度分 |
| **反例：refine-exit-status-routing 93 分一次过** | `pipeline-state.json: total_rework_loops:0, first_pass_rate:1, reviewer:93` | 致命：若 Reviewer 真在"博弈让流程推进"，同期同 Reviewer 同模型为何不制造 rework？反例直接证伪"系统性博弈"论点 |
| **fix-push 78→92 的 +14 由流程性问题解决贡献** | 文档自承（line 25）；且 `rework_count.reviewer:0` + `total_rework_loops:1` 说明这是 code-review 的一次重审 | 反而是反证：Reviewer 真指出了问题（T-07 未完成、文档 drift、现场清理未授权），解决了就加分——这是评审**正常工作**，不是博弈 |
| **"HIGH entropy" 是未实现的借用概念** | harness-rules.yaml 全文无 entropy/HIGH_M；该概念来自另一份未立项的 `rdauto-change-entropy-tiering.md` | 重大：选项 B（双 Reviewer 仅 HIGH entropy 启用）依赖未实现的 entropy 分级，前置条件缺失 |
| **advance 路由对分数的"消费"是机器硬阈值** | `advance.js:384-425`：score 经 `>=90 / [80,90) / [75,80) / <75` 四档硬路由；review-gate.py 同构 | 重大：阈值是问题，但"评分被流程预期反向牵引"是 Reviewer（LLM）行为问题，与机器路由阈值是两层——方案把 LLM 行为问题包装成路由机制问题 |

---

## 1. Defender 立场（尽力辩护）

**D1. 阈值硬编码确实制造"锚定偏差"。** 80/90/75 三个魔法数是机器消费的唯一判据（advance.js + review-gate.py 双侧硬编码）。LLM Reviewer 知道"78 会进 Debate、92 会 direct pass"，在打分时锚定阈值是真实认知偏误——即便非恶意博弈，"为了让流程能走"的反推工程也可能在潜意识层发生。引入 stateful 增量 + 双 Reviewer 校准，是消除单点主观的标准工程手段。

**D2. 评分主观不等于"不该优化"。** 代码评审本质有主观成分，但"主观"不是"随机"——同一份代码，规范合规/测试覆盖/安全是可校验的硬指标，只有可维护性/文档质量有弹性。把可校验的维度（流程合规）从主观综合分中拆出来独立门禁，让主观只落在真正弹性的维度，是减少噪音、不是伪科学。

**D3. stateless 评审是真实缺陷。** 取证确认：rework dispatch 不注入首轮 review summary（advance.js 的 buildReworkResponse 不传 prior review context；line 777 的 rework_context 仅记 `score=X, P0=Y` 摘要，不含维度分/具体 concern）。这意味着二次评审是"全新上下文全量复审"——既浪费 token，也给了重新博弈的空间。改成"只验 delta（上轮 P0/P1 是否解决）"是聚焦的增量评审，动机合理。

**D4. 方案自识风险（§五风险表）较诚实。** 列了"增量评分纵容首轮低分""双 Reviewer 成本翻倍""维度去耦后流程被忽视"，且给了缓解（首轮分数留痕 + rework 次数计入 + 流程合规独立门禁）。诚实度可接受。

---

## 2. Attacker 反击（逐一击穿）

### A1. 【P0 致命】"博弈"立论建立在对单一样本的过度解读，且被同期反例直接证伪

**样本量 = 1。** 整份需求文档的全部实证支撑，就是 fix-push-cleanup-hook **一次** 78→92 的 rework 弧线。没有第二个样本，没有控制组，没有跨时间的评分分布统计。从单一样本推出"系统性博弈倾向"（line 13、根因 #3），是统计上不成立的过度归纳。

**反例就在隔壁。** 同期、同 Reviewer 角色、同模型（glm-5.2）的 refine-exit-status-routing：**93 分一次过，total_rework_loops:0，first_pass_rate:1**。如果"评分被流程预期反向牵引、向让 pipeline 推进靠拢"是系统性行为，那这个变更理应也出现"恰到好处"的分数波动或被制造一次 rework。它没有。文档 line 106 试图把反例收编为"间接佐证"（"紧约束后评审更聚焦"）——这是把**反驳证据**重新解释成**支持证据**，经典的确认偏误。一个能同时解释"78→92 的波动"和"93 一次过"的更简解释是：**Reviewer 按真实质量打分，fix-push 确实有可改进项（T-07 未完成、文档 drift、现场清理未授权），refine 确实干净**。博弈论是多余的、不可证伪的叙事层。

> Defender D1 的"锚定偏差"在认知科学上成立，但**本仓库无实证**。要主张"系统性博弈"，至少需要：跨 N 个变更的评分分布分析、或双盲对照（同一代码两个 Reviewer 系统性分差 >10 的频次）。文档两者皆无。**用认知偏误的合理性替代实证，是把假设当结论。**

### A2. 【P0 致命】核心实证数据（78 分、C001/C002 维度拆分）从未落库，验收标准 #4 不可验证

**78 分在状态中不存在。** 取证 `grep "78" .harness/tasks/fix-push-cleanup-hook/` 零命中。`scores.reviewer` 只持久化了最终值 92（advance.js:173 `state.scores['reviewer'] = score` 每次覆盖）。首轮评审的分数、维度分（spec_compliance / code_quality / ...）、加分明细（`-3 -2 -2`）**全部丢失**。

**C001/C002/C003/C004 是叙述构造。** 全仓 grep `C00[1-4]` 仅命中本需求文档自身。fix-push-cleanup-hook 没有 shared-state concerns.json；唯一的 concerns 样本（agent-defs-slim）用的是 P0-001~P1-006 编号，且全部是**实质性技术问题**（hotfix_transitions 残留 smoke、@include 无处理机制、auto_smoke 死配置）——没有一条是文档所说的"C001 未 commit 这种流程性问题"。

**验收标准 #4 因此不可验证：** "回溯验证：fix-push 第 1 次 78 分中，C001/C002 流程性问题剥离后，代码质量分应 ≥85"。78 分不存在、维度分不存在、C001/C002 不存在——这条验收标准要验证的对象**没有一个在系统里有记录**。一份需求文档的核心验收标准指向不存在的数据，照此立项会在实施阶段发现"无法回溯验证"。

> 这与 tdd-rhythm 案例的结构完全同构：**动机建立在不存在的实证上**。tdd 的"Developer 节奏实证"不存在（事故主角是 Reviewer/Tester）；本方案的"78 分 + C001 流程拖累"实证不存在（数据未落库、concerns 编号对不上）。Defender D3 说的 stateless 缺陷是真实的（rework 不注入 prior context），但那是 token 效率问题，不等于"博弈"。

### A3. 【P0 致命】选项 C（维度去耦）解决的"耦合"在现有契约中不存在

方案 §三选项 C 声称："把流程合规与代码质量拆成独立分……流程问题不拉低代码质量分"，并把它列为"直接解决本次 C001 流程问题拖累评分的具体痛点"（line 68）+ 推荐短期落地的两选项之一。

**但现有 Reviewer 契约已经这么做了。** 取证：
- `reviewer.md:42-52`：7 个评分维度各自独立（规范合规 / 代码质量 / 测试覆盖 / 性能 / 安全 / 可维护性 / 文档质量）。
- `reviewer-scoring-guide.md:7-93`：每个维度独立打分、独立扣分（spec_compliance 偏离 -5/-20；code_quality 需改进 -15）。
- 输出格式（reviewer-scoring-guide.md:131-149）：`scores: {spec_compliance:85, code_quality:90, ...}` + `weighted_score:87.5`——**流程合规（spec_compliance）和代码质量（code_quality）本就是两个独立键**。

> 文档主张要"拆分"的东西，**已经是拆开的**。选项 C 的真实增量是什么？是把 weighted_score 的计算公式改成"流程合规不进入加权"？还是给 spec_compliance 加独立门禁？文档没说清。如果是前者——那"流程问题拉低 Developer 评分"的说法与契约矛盾（code_quality 是独立键，spec_compliance 低不会动 code_quality）；如果是后者——现有 advance.js 路由根本没有"流程合规独立门禁"这个概念，要新增，但文档 §四影响面只写"维度拆分 + 增量评分规则"，没说新增门禁逻辑。**方案对自己要改的现状理解错误。**

### A4. 【P1 重大】选项 B 借用未实现的前置条件（HIGH entropy），且 ROI 论证缺失

"HIGH entropy" 在 harness-rules.yaml 中**不存在**（全文无 entropy/HIGH_M/tier 概念）。它是另一份未立项需求 `rdauto-change-entropy-tiering.md` 的提案概念。选项 B（双 Reviewer 盲评仅 HIGH entropy 启用）把这个未实现的概念当作启用判据——**前置依赖未交付**。

**ROI 缺失。** 文档没给 HIGH entropy 变更的占比。取证两个样本：fix-push（complexity_hint M）、refine（complexity_hint M）——都是 MID。若绝大多数变更是 MID/LOW，则"双 Reviewer 解决博弈"对大多数场景不生效。而成本是：每次 HIGH 变更 2 个 Reviewer dispatch + 可能的第 3 人仲裁 = 最多 3 倍 reviewer token。文档"风险与权衡"表只说"成本翻倍，仅 HIGH 启用"做缓解，没算 HIGH 占比、没算 3 倍仲裁的触发概率。在"博弈论本身立论不足"（A1）的前提下，为一个未证实的问题付出最高 3 倍成本，ROI 为负。

### A5. 【P1 重大】选项 A（stateful 增量）的副作用"纵容首轮低分"未被真正缓解

方案 §五风险表承认："增量评分纵容首轮低分（反正靠 delta 拉回）"，缓解措施写"首轮分数仍记录 + rework 次数计入"。

**缓解无效：**
- "首轮分数仍记录"——但 advance.js:173 当前就**覆盖**（只存最终分）。要"记录"得改存储模型（存分数历史数组），文档 §四影响面没提这个改动。
- 即便记录了首轮低分，**它不进入路由决策**（路由只看当次 score）。Reviewer 知道首轮低分不影响最终推进（靠 delta 拉回），则首轮蓄意留改进空间反而**被鼓励**——这恰好是方案要消除的"博弈"，选项 A 把它从"二轮博弈"挪到"首轮博弈"，没消除。
- 更根本：delta 本身怎么客观？"上轮 P0/P1 是否解决"的判定仍是 Reviewer（LLM）主观判断，delta 分仍是主观分。选项 A 把"主观总分"换成"主观 delta 分"，**评分主观问题（D2 承认的根本属性）一个都没解决**，只是换了被博弈的对象。

### A6. 【P1】"评分行为本身是伪精确"未被正面回应

代码质量能否量化到"78 vs 92"的精确区别？`-3 -2 -2` 的加分明细是真度量还是凑数？

文档 line 26 质疑了这点（"-3 -2 -2 像是为了让总分到 92 反推的"），但**三个选项没有一个正面回应**：
- 选项 A：改总分计算方式（增量），没改评分粒度。
- 选项 B：多 Reviewer 求中位数，**放大**了伪精确（两个主观分取中位数，精度不增反给人"客观"错觉）。
- 选项 C：拆维度，但每维仍是 0-100 主观分。

若评分本质主观（D2 部分承认），那 stateful/双 Reviewer/维度去耦都是在**优化一个本不该精确的东西**。真正该问的是：要不要保留 0-100 数字评分，还是改成 pass/rework 二档 + 强制证据？文档把这个最关键的替代（替代 B）放进了 Attacker 维度（D6）但自己没评估。

---

## 3. 替代方案评估

### 替代 A：删除魔法阈值锚点 + pass/rework 二档 + 强制证据 【最优】

**做法**（成本 1/20）：
- 不引入 stateful、不引入双 Reviewer、不做维度去耦（契约已去耦）。
- 把 Reviewer 输出从"0-100 数字 + recommendation"改为档位驱动：**`{verdict: pass | rework, blockers: [P0...], must_fix: [P1...], nit: [P2...]}`**，每个档位必须列具体问题（无具体问题的 verdict 视为无效评审）。
- advance.js 路由改为读 verdict + open P0（已实现）+ P1 数（已实现），**不再消费 0-100 数字**（review-gate.py 同步）。
- 删除"78 会进 Debate / 92 会 direct pass"这种阈值锚定叙事，让 Reviewer 不再有"调分到阈值"的认知目标——**没有数字就没有反推工程的靶子**。

**对比原方案：**

| 维度 | 原方案（A+B+C 组合） | 替代 A（档位+证据） |
|------|------|------|
| 改动范围 | scoring 维度拆分 + 增量评分规则 + Reviewer 契约 + concerns.json + advance 路由 + Debate 仲裁 | advance.js 删 score 四档分支（改读 verdict）+ review-gate.py 同步 + reviewer.md 输出格式改档位 |
| 解决"博弈" | 间接（增加博弈成本） | **直接**（移除博弈靶子——无数字可调） |
| 解决"伪精确" | 未解决（A5/A6） | **直接**（不给 0-100，只给 verdict + 证据） |
| 评分主观问题 | 绕开 | **正面**（主观留在"这是不是 blocker"的判断，强制证据约束） |
| 触红线 | 改 scoring 权威源 | 改 scoring 权威源（同等） |
| 移动部件 | 10+（stateful 存储 + 双 Reviewer 调度 + 维度门禁 + 仲裁） | 3（路由分支 + gate 同步 + 契约格式） |

> 替代 A 直接命中真因（阈值数字是反推工程的靶子），正面解决伪精确（D6/A6 唯一回应的方案），成本 1/20。它不解决"stateless 浪费 token"（Defender D3 的真实点），但那用 **替代 A'**（rework dispatch 注入上轮 concerns summary，advance.js 一处改动）单独解决即可，无需 stateful 评分体系。

### 替代 B：维持现状 + 承认主观 + P0 veto + Debate 兜底

现状已有：P0 一票否决（advance.js:396）、75-79 Debate 兜底（advance.js:417）、rework（<75）。承认 0-100 主观，但靠 P0 veto（硬证据）+ Debate（对抗）兜底。**优点**零改动；**缺点**不解决阈值锚定认知偏误。劣于替代 A。

### 替代 C：只做 rework 增量注入（A'），不动评分体系

advance.js 的 buildReworkResponse 注入上轮 review summary（concerns + 维度分）给 rework dispatch，让二次评审有历史可参照，减少全量复审 token。**优点**直接解决 Defender D3 的真实痛点；**缺点**不解决"博弈"。作为替代 A 的补丁，不独立。

### 替代 D：原方案选项 C（维度去耦）

契约已去耦（A3 证伪），真实增量不明。**不成立。**

**结论：替代 A 明显优于原方案。** 若 PM 偏好最小改动，替代 A + 替代 C（rework 注入历史）组合，成本约 1/10，解决全部真实痛点（锚定 + 伪精确 + stateless token 浪费），不解决也不需要解决"博弈"（A1 证伪其存在）。

---

## 4. 被忽视场景

1. **Debate 自身的评分公式是同样的"伪精确"。** debate-scoring.md 的 `debate_score = 50 + defender*5 - attacker*8 - p0*50`，`final = original*0.4 + debate*0.6`——这比 Reviewer 评分更精细的数字运算。若质疑 Reviewer 0-100 是伪精确，Debate 这套系数（0.4/0.6、*5/*8、clamp[0,100]）凭什么更可靠？方案要重构评分体系却完全不碰 Debate 评分，治标不治本。
2. **跨 Reviewer 一致性问题在 Debate 里已存在但被忽视。** harness-rules.yaml:709-710 已有 "role score diff > 20 记录 divergence，不平均"——说明框架**已知**多角色评分分歧问题。方案选项 B 引入双 Reviewer 取中位数，与现有"不平均、记录分歧"哲学冲突，文档未提。
3. **CI 侧 review-gate.py 与本地 advance.js 的阈值是双份硬编码。** 任何评分体系改动都要双侧同步（CLAUDE.md 已警告"改流程必须同时检查本地 skill 侧和 CI 脚本侧"）。方案 §四影响面完全没提 review-gate.py，落地必然漏改。
4. **concerns.json schema 尚未统一（flat vs grouped）。** refine-exit-status-routing 刚修了 advance 读 grouped schema 的 bug。在 schema 未稳定的当口引入"delta 评审记录""维度分留痕"等新字段，会加重 schema 漂移。文档 §四说"concerns.json 加 delta 评审记录"，未考虑现有 schema 混乱。
5. **"评分被流程预期反向牵引"若是真，双 Reviewer 也会被同一预期牵引。** 两个 Reviewer 都知道"这是 HIGH entropy 要双评、分差>10 仲裁"，博弈目标会变成"两人都往中位数靠"，双评退化成单评的 2 倍成本。方案对"博弈"的诊断若成立，则选项 B 的解法不成立——两个共享同一阈值的评审者不会产生独立校准。这是方案内部的自相矛盾。

---

## 5. 评分

**成熟度评分：44 / 100**

扣分明细：
- "博弈"立论单样本过度解读 + 被反例证伪（A1）：-16（最重，方案立论基础不成立）
- 核心实证（78 分 / C001-C002）未落库、验收 #4 不可验证（A2）：-14
- 选项 C 解决的"耦合"在契约中不存在（A3）：-12
- 选项 B 依赖未实现的 HIGH entropy + ROI 缺失（A4）：-5
- 选项 A 缓解无效 + delta 仍主观（A5）：-4
- 评分伪精确未被任何选项正面回应（A6）：-3
- 影响面漏 review-gate.py 双侧同步（被忽视场景 3）：-2

加分项：
- 识别了 stateless 评审的真实 token 缺陷（Defender D3，唯一站得住的点）：+4
- §五风险表较诚实（自识增量评分纵容首轮低分）：+3
- 提到回溯验证方向（虽数据不存在，方向意识）：+1

> 44 分：与 tdd-rhythm（48）同档位甚至更低。**不是方向全错**（stateless token 缺陷真实、阈值锚定是合理的认知偏误假设），但**立论基础（博弈论）被反例证伪、核心实证（78/C001）从未落库、主打选项（C）解决的问题不存在**，且存在成本 1/20 的替代 A 直接移除博弈靶子。作为立项输入不成熟。

---

## 6. 裁决建议

**裁决：不予立项（按原方案三选项组合）。改用替代 A（档位 + 强制证据，移除 0-100 数字评分靶子），可选叠加替代 C（rework 注入历史 summary 解决 stateless token 缺陷）。**

理由一句话：**"博弈"指控被同期 93 分一次过的反例证伪、78→92 是评审正常工作（真指出了未完成项、解决了就加分）、核心实证未落库不可回溯——不存在需要 stateful/双 Reviewer/维度去耦 10+ 移动部件来解决的系统性问题；阈值锚定这一唯一合理的担忧，用删掉 0-100 数字改 verdict+证据（1/20 成本）即可根除。**

若 PM 仍想保留"评分校准"作为方向：
- 必须先产出**真实的博弈实证**：跨 N≥5 个变更的评分分布 + 双盲对照（同代码两 Reviewer 系统性分差频次），不能拿单一样本 + 被反例否决的弧线。
- 必须重写验收 #4：要么先让 advance.js 落库分数历史（存首轮 + 维度分），要么删掉这条无法验证的验收。
- 必须删掉选项 C（维度去耦），或重新定义其增量（现有契约已去耦，说明对现状理解错误）。
- 必须先等 `change-entropy-tiering` 立项落地，选项 B 才有启用判据。
- 必须把 review-gate.py 纳入影响面（CI 双侧）。
- 即使全部修复，仍建议优先替代 A（更轻、更直接、不依赖博弈论成立），stateful/双 Reviewer 列为 P2 长期探索。

---

## 附：关键取证文件路径

- 审计对象：`docs/requirements/rdauto-review-scoring-calibration.md`
- 78 分未落库（证验收 #4 不可验证）：`.harness/tasks/fix-push-cleanup-hook/pipeline-state.json:230-237`（scores.reviewer 仅 92）
- C001-C004 不存在（证实证为叙述构造）：全仓 grep `C00[1-4]` 仅命中本文档自身；实际样本 `.harness/shared-state/agent-defs-slim/concerns.json`（P0-001~P1-006 实质性技术问题）
- Reviewer 契约已维度去耦（证选项 C 解决的问题不存在）：`.claude/agents/reviewer.md:42-52` + `.claude/agents/extensions/reviewer-scoring-guide.md:7-93,129-150`
- 反例（证博弈论不成立）：`.harness/tasks/refine-exit-status-routing/pipeline-state.json:219-233`（reviewer:93, total_rework_loops:0）
- score 覆盖逻辑（证首轮分数丢失）：`.claude/skills/rd-auto/scripts/lib/advance.js:172-174`
- score 路由硬阈值：`.claude/skills/rd-auto/scripts/lib/advance.js:384-425`
- rework 不注入 prior review context：`.claude/skills/rd-auto/scripts/lib/advance.js:9,399,415,424,777`（rework_context 仅 `score=X,P0=Y` 摘要）
- HIGH entropy 未实现（证选项 B 前置缺失）：`.claude/reference/harness-rules.yaml` 全文无 entropy；概念源自 `docs/requirements/rdauto-change-entropy-tiering.md`（未立项）
- Debate 评分伪精确（被忽视场景 1）：`.claude/agents/extensions/debate-scoring.md:64-77` + `harness-rules.yaml:219-236`
- CI 双侧硬编码（被忽视场景 3）：`.claude/tools/scripts/ci/review-gate.py:99-122`
- 校准锚点（48 分否决先例）：`.harness/shared-state/tdd-rhythm-worktree-debate/debate-report.md`
