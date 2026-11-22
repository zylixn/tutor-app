# 对抗审计报告：tdd-rhythm-worktree（v1.1）

> 审计对象：`docs/requirements/rdauto-tdd-rhythm-worktree.md` v1.1
> 触红线：harness-rules §2 Git 红线 `Workers MUST NOT git commit/add/push under any circumstances`
> 审计日期：2026-06-17
> 审计方式：Defender/Attacker 顺序对抗 + 主会话裁决（基于源码取证，非纸面推演）

---

## 一句话裁决

**方案建立在两个事实错误之上（guard 不拦 commit、commit-msg 无 bypass 机制）、动机与证据错配（两起事故都是 Reviewer/Tester 验证 pre-existing，不是 Developer TDD 节奏），且存在成本 1/10 的替代方案。不立项改红线；改用替代 B（操作规范禁 stash，改用 worktree add 临时验证）。**

---

## 0. 取证基础（对抗的事实底盘）

本审计所有结论均经源码核实，非文档间互引：

| 事实 | 取证 | 对方案的影响 |
|------|------|------------|
| `pre-tool-use-git-guard.sh` **不拦 `git commit`** | 源码 line 36：`_SAFE_GIT_RE='^git (add\|status\|diff\|log\|stash)'`，commit 不在安全列表也不在拦截列表 | 致命：文档 §3.6a 说"guard 加 worktree 检测拦 commit"——**当前 guard 根本不拦 commit，无检测可加** |
| commit-msg hook **无 TDD_BYPASS/WIP_BYPASS 机制** | `grep -nE "bypass\|WIP\|TDD_BYPASS" .claude/hooks/git/commit-msg` 仅命中 `WIP` 作为合法阶段标识，无任何环境变量豁免 | 致命：文档 §3.5a 说"类比现有 TDD_BYPASS 机制"——**该机制在 hook 层不存在**（TDD_BYPASS 是 dispatch 注入文本，非 hook） |
| 两起 stash 事故主角是 **Reviewer/Tester**，非 Developer | fix-push-cleanup-hook 的 problem-analysis.md：Reviewer 验证 TDD red 阶段用 stash；refine-exit-status-routing spec 全文 grep `stash` **0 命中** | 致命：动机"Developer TDD 节奏被破坏"无实证支撑 |
| fanout team mode **已让 Developer 在独立 worktree 工作** | `dispatch-fanout.md` line 3, 33：`{agent.worktree_path}`，Developer sub-agent 已在 worktree | 重大：worktree 隔离是**已有能力**，方案真实增量是"给 Developer 开 commit"，不是"引入 worktree" |
| `core.hooksPath` 是**绝对路径** `/work/repos/aios/rd_harness/.git/hooks` | `git config --get core.hooksPath` | worktree 内 commit 会触发**同一份** hook，但 hook 内 `$REPO_ROOT=$(git rev-parse --show-toplevel)` 变成 worktree 根 |
| worktree 内 `.git` 是 **gitdir file**（指向主仓 `.git/worktrees/<name>/`） | git worktree 设计 | TDD check 读 `$REPO_ROOT/.git/COMMIT_EDITMSG` 会读到 gitdir **file** 而非目录 → 路径错位 |

---

## 1. Defender 立场（尽力辩护）

**D1. TDD 节奏版本化有真实工程价值。** 红绿交替是 TDD 核心，中间"红"状态可回退/可审查/可重放。一次复杂 dispatch 内多轮重构，有 commit 节奏点比靠脑记或 stash 稳。

**D2. 红线措辞与安全初衷有可调和空间。** 红线初衷是防"Worker 偷偷提交绕过评审"。若把红线从"禁所有 git"细化成"禁交付类 git（push/merge）"，本地 commit 作为节奏工具不构成交付，安全模型不破——评审门禁验的是 merge 进主分支的最终 commit，不是中间 commit。这是个合理的边界重划，不是开后门。

**D3. 方案已自识风险并设计了三重审批。** §3.6b 的 PM Override + Debate + ADR 是框架最高门槛，承认这是红线改动。§3.7 列了 5 个攻击面并给了防御。文档没把 HIGH 风险包装成 LOW，诚实度可接受。

**D4. 替代方案都有短板。** 替代 A（主会话代 commit）打破 hub-and-spoke 职责切分、主会话变 git 操作工；替代 D（不开 worktree 直接开 commit）失去隔离，commit 直接进主仓工作区污染更危险。

---

## 2. Attacker 反击（逐一击穿）

### A1. 【P0 致命】方案核心实施依据是两个虚构机制

文档 §3.5a / §3.6a 的落地路径依赖两个**不存在**的东西：

- **"commit-msg hook 加 WIP_BYPASS 检测，类比现有 TDD_BYPASS 机制"** —— 实测 commit-msg hook 全文无任何 bypass 逻辑。`TDD_BYPASS` 是 harness-rules `workflow.tdd_check` 里**主会话 dispatch 时注入给 Developer 的文本提示**（"PM 拒绝后注入 TDD_BYPASS"），从来不是 hook 读的环境变量。文档把"dispatch 注入文本"误当成"hook 豁免机制"，照此实现会在 hook 里写一段永远不生效的 `if [ -n "$WIP_BYPASS" ]`。
- **"pre-tool-use-git-guard.sh 加 worktree 检测——worktree 内允许 commit，主仓工作区仍拦"** —— 实测 guard **根本不拦 commit**。`_SAFE_GIT_RE` 放行 add/status/diff/log/stash，其余 git 命令只拦 pull-main / merge / push / 保护路径。commit 既不在安全名单也不在拦截名单，意味着 **Worker 当前就能在 guard 层执行 git commit**（禁 commit 纯靠 `developer.md:43` 文字契约 + commit-msg 格式校验）。

> Defender 回应 D2 的"边界重划"在抽象层成立，但**具体落地路径是错的**。要给 Developer 开 commit，真正要改的不是"guard 加 worktree 检测"，而是**承认 guard 之前就没拦 commit、Worker 禁 commit 靠的是 agent 契约 + commit-msg 格式**。方案对现状的理解错误，导致实施清单（§四影响面、§3.6a 落地）整列失真。

**这是 P0**：一份要改框架红线的需求文档，对自己要改的拦截机制现状判断错误，照此立项会在 explore/implement 阶段才发现"原来 guard 不拦 commit"，方案设计要返工。

### A2. 【P0 致命】动机与证据错配——这是"大炮打蚊子"的教科书案例

文档 §一的"实证"：

- **fix-push-cleanup-hook**：problem-analysis.md 写得很清楚——是 **Reviewer** 为验证 TDD red 阶段执行 `git stash` → `git stash drop` 误操作。**Reviewer 本就禁 git**，这是 Reviewer 越权用了 stash，不是"Developer TDD 节奏被压扁"。
- **refine-exit-status-routing**：文档声称"Tester 用 stash 验证 pre-existing"。实测该 change 的 spec/proposal/design **全文 grep `stash` 零命中**。这个"第二实证"要么是杜撰、要么是记忆错误。即便存在，也是 **Tester 验证 pre-existing 失败**的边缘操作，与 Developer 红绿节奏无关。

> **两起事故都是"Worker 验证 pre-existing 时越权用 stash"，没有一起是"Developer 因禁 git 无法保存红绿节奏"。** 方案要解决的"问题"在实证里不存在。Developer 一次 dispatch 内红→绿→重构→绿，中间状态用工作区即可，dispatch 结束主会话单 commit，节奏"压扁成一点"对绝大多数 dispatch 无实际损失。

Defender 的 D1 是抽象论证 TDD 价值，但**抽象价值不等于本仓库有此痛点**。审计要求实证，实证指向的是另一个问题（Reviewer/Tester 越权 stash），该用 1/10 成本的替代 B 解决，不是改红线。

### A3. 【P0 安全回归】WIP_BYPASS 把"格式规范"变成"可绕过的规范"，且 squash 兜底是人工承诺

§3.5a：worktree 内节奏 commit 用 `[WIP]` 前缀豁免格式校验，merge 时主会话 squash 成规范 commit。

攻击链：
1. `[WIP]` 前缀让 Developer 在 worktree 内可以写**任意** commit message（只校验非空）。
2. §3.7 的"commit 序列夹带恶意改动"防御是"主会话 merge 前 review 完整 commit 序列 + Reviewer 也看 + squash 发现非常规 commit 单独标审"——**全是人工 review 承诺，无机器门禁**。
3. Reviewer 看的是 commit 序列，但 squash 后进主分支的是单一 commit，**序列 review 的严谨度高度依赖主会话/Reviewer 当次是否疲惫**。这与框架现有"commit-msg hook 机器强制格式 + pre-commit TDD 机器强制"的机器门禁哲学冲突。
4. 更糟：`[WIP]` 已经是 commit-msg hook 的**合法阶段标识**（line 30 正则含 `WIP`）。也就是说，所谓"豁免"根本不需要新机制——Developer 用 `[630] WIP xxx[AI-...]` 格式现在就能过 commit-msg。方案在解一个已经（错误地）被允许的问题。

> 这暴露方案对 commit-msg hook 的双重误解：既误以为有 bypass 机制（A1），又没意识到 WIP 已是合法标识。WIP 作为合法 commit 类型意味着**红线的"节奏类 commit"口子其实已经在格式层开了**，只是 agent 契约（developer.md:43）挡着。方案真正要做的只是"改 agent 契约允许 commit"——这又绕回 A1。

### A4. 【P0 技术漏洞】worktree 内 hook 路径错位未被识别

`core.hooksPath` 是绝对路径，worktree 内 commit 触发**同一份** pre-commit/commit-msg hook。但这些 hook 内：

- **pre-commit**（`.claude/hooks/git/pre-commit`）：`REPO_ROOT=$(git rev-parse --show-toplevel)`。worktree 内 `--show-toplevel` 返回 **worktree 根**。框架保护读 `$REPO_ROOT/.framework-manifest`——worktree 若是主仓 worktree，会读到同一份 manifest（OK）；但 `.framework-edit` bypass 检测 `$REPO_ROOT/.claude/.framework-edit`——**worktree 内没有这个文件**，意味着 worktree 内改框架文件会**100% 被 pre-commit 拦死**，连正常框架演进都做不了。文档 §3.7 说"worktree commit 不绕过 .framework-edit 创建限制"——措辞含糊，实际行为是"worktree 内框架文件改动一律不可 commit"，这与"框架保护"意图一致但文档没说清。
- **TDD check**：读 `$REPO_ROOT/.git/COMMIT_EDITMSG` 检测 GATE_BYPASS。worktree 内 `.git` 是 **gitdir file**（内容是 `gitdir: /主仓/.git/worktrees/<name>`）。`cat $REPO_ROOT/.git/COMMIT_EDITMSG` 会把 gitdir file 当路径前缀 → 解析失败 → GATE_BYPASS 永远检测不到 → **worktree 内 TDD 检查的 bypass 通道静默失效**。反之正常 TDD 拦截（生产代码无测试）的 staged 文件检测用 `git diff --cached`（worktree 正常），所以 TDD 拦截在 worktree 仍生效，但 bypass 通道坏了——这是个隐蔽的不对称。
- §3.5b 说"复用 fix-push-cleanup-hook 的双层兜底（CLAUDE_PROJECT_DIR > git toplevel）"——但 fix-push-cleanup-hook 修的是 **PreToolUse hook 的 cwd**（`.claude/.push-*` 相对路径），而这里的问题是 **git hook 内 `$REPO_ROOT` 指向 worktree + `.git` 是 file**，**两类完全不同的 cwd 问题**，"复用兜底"是错误类比。

> Defender D3 说"方案已自识风险"——但识别到的是表层（hook 会触发），**没识别到 REPO_ROOT 错位 + .git gitdir file 导致 TDD bypass 通道失效**这个深层漏洞。文档 §3.5d 只说"explore 必须实测 hooksPath 继承"，把致命的具体问题甩给 explore 阶段。

### A5. 【P1】"Worker 禁交付类 git"定义模糊，红线重写会引入新的解释空间

§3.6a 把红线改成"禁交付类 git（push / merge to main / 分支删除 / force-push）"。问题：

- **merge 到非 main 分支算交付吗？** dev 分支 merge 到 feature 分支？文档没说。
- **tag 算交付吗？** `git tag` + `git push --tags` 能绕过 push 审批（push 审批的 PURE_PUSH_RE 只匹配 `git push`，`git push --tags` 会触发但 tag 创建本身不拦）。
- **`git reset --hard` / `git checkout .` 算交付吗？** 这些是破坏性操作但不"交付"。
- **cherry-pick 算交付吗？** 把某 commit 复制到当前分支，半交付。

> 原红线"禁所有 git"虽然一刀切，但**零解释空间、零误用风险**。细化成"交付类"会引入持续的边界争议，每个新 git 子命令都要裁决"算不算交付"。这违反框架红线应有的"绝对清晰"特性。Defender D2 的"边界重划"在哲学上优雅，在工程上是给所有安装此框架的项目埋解释地雷。

### A6. 【P1】pipeline-state / shared-state 在 worktree 的同步是未解决盲点，且与 refine-exit-status-routing 路由冲突

- §3.8a 说"pipeline-state.json 留主仓，worktree 只做代码工作区"。但 `concerns.json`（`.harness/shared-state/<change>/`）由 Reviewer 写、advance 读。若 Reviewer 共享 worktree（§3.8b 倾向），Reviewer 在 worktree 内写 concerns.json，路径是 worktree 的 `.harness/shared-state/` 还是主仓的？文档没答。
- refine-exit-status-routing（ADR-008）刚改了 advance 路由：`DONE_WITH_CONCERNS` 按 open-P0 路由，读 `concerns.json` 的 `{p0:[{status:open}]}`。若 concerns.json 在 worktree，advance 在主仓读不到 → **P0 veto 静默失效**。这是与新路由的直接冲突，文档 §六关联里只提了"已修根因 #5"没提这个集成风险。

### A7. 【P1】多角色共享 worktree 的并发写未解决

§3.8b 倾向"同一 change 单 worktree，多角色共享（Developer 建，Reviewer/Tester 同 worktree）"，但又说"倾向串行 dispatch"。若串行则无需共享（各自 dispatch 时 worktree 状态已固化）；若真共享，Developer 未 squash 的中间 WIP commit 会被 Reviewer 看到，可能干扰评审（Reviewer 误把 WIP commit 当最终态评）。倾向自相矛盾。

---

## 3. 替代方案评估（最关键维度）

### 替代 B：操作规范——禁 stash，改用 `git worktree add` 临时验证 pre-existing 【最优】

**做法**：
- 不动红线，不改 hook，不引入 commit 权限。
- 把"验证 pre-existing 失败"的标准操作从 `git stash` 改成 `git worktree add /tmp/verify -b verify/<change>` → 在临时 worktree 跑测试 → `git worktree remove /tmp/verify`。
- 写进 Reviewer/Tester 的 agent 契约 + 一条 memory（`feedback_no_stash_use_worktree.md`）。
- stash drop 事故根因（用 stash 暂存修改版）彻底消除——worktree 隔离下，主工作区的修改版根本没动，无需"暂存"。

**对比原方案**：

| 维度 | 原方案（改红线+worktree commit） | 替代 B（操作规范禁 stash） |
|------|------|------|
| 改动范围 | 红线 + guard + commit-msg + pre-commit cwd + secret-scan + 规则注入 + ADR + dispatch 模板 | 1 条 agent 契约 + 1 条 memory |
| 触红线 | 是（框架级硬规则） | 否 |
| 解决两起实证事故 | 间接（声称 commit 序列让 stash 无必要） | **直接**（stash 操作本身被禁） |
| 安全回归风险 | WIP_BYPASS 滥用 + 路径白名单绕过 + TDD bypass 失效 | 无（不动任何门禁） |
| 移动部件 | 10+ | 1 |

> **替代 B 直接命中两起事故的真因（Worker 越权用 stash），成本 1/10，零红线改动，零安全回归。** Defender D4 说"替代有短板"——但 D4 批的是替代 A/D，没碰 B。B 的唯一"短板"是"没实现 TDD 节奏版本化"——但 A2 已证本仓库无此实证需求，抽象价值不构成立项理由。

### 替代 A：主会话代 commit
打破 hub-and-spoke，主会话变 git 操作工，节奏点要 Developer 口述给主会话翻译成 commit——沟通成本高，且主会话已有 commit 权限（带 PM 确认），技术可行但体验差。**劣于 B**。

### 替代 C：git notes / stash 规范化
git notes 不适合存红绿状态；stash 规范化（双确认 pop）治标不治本，stash 本质仍是脆弱暂存。**劣于 B**。

### 替代 D：只对 Developer 开 commit 不开 worktree
失去隔离，commit 直接进主仓工作区，污染更直接，且仍要改红线。**劣于 B**。

**结论：替代 B 明显优于原方案。**

---

## 4. 被忽视场景（需补进文档，即便走替代 B 也值得记录）

1. **session 崩溃后 worktree 孤儿**：§3.7 说"SessionStart 检查孤儿 worktree 并提示清理"，但没说提示给谁、谁有权限 remove（Worker 禁 git，`git worktree remove` 是 git 操作，谁执行？）。
2. **Developer 在 worktree 改 `.claude/` 框架文件**：A4 已析，pre-commit 会拦死，但文档没说这其实是"特性"（worktree 内框架改动不可 commit），应显式声明。
3. **多 change 并行多个 worktree 的合并顺序**：fanout 已有 `integrateWorktreeArtifacts`（last-writer-wins），但那是 artifact 拷贝非 git merge；commit 节奏场景下多 worktree 的 commit 序列如何排序合并，文档未答。
4. **`.claude/.push-challenge` 当前已残留**（审计时实测存在）——说明 push 清理 bug 的修复可能仍有残留场景，这跟本方案无关但提示 cwd 治理脆弱，worktree 会放大此脆弱性。

---

## 5. 评分

**成熟度评分：48 / 100**

扣分明细：
- 动机与证据错配（A2）：-18（最重，方案立论的实证不存在）
- 核心实施依据虚构（A1：guard 不拦 commit + commit-msg 无 bypass）：-15
- WIP_BYPASS 安全回归（A3）：-8
- worktree hook 路径错位未识别（A4）：-6
- 红线重写引入解释空间（A5）：-3
- pipeline-state/concerns 与新路由冲突（A6）：-2

加分项：
- 自识 HIGH 风险 + 设计三重审批（诚实度）：+5
- §3.7 攻击面列举较全（虽防御多靠人工）：+3
- 提到 explore 必须实测（方向对）：+2

> 48 分：作为"立项输入"不成熟。不是"方向全错"，而是**立论基础（实证）不存在 + 落地依据（hook 机制现状）错误**，且存在成本 1/10 的替代方案直接解决真因。

---

## 6. 裁决建议

**裁决：放弃改红线，改用替代 B（操作规范禁 stash，验证 pre-existing 改用临时 worktree）。**

理由一句话：**两起事故的真因是 Worker 越权用 stash 验证 pre-existing，不是 Developer 缺 commit 权限——用 1 条 agent 契约 + 1 条 memory 解决，无需触动框架红线这一最高安全边界。**

若 PM 仍想保留"TDD 节奏版本化"作为独立长期方向：
- 必须先产出**真实的 Developer 节奏实证**（不能拿 Reviewer/Tester 的 stash 事故冒充）。
- 必须重写 §3.5/§3.6 落地路径，基于正确的 hook 现状（guard 不拦 commit、commit-msg 无 bypass、WIP 已是合法标识）。
- 必须先解 A4（worktree 内 REPO_ROOT 错位 + .git gitdir file 导致 TDD bypass 通道失效）。
- 即使全部修复，仍建议排在替代 B 之后，作为 P2 长期探索，不与红线改动绑定。

---

## 附：关键取证文件路径

- 审计对象：`docs/requirements/rdauto-tdd-rhythm-worktree.md`
- guard 源码（证不拦 commit）：`.claude/hooks/claude/pre-tool-use-git-guard.sh:36`
- commit-msg 源码（证无 bypass，WIP 是合法标识）：`.claude/hooks/git/commit-msg:30`
- pre-commit 源码（证 REPO_ROOT 错位 + .framework-edit 检测）：`.claude/hooks/git/pre-commit:40,63`
- TDD check（证读 .git/COMMIT_EDITMSG）：`.claude/tools/scripts/misc/pre-commit-tdd-check.sh:17` + `.claude/hooks/git/pre-commit:85`
- 事故实证（证主角是 Reviewer 非 Developer）：`.harness/spec/specs/fix-push-cleanup-hook/problem-analysis.md`
- 第二实证不存在（refine-exit-status-routing 全文无 stash）：`.harness/spec/specs/refine-exit-status-routing/`
- worktree 已在用（fanout team mode）：`.claude/skills/rd-auto/templates/dispatch-fanout.md:3,33`
- 红线原文：`.claude/reference/harness-rules.yaml:455`
- 路由新设计（ADR-008 集成风险）：`.harness/spec/specs/refine-exit-status-routing/design.md`
