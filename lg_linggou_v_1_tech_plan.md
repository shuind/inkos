# LG 灵构 v1 技术方案 v0.5 收敛稿

版本：v0.5 收敛稿  
日期：2026-05-22  
目标形态：CLI-first、本地文件协议、vibewriting pipeline、人工确认落盘  
当前策略：先跑通 MVP 闭环；不做 GUI、多 Agent、向量数据库、自动抓取官网对话。

---

## 0. 一句话定义

**LG 灵构 v1 是一个面向小说创作的本地叙事工程 CLI：它把作者与模型的对话、官网创作结果、碎片草稿、设定材料、旧稿片段都视为 Source，通过 vibewriting 将其抽取、对齐、冲突检查，并转化为可审查、可回滚、可确认落盘的叙事变更。**

它不是普通聊天机器人，不是自动代写器，也不是“官网对话导入工具”。

它的核心闭环是：

```text
Source
→ SourceRef / SourceArtifact
→ VibePacket
→ ConflictReport
→ ActionSet
→ Human Accept / Reject / Defer
→ Atomic Apply
→ Decision Ledger
→ Updated Story State
```

一句更产品化的表达是：

> LG 灵构 v1 不是“会写小说的 Codex 皮肤”，而是把小说创作真正需要的 canon、state、hook、chapter、decision 体系，做成一个像 coding agent 一样可靠、像写作台账一样可信的 CLI agent。

---

## 1. 总体决策

### 1.1 不直接 fork Codex CLI / Claude Code

LG v1 不把 Codex CLI 或 Claude Code 当作整套底座直接改造成写作工具，而是做一个面向小说工作流的轻量自研 CLI 内核。

原因：

1. 小说创作的核心对象不是代码文件，而是 canon、角色认知、读者认知、伏笔、章节功能、叙事节奏和作者偏好。
2. LG 的核心闭环不是“自动修改项目”，而是“把灵感治理成可确认的叙事变更”。
3. Codex / Claude Code 最值得借鉴的是 CLI-first、slash commands、上下文可见、写前审批、记忆分层，而不是直接复用其代码编辑内核。
4. Claude Code 源码许可边界不适合作为默认可二开的开源底座；更适合参考公开文档与交互设计。
5. Codex CLI 可以更深层借鉴其开源实现经验，但 LG 不应继承 coding agent 的文件编辑假设。

### 1.2 v1 单模型供应商：DeepSeek-compatible

v1 运行时先接一个 OpenAI-compatible provider，默认 DeepSeek。

原则：

1. 不做多模型运行时。
2. 外部 Source 不限模型来源，官网对话可以来自 ChatGPT、Claude、DeepSeek 或其他模型。
3. 运行时只需要稳定完成三类调用：
   - 主对话分析；
   - source / session 压缩；
   - VibePacket / ActionSet 结构化输出。
4. `ModelGateway` 保留接口边界，但不在 v1 做多供应商策略。

建议默认配置：

```json
{
  "provider": "deepseek",
  "models": {
    "dialog": "deepseek-v4-pro",
    "compact": "deepseek-v4-flash",
    "light": "deepseek-v4-flash"
  },
  "reasoning_effort": {
    "dialog": "max",
    "compact": "high"
  }
}
```

### 1.3 CLI-first，但先 REPL，不做全屏 TUI

v1 的主入口是 `lg chat`，形态是流式 REPL + 清晰的状态输出，而不是全屏 TUI。

原因：

1. 第一阶段要验证的是上下文、vibewriting、动作组、落盘可信度。
2. 全屏 TUI 会带来 alternate screen、键盘映射、跨平台兼容、状态面板布局等复杂度。
3. REPL 更容易调试、录制、测试和回放。
4. 后续可以在 CLI 内核稳定后再做 TUI / GUI / 编辑器插件。

---

## 2. v1 MVP Cut

v1 第一阶段只验证一条最小闭环：

```text
lg init
→ lg ingest / lg chat
→ lg vibe
→ lg actions diff
→ lg accept / reject / defer
→ atomic apply
→ decisions.jsonl append
→ later context remembers decision
```

### 2.1 v1 必做

| 能力 | v1 是否做 | 说明 |
|---|---:|---|
| 本地小说工程仓 | 是 | 用 Markdown / JSON / JSONL 组织正文、设定、伏笔、记忆、动作 |
| CLI 项目初始化 | 是 | `lg init` 生成目录和模板文件 |
| CLI 对话 | 是 | `lg chat` 支持普通讨论和少量 slash 命令 |
| Source 接收 | 是 | 支持本地 chat、剪贴板、Markdown 文件、官网对话粘贴 |
| SourceRef / SourceArtifact | 是 | 对来源做轻量引用或固化追踪 |
| Vibewriting 整编 | 是 | 抽取候选事实、草稿、偏好、拒绝方向、开放问题 |
| 上下文对齐 | 是 | 对照 current_state、hooks、chapter_map、decisions 检查冲突 |
| ActionSet 生成 | 是 | 把可吸收内容转成 pending action |
| 人工确认落盘 | 是 | 只有 accept 后才修改 story / manuscript / memory |
| reject / defer 记忆 | 是 | 拒绝和搁置也要进入决策账本 |
| undo | 是 | 基于 snapshot 生成恢复动作或执行恢复 |

### 2.2 v1 暂不做

| 能力 | 不做原因 |
|---|---|
| 浏览器自动抓官网对话 | 涉及账号、Cookie、反爬和隐私风险 |
| 自动整章代写并覆盖正文 | 违反作者主权，且破坏风格控制 |
| 自动把模型建议写成正典 | 所有外部输入都必须先是 proposal |
| 大规模全书重写 | v1 只做小批量、可审查、可回滚变更 |
| 图形 UI | 先证明 CLI 内核和文件协议 |
| 向量数据库 | v1 用结构检索、关键词、摘要索引；向量留给 v1.1 |
| 多模型运行时 | v1 运行时先接一个 OpenAI-compatible provider |
| 多 Agent | v1 单 Agent 足够；诊断能力用模块拆分，不用角色拆分 |
| 云同步 | 隐私和协作复杂；文件协议天然可 Git 同步 |
| 自动 Git commit | 默认不自动 commit；允许显式 `--commit` 作为可选项 |

### 2.3 第一条真实实现闭环

建议第一轮开发只做：

```text
lg init
lg ingest ./source.md --source official_chat --chapter 0004
lg vibe latest --chapter 0004 --draft-action
lg actions diff <id>
lg accept <id>
lg chat --chapter 0004 能读到 accepted / rejected decision
```

暂缓：完整 REPL 体验、剪贴板导入、undo、compact 自动触发、正文大段改写。

---

## 3. 核心设计原则

### 3.1 作者主权

Agent 永远不直接改正文。所有写入都必须经过：

```text
propose
→ preview diff
→ accept / reject / defer
→ atomic apply
```

小说不像代码，不能靠编译器或测试判断“伏笔是否提前炸了”“角色认知是否跳变了”“作者风格是否被毁了”。所以所有修改都必须可审阅、可回滚、可追踪。

### 3.2 Source 不是正典

所有输入材料默认都是候选：

| 来源 | 默认状态 |
|---|---|
| 本地 `lg chat` 对话 | proposal |
| 官网模型对话 | proposal |
| 作者粘贴的草稿 | proposal |
| 旧稿片段 | proposal |
| Markdown 设定片段 | proposal |
| 已 accept 的 ActionSet | canon change |
| `memory/decisions.jsonl` 中 accepted decision | canon decision |
| `story/current_state.md` | canon snapshot |

关键规则：

```text
只有 accepted decision 和 accepted ActionSet 才能改变正典。
```

### 3.3 万物皆 Source，但不是万物皆 SourceArtifact

Source 是概念层，不一定对应一个文件。

本地 chat 的一段讨论、官网对话、剪贴板草稿、旧稿片段、设定材料，都可以作为 Source。

但 v1 不把每个 Source 都重对象化。默认策略：

1. 普通会话先保存在 `sessions/*.jsonl`。
2. 需要引用时生成 `SourceRef`。
3. 需要长期追踪、复用、合并、渐进披露时，才提升为 `SourceArtifact`。

这样既保留“万物皆 Source”的统一模型，又避免 MVP 过重。

### 3.4 VibePacket 是整理合并层

`VibePacket` 不是正典，也不是待落盘动作。

它负责：

1. 抽取候选事实；
2. 提取正文草稿；
3. 识别作者风格偏好；
4. 识别明确拒绝或敏感方向；
5. 提出开放问题；
6. 对齐当前正典；
7. 生成冲突报告；
8. 建议下一步是 discuss、draft_action 还是 save_only。

### 3.5 ActionSet 是唯一可落盘提案

只有 `ActionSet` 可以进入 `actions/pending.json`。

只有 pending ActionSet 被作者 `accept` 后，才允许修改：

- `story/*`
- `manuscript/*`
- `memory/*`
- `actions/archive/*`

### 3.6 Decision Ledger 是长期正典账本

接受、拒绝、搁置、撤销都必须记录。

特别是 rejected direction：被拒绝的方向必须被长期记住，避免模型反复提出同一个坏建议。

### 3.7 稳定规则与自动记忆分离

项目级稳定协作规则放在：

```text
LG.md
```

自动压缩摘要放在：

```text
memory/compact.md
```

二者职责不同：

| 文件 | 职责 |
|---|---|
| `LG.md` | 作者与 Agent 的长期协作规则、风格禁区、写作边界 |
| `memory/compact.md` | 会话压缩后的阶段性记忆、偏好、拒绝方向、待定问题 |

`compact.md` 不能覆盖 `LG.md` 的规则地位。

### 3.8 长程一致性优先

LG v1 必须显式维护：

- Story Bible
- Current State
- Hooks
- Chapter Map
- Decision Ledger
- Compact Memory
- Rejections

每次 vibewriting 都必须读取相关正典材料，而不是只看当前 Source。

### 3.9 文件即数据库

全部核心状态使用纯文本：

```text
Markdown：给作者读写
JSON：给程序校验和整体更新
JSONL：给账本追加、grep、diff、流式读
```

v1 不引入数据库。`.lg/cache` 和 `.lg/index` 可重建，不是正典。

---

## 4. 核心对象模型

### 4.1 Source

Source 是概念层，不一定有持久化对象。

```ts
type Source =
  | ChatSource
  | OfficialChatSource
  | DraftSource
  | ClipboardSource
  | MarkdownFileSource
  | ManualNoteSource
```

规则：

1. 任何输入都可以是 Source。
2. Source 默认是 proposal。
3. Source 可以只存在于 session 中。
4. 只有当 Source 需要追踪、复用、合并、渐进披露时，才提升为 SourceArtifact。

### 4.2 SourceRef

SourceRef 是 MVP 的轻量引用。

```ts
type SourceRef =
  | {
      kind: 'import_file'
      path: string
      sha256: string
      trust_level: 'proposal'
    }
  | {
      kind: 'session_slice'
      session_id: string
      from_event: string
      to_event: string
      trust_level: 'proposal'
    }
  | {
      kind: 'draft_file'
      path: string
      sha256: string
      trust_level: 'proposal'
    }
```

使用场景：

1. 快速引用一段 session。
2. 引用一个导入文件。
3. 引用一个草稿文件。
4. 不需要维护完整 source 状态机。

### 4.3 SourceArtifact

SourceArtifact 是来源固化层。

```ts
type SourceArtifact = {
  schema: 'lg.source_artifact.v1'
  id: string
  source_type:
    | 'local_chat'
    | 'official_chat'
    | 'draft'
    | 'clipboard'
    | 'markdown_file'
    | 'manual_note'
  source_name?: string
  created_at: string
  ingest_method: 'chat' | 'clipboard' | 'file' | 'manual'
  mode:
    | 'brainstorm'
    | 'prose_draft'
    | 'outline'
    | 'setting'
    | 'revision_note'
    | 'mixed'
  related_chapters?: string[]
  related_hooks?: string[]
  status: 'raw' | 'summarized' | 'vibed' | 'archived'
  trust_level: 'proposal'
  content_path: string
  summary_path?: string
  sha256: string
}
```

规则：

1. SourceArtifact 永远不是正典。
2. SourceArtifact 原文内容 append-only。
3. SourceArtifact metadata 可以更新，但状态变化应记录到 `imports/source_events.jsonl`。
4. 所有后续 VibePacket 和 ActionSet 必须保留 source reference。
5. SourceArtifact 的价值是追踪、合并、摘要、渐进披露，不是做最终判断。

### 4.4 VibePacket

VibePacket 是 vibewriting 的核心中间产物。

```ts
type VibePacket = {
  schema: 'lg.vibe_packet.v1'
  id: string
  source_refs: SourceRef[]
  source_artifact_ids?: string[]
  created_at: string
  scope: {
    chapters?: string[]
    hooks?: string[]
    characters?: string[]
    files_maybe_affected: string[]
  }
  extracted: {
    candidate_facts: CandidateFact[]
    draft_prose: DraftProse[]
    style_preferences: string[]
    rejected_or_sensitive: string[]
    open_questions: string[]
    author_intents: string[]
  }
  conflicts: ConflictItem[]
  recommendations: Recommendation[]
  recommended_next: 'discuss' | 'draft_action' | 'save_only'
}
```

```ts
type CandidateFact = {
  text: string
  confidence: 'low' | 'medium' | 'high'
  canon_status: 'candidate'
  evidence: EvidenceRef[]
}
```

```ts
type ConflictItem = {
  severity: 'low' | 'medium' | 'high'
  with:
    | 'story/current_state.md'
    | 'story/hooks.md'
    | 'story/outline/chapter_map.md'
    | 'memory/decisions.jsonl'
    | string
  reason: string
  suggested_resolution?: string
}
```

规则：

1. VibePacket 是 proposal，不是 canon。
2. 候选事实不能直接写入 current_state。
3. 正文草稿不能自动替换 manuscript。
4. `rejected_or_sensitive` 必须进入后续 ActionSet 风险说明。
5. `conflicts` 必须在 draft ActionSet 前展示。

### 4.5 ActionSet

ActionSet 是唯一可以进入 pending 的可落盘对象。

UI 层可以把它称为“动作组”。协议层统一称为 ActionSet。

```ts
type ActionSet = {
  schema: 'lg.action_set.v1'
  id: string
  title: string
  summary: string
  rationale: string
  risk_level: 'low' | 'medium' | 'high'
  created_at: string
  created_by_session?: string
  origin: {
    kind: 'chat' | 'vibe' | 'manual'
    source_refs?: SourceRef[]
    source_artifact_ids?: string[]
    vibe_packet_id?: string
  }
  related: {
    chapters?: string[]
    characters?: string[]
    hooks?: string[]
    files: string[]
  }
  ops: ActionOp[]
  preconditions: FilePrecondition[]
  review_notes?: string[]
}
```

v1 支持的 ActionOp：

```ts
type ActionOp =
  | ReplaceSectionOp
  | ReplaceExcerptOp
  | AppendUnderSectionOp
  | AppendDecisionOp
  | UpdateFrontMatterOp
  | CreateFileOp
```

v1 禁止：

```text
delete_file
rename_file
shell_exec
network_write
global_replace
unconfirmed_bulk_rewrite
```

建议最小 op schema：

```ts
type ReplaceSectionOp = {
  op: 'replace_section'
  path: ProjectPath
  selector: string
  old_contains: string[]
  new_text: string
}

type ReplaceExcerptOp = {
  op: 'replace_excerpt'
  path: ProjectPath
  old_excerpt: string
  new_excerpt: string
}

type AppendUnderSectionOp = {
  op: 'append_under_section'
  path: ProjectPath
  selector: string
  text: string
}

type AppendDecisionOp = {
  op: 'append_decision'
  path: 'memory/decisions.jsonl'
  decision: Omit<DecisionEvent, 'id' | 'ts'>
}

type CreateFileOp = {
  op: 'create_file'
  path: ProjectPath
  content: string
  if_exists: 'fail'
}
```

### 4.6 DecisionEvent

```ts
type DecisionEvent = {
  schema: 'lg.decision.v1'
  id: string
  ts: string
  session_id?: string
  source_refs?: SourceRef[]
  source_artifact_ids?: string[]
  vibe_packet_id?: string
  action_id?: string
  status: 'accepted' | 'rejected' | 'deferred' | 'superseded' | 'reverted'
  summary: string
  rationale?: string
  related_files: string[]
  tags: string[]
}
```

`decisions.jsonl` 是 append-only。修正旧决策只能追加新事件，不能就地修改。

### 4.7 Decision Ledger 与 Apply Audit 的边界

必须区分两种记录：

```text
Decision Ledger:
  记录叙事层面的作者决策。
  位置：memory/decisions.jsonl

Apply Audit:
  记录系统层面的执行审计。
  位置：actions/archive/*.jsonl 或 .lg/traces/*.jsonl
```

`append_decision` 表示叙事决策，例如：

```text
第4章只暴露谢闻衣外貌异常，不暴露长生秘密。
```

ApplyEngine 自动记录系统执行，例如：

```text
act_20260522_000001 于 2026-05-22T20:16:00-07:00 成功 apply，修改了 4 个文件。
```

两者不能混写，避免重复或污染。

---

## 5. 项目目录协议

```text
my-book/
  LG.md
  lg.json
  README.md
  .gitignore

  manuscript/
    chapters/
      0001.md
      0002.md
      0003.md
    fragments/
      inbox.md

  story/
    bible.md
    current_state.md
    hooks.md
    style.md
    characters.md
    timeline.md
    outline/
      volume_01.md
      chapter_map.md

  memory/
    compact.md
    decisions.jsonl
    facts.jsonl
    preferences.jsonl

  imports/
    official_chat/
      2026-05-22_001.md
    drafts/
      scene_0004_vibe.md
    vibewrite/
      vw_20260522_000001.json
    source_events.jsonl

  sessions/
    2026-05-22T14-03-22-0700.chat.jsonl

  actions/
    pending.json
    archive/
      accepted.jsonl
      rejected.jsonl
      deferred.jsonl
      apply_audit.jsonl

  .lg/
    runtime.json
    cache/
      file_index.json
      summaries.json
    snapshots/
      act_20260522_000001/
    traces/
      2026-05-22-chat.trace.jsonl
    locks/
```

### 5.1 正典层级

```text
最高优先级：
  memory/decisions.jsonl 中 accepted decision

项目协作规则：
  LG.md

正典快照：
  story/current_state.md
  story/bible.md
  story/hooks.md
  story/outline/*

创作正文：
  manuscript/chapters/*.md

候选材料：
  imports/*
  sessions/*
  manuscript/fragments/*
```

### 5.2 目录含义

| 目录 | 含义 |
|---|---|
| `LG.md` | 作者与 Agent 的长期协作约定 |
| `manuscript/` | 正文与正文碎片 |
| `story/` | 小说正典：设定、当前状态、伏笔、时间线、大纲 |
| `memory/` | Agent 长期记忆：压缩摘要、决策账本、偏好 |
| `imports/` | 外部创作材料和 vibewriting 中间产物 |
| `sessions/` | 本地对话历史 |
| `actions/` | 待确认动作和动作历史 |
| `.lg/` | 可重建缓存、快照、trace、锁、运行态 |

### 5.3 `.gitignore`

```gitignore
.lg/cache/
.lg/locks/
.lg/traces/*.tmp
node_modules/
.DS_Store
```

`.lg/snapshots/` 是否忽略由作者决定：

- 个人创作：建议忽略；
- 团队协作：可以保留关键快照，或依赖 Git commit。

---

## 6. 文件格式规范

### 6.1 `LG.md`

`LG.md` 是项目级写作协作规则，不是故事设定。

建议保持短、具体、可执行。

```markdown
# LG Project Rules

## 写作协作原则
- 未经 accept，任何聊天中出现的设定、剧情、判断都不是 canon。
- 讨论阶段只给建议，不直接改 story / manuscript。
- 修改正文前必须先说明风险，并生成 ActionSet。

## 作者偏好
- 喜欢通过物证、误判、留白推进悬念。
- 不喜欢角色直接解释秘密。
- 偏慢热、压抑、克制。

## 风格禁区
- 不要用现代网感吐槽破坏古风语境。
- 不要用大段解释替代场景动作。
- 不要为了爽点提前揭示主线真相。

## 默认工作方式
- 优先修改 chapter_map / hooks / current_state，再动正文。
- 正文试写默认作为草稿，不直接落盘。
- 触碰 manuscript 时需要更高风险提示。
```

### 6.2 `lg.json`

```json
{
  "schema_version": "lg.project.v1",
  "project": {
    "title": "长生错",
    "language": "zh-CN",
    "genre": ["仙侠", "悬疑", "权谋"],
    "root_policy": "local_files_only"
  },
  "model": {
    "provider": "deepseek",
    "default_model": "deepseek-v4-pro",
    "light_model": "deepseek-v4-flash",
    "base_url": "https://api.deepseek.com",
    "api_key_env": "DEEPSEEK_API_KEY",
    "temperature": {
      "analysis": 0.3,
      "action_json": 0.1,
      "prose_draft": 0.8
    },
    "stream": true,
    "json_mode": true
  },
  "workspace": {
    "active_volume": "volume_01",
    "active_chapter": "0004",
    "chapter_glob": "manuscript/chapters/*.md"
  },
  "sources": {
    "allow_clipboard": true,
    "raw_import_policy": "append_only",
    "max_import_chars": 120000,
    "default_trust_level": "proposal"
  },
  "vibewriting": {
    "requires_action_for_canon": true,
    "always_check_conflicts": true,
    "include_rejected_decisions": true
  },
  "context": {
    "max_input_tokens": 64000,
    "reserved_output_tokens": 6000,
    "recent_turns": 12,
    "recent_decisions": 30,
    "include_adjacent_chapters": true,
    "chapter_window": 1,
    "prefer_cacheable_prefix": true
  },
  "actions": {
    "require_accept_before_write": true,
    "allow_delete": false,
    "allow_rename": false,
    "max_files_per_action": 6,
    "snapshot_before_apply": true,
    "git_diff_before_apply": true,
    "commit_default": false
  }
}
```

### 6.3 `story/outline/chapter_map.md`

机器高频改动的 Markdown 文件不要用宽表格，改用 section block + anchor。

```markdown
# Chapter Map

## volume_01

### ch0004 照水无痕 <!-- lg:sec=chapter-ch0004 -->
- POV：庄悬墨
- 功能：把主线秘密从“读者隐约感到奇怪”推进到“庄悬墨产生可行动怀疑”。
- 场景目标：庄悬墨试探谢闻衣。
- 阻力：谢闻衣回避，且现场有第三方打断。
- 转折：庄悬墨发现谢闻衣十年前画像与现在外貌几乎一致。
- 读者新增认知：谢闻衣外貌可能多年未变。
- 角色新增认知：庄悬墨只确认“外貌异常”，未确认“长生”。
- 章末状态：庄悬墨怀疑外貌异常，但没有得到长生答案。
- 禁止：直接说出长生、不死、百年不变。
- 状态：draft
```

### 6.4 `story/hooks.md`

伏笔不是散文备注，而是曝光台账。

```markdown
# Hooks

## hook_001 谢闻衣外貌不变 <!-- lg:sec=hook-hook_001 -->
- 类型：主线秘密
- 真相：谢闻衣存在异常延寿现象，但成因未公开。
- 读者已知：谢闻衣可能不老，但原因不明。
- 已知角色：庄悬墨只察觉外貌异常。
- 未知角色：庄悬墨不知道长生机制。
- 首次埋下：ch0002
- 当前处理：ch0004 只让庄悬墨产生可行动怀疑。
- 计划回收：vol01 climax
- 状态：active
- 风险：过早说破长生会削弱悬念。
```

状态枚举：

```text
seeded       已种下，但读者可能没注意
active       正在被反复提醒或升级
misdirect    当前用于误导
revealed     已揭示
paid_off     已回收并产生情节后果
dropped      作者确认废弃
```

### 6.5 `story/current_state.md`

`current_state.md` 只保存当前活跃叙事窗口，不写整书百科。

```markdown
# Current State

## 全局进度
- 当前卷：第一卷 白鹿观
- 当前章：ch0004
- 当前叙事阶段：秘密即将被怀疑，但不能被证实。

## 角色认知表
| 角色 | 已知事实 | 误判 | 禁止提前知道 |
|---|---|---|---|
| 庄悬墨 | 谢闻衣外貌异常 | 以为是易容、术法或画像作伪 | 长生真相 |
| 谢闻衣 | 庄悬墨已起疑 | 低估其观察力 | - |
| 读者 | 谢闻衣可能不老 | 不确定原因 | 完整长生机制 |

## 本章目标
- 让庄悬墨产生怀疑，但只落在“外貌不变”层面。
- 不让任何角色直接说出“长生”。

## 最近确认方向
- 2026-05-22：第4章秘密暴露过早，应改为外貌异常线索。
```

限制：

1. current_state 只写当前前线。
2. 历史事实沉淀进 bible / chapter_map / decisions。
3. 文件过长时必须 compact 或拆分。

### 6.6 `memory/decisions.jsonl`

追加式决策账本。每一行一个 JSON，永不就地修改。

```jsonl
{"schema":"lg.decision.v1","id":"dec_20260522_000001","ts":"2026-05-22T19:02:11-07:00","session_id":"ses_20260522_chat","status":"accepted","summary":"第4章不直接暴露长生秘密，只让庄悬墨发现谢闻衣外貌十年未变。","rationale":"保持主线悬念，避免第4章信息释放过重。","related_files":["story/current_state.md","story/outline/chapter_map.md","story/hooks.md"],"action_id":"act_20260522_000001","tags":["ch0004","hook_001","reveal_control"]}
{"schema":"lg.decision.v1","id":"dec_20260522_000002","ts":"2026-05-22T19:05:20-07:00","session_id":"ses_20260522_chat","status":"rejected","summary":"拒绝让庄悬墨直接听到谢闻衣承认长生。","rationale":"作者认为太直白。","related_files":["manuscript/chapters/0004.md"],"tags":["ch0004","rejected_direction"]}
```

### 6.7 `memory/compact.md`

`compact.md` 是会话压缩，不是项目规则。

```markdown
# Compact Memory

updated_at: 2026-05-22T19:10:00-07:00
source_sessions:
  - ses_20260522_chat

## 已确认事实
- 第4章只允许暴露“谢闻衣外貌异常”，不能暴露完整长生机制。

## 作者偏好
- 喜欢通过物证和误判推进悬念，不喜欢角色直接解释秘密。
- 倾向慢热、压抑、留白，而不是爽快揭露。

## 已拒绝方向
- 庄悬墨直接逼问“你是不是长生者”。
- 谢闻衣主动承认百年未老。

## 待定问题
- 十年前画像是谁画的？是否可靠？
- 外貌异常与白鹿观旧井是否有关？

## 当前章节目标
- ch0004：庄悬墨产生怀疑，但只能把怀疑落在外貌未变上。

## 下一步建议
- 检查 0004.md 是否存在“长生、不死、百年”直白词，必要时替换为物证和行为线索。
```

默认规则：`lg compact` 生成 ActionSet，而不是直接覆盖 `compact.md`。

---

## 7. Vibewriting Pipeline

### 7.1 总流程

```text
输入材料
  ↓
Source / SourceRef / SourceArtifact
  ↓
Normalize
  清洗格式、切分对话轮次、提取 metadata
  ↓
Context Build
  读取当前章、设定、伏笔、最近决策
  ↓
Extract
  抽取候选事实、草稿、偏好、拒绝方向
  ↓
Conflict Check
  和正典状态、伏笔、拒绝决策比对
  ↓
VibePacket
  生成可审阅整编包
  ↓
Draft ActionSet
  只把可吸收内容转成 pending action
  ↓
Human Review
  accept / reject / defer
  ↓
Atomic Apply
  写入 story / manuscript / memory
```

### 7.2 本地 chat 流程

`lg chat` 是实时 Source 产生器。

普通对话：

```text
user turn / assistant turn
→ sessions/*.jsonl
→ 参与当前上下文
```

用户说“整理 / 生成动作 / 吸收这段”时：

```text
session slice
→ SourceRef 或 SourceArtifact
→ VibePacket
→ ActionSet
→ pending
```

这样既保留“万物皆 Source”，又避免一开始把每轮 chat 都做成重对象。

### 7.3 官网对话导入流程

```bash
lg ingest --from clipboard --source official_chat --chapter 0004
lg vibe latest --chapter 0004
lg vibe latest --chapter 0004 --draft-action
lg actions diff act_20260522_000001
lg accept act_20260522_000001
```

`lg ingest` 只保存来源，不调用模型，不改正典。

`lg vibe` 才进入抽取、对齐和冲突检查。

### 7.4 冲突检查对象

Vibewriting 生成 ActionSet 前必须检查：

| 检查对象 | 检查内容 |
|---|---|
| `current_state.md` | 角色知道什么、读者知道什么、当前阶段是否匹配 |
| `hooks.md` | 是否提前揭示伏笔、跳过升级、破坏回收计划 |
| `chapter_map.md` | 是否符合本章功能、场景目标、章末状态 |
| `bible.md` | 是否违反硬设定 |
| `decisions.jsonl` | 是否和 accepted 决策冲突，是否重复 rejected 方向 |
| `LG.md` / `style.md` / `preferences` | 是否违背作者偏好和协作规则 |

冲突不一定阻断，但必须显示在报告中。

示例：

```text
⚠ high
source 中建议“庄悬墨当场逼问长生”，但 decisions.jsonl 中存在 rejected decision：
“拒绝让庄悬墨直接听到谢闻衣承认长生。”

建议改为：庄悬墨只确认画像与容貌异常，章末转向调查画像来源。
```

---

## 8. Context Builder

### 8.1 分层上下文

```text
T0  LG 协议
T1  项目配置：lg.json + LG.md + style.md
T2  稳定正典：bible.md
T3  当前正典：current_state.md + hooks.md
T4  结构上下文：volume outline + chapter_map
T5  正文局部：当前章 + 相邻章摘要
T6  决策记忆：recent decisions + compact
T7  Source 上下文：SourceRef / SourceArtifact / VibePacket
T8  会话尾巴：最近 N 轮
T9  检索补充：关键词 / hook id / character name / ripgrep
```

### 8.2 上下文排序

为了调试稳定和缓存命中，prompt scaffold 与文件排序尽量固定：

```text
[System: LG protocol]
[Project: lg.json + LG.md + style]
[Canon: bible]
[Current canon: current_state + hooks]
[Compact memory]
[Outline: active volume + chapter_map]
[Manuscript: active chapter]
[Recent decisions]
[Source metadata / summary / VibePacket]
[Relevant source excerpts]
[Session tail]
[User request]
```

### 8.3 裁剪策略

当上下文超预算：

1. 永不裁剪 T0。
2. 优先保留 `LG.md`、`current_state.md`、`hooks.md`、当前章。
3. `bible.md` 过长时只保留相关标题块。
4. `chapter_map` 过长时保留当前卷、当前章、前后三章卡片。
5. decisions 优先保留同章节、同 hook、rejected、recent accepted。
6. Source 过长时先使用 source summary，再取相关片段。
7. raw imports 不默认进入普通 chat，只在处理相关 Source 时进入。

### 8.4 Source 渐进式披露

不是所有 Source 都应该进入每一轮 prompt。

Source 进入上下文时按层披露：

```text
L0: source metadata
L1: source summary
L2: VibePacket extracted fields
L3: relevant excerpts
L4: raw source full text
```

默认策略：

1. 普通 chat 不携带所有 raw imports。
2. 处理某个 source 时才读取它的 raw text 或 excerpt。
3. source 过长时先生成 summary / VibePacket。
4. 只有和当前问题强相关的 raw excerpt 才进入模型上下文。

### 8.5 证据预算

每次输出判断时，最多展示 3-7 个 evidence。

每个 evidence 必须有：

```ts
type EvidenceRef = {
  path: string
  selector?: string
  reason: string
  canon_status: 'canon' | 'proposal' | 'memory' | 'derived'
}
```

没有 evidence 的判断只能标为 speculation，不得伪装成已确认事实。

### 8.6 `lg context --explain`

必须显示：

```text
Context Pack for ch0004

Included:
  LG.md
    reason: 项目级协作规则
    canon_status: canon_rule
  story/current_state.md
    reason: 当前章角色认知状态
  story/hooks.md
    reason: hook_001 相关
  story/outline/chapter_map.md
    reason: ch0004 功能与章末状态
  memory/decisions.jsonl
    reason: 最近 rejected direction 需要避免重复
  imports/official_chat/2026-05-22_001.md
    reason: 当前执行 vibe latest
    canon_status: proposal
    disclosure_level: excerpt

Excluded:
  imports/official_chat/old.md
    reason: 不相关且非正典
  sessions/old.jsonl
    reason: 已由 compact 覆盖
```

---

## 9. CLI 命令设计

### 9.1 顶层命令

```bash
lg init [dir]
lg chat [--chapter 0004] [--resume] [--session <id>]

lg ingest [file] [--from clipboard] [--source official_chat] [--chapter 0004]
lg sources [list|show|summarize] [id]
lg vibe [source-id|latest|session] [--chapter 0004] [--draft-action]

lg context [--chapter 0004] [--json] [--explain]
lg status
lg compact [--focus <text>] [--session <id>]

lg actions [list|show|diff] [id]
lg accept <id> [--commit]
lg reject <id> [--reason <text>]
lg defer <id> [--until <text>] [--reason <text>]
lg undo <action-id>

lg log [--status accepted|rejected|deferred] [--tag ch0004]
lg doctor
```

### 9.2 `lg chat`

`lg chat` 是主交互入口。

```text
$ lg chat --chapter 0004

你> 第4章这里长生秘密暴露太直接，我觉得暂时只是外貌没变

LG> 我查了 current_state、hooks、chapter_map、最近 rejected decisions。
    判断：你说得对。当前更适合把 hook_001 从“读者隐约感到奇怪”
    推进到“庄悬墨产生可行动怀疑”，而不是揭示长生机制。

    建议：
    1. 角色认知：庄悬墨只确认“十年前画像与现在容貌一致”。
    2. 解释空间：误判为易容、驻颜术、画像作伪。
    3. 章末推力：他决定查画像来源，而不是逼问谢闻衣。

    是否整理成待确认修改？
```

用户说“整理”后：

```text
LG> 已生成 VibePacket vw_20260522_000001
    已生成 pending action act_20260522_000001

将修改：
1. story/outline/chapter_map.md
2. story/current_state.md
3. story/hooks.md
4. memory/decisions.jsonl

下一步：
/diff act_20260522_000001
/accept act_20260522_000001
/reject act_20260522_000001
```

### 9.3 chat 内 slash commands

| 命令 | 作用 |
|---|---|
| `/help` | 查看可用命令 |
| `/status` | 当前项目状态 |
| `/context` | 本轮上下文报告 |
| `/actions` | 待确认动作列表 |
| `/diff <id>` | 查看动作 diff |
| `/accept <id>` | 接受并落盘 |
| `/reject <id>` | 拒绝动作 |
| `/defer <id>` | 搁置动作 |
| `/compact [focus]` | 压缩当前会话，默认生成 ActionSet |
| `/ingest` | 从剪贴板导入官网对话 |
| `/vibe [latest/id]` | 对导入源做 vibewriting 整编 |
| `/focus <chapter-id|hook-id|character>` | 切换关注对象 |
| `/chapter 0005` | 切换当前章 |
| `/new` | 同项目内重开会话上下文 |
| `/quit` | 退出 |

### 9.4 `lg ingest`

只保存 SourceArtifact 或 SourceRef，不调用模型，不改正典。

```bash
lg ingest --from clipboard --source official_chat --chapter 0004
```

输出：

```text
Imported source src_20260522_000001
Path: imports/official_chat/2026-05-22_001.md
Status: raw proposal
Next: lg vibe src_20260522_000001 --chapter 0004
```

### 9.5 `lg vibe`

对任意 Source 执行 vibewriting。

```bash
lg vibe latest --chapter 0004
```

输出：

```text
VibePacket vw_20260522_000001

提取：
- 候选事实：庄悬墨只发现谢闻衣外貌异常，不知道长生机制。
- 风格偏好：保留悬疑感，但不要刑侦审讯。
- 拒绝方向：不要直接说出长生、不死、百年不变。
- 待定问题：画像来源是否在第5章追查？

冲突：
- medium: chapter_map 当前写“长生秘密暴露”，与候选方向冲突。
- high: source 中有“当场逼问长生”，与 rejected decision 冲突。

建议：
1. 更新 chapter_map 的 ch0004 功能、阻力、章末状态。
2. 更新 current_state 的角色认知表。
3. 更新 hooks.md 的 hook_001 当前处理。
4. 追加 accepted decision。

运行：
lg vibe latest --draft-action
```

### 9.6 `lg accept`

```bash
lg accept act_20260522_000001 --commit
```

流程：

```text
1. 读取 pending action
2. 校验 schema
3. 校验路径白名单
4. 校验 preconditions
5. 生成 dry-run diff
6. 写 snapshot
7. 加 apply lock
8. 原子写入所有文件
9. 更新 pending 状态
10. 追加叙事 decision
11. 写入 apply audit
12. 移动 action 到 archive
13. 如用户显式传入 --commit，则执行 git commit
```

---

## 10. Agent 回合协议

### 10.1 TurnIntent

```ts
type TurnIntent =
  | 'discuss'
  | 'draft_action'
  | 'edit_action'
  | 'apply_action'
  | 'reject_action'
  | 'defer_action'
  | 'ingest_source'
  | 'vibewrite_source'
  | 'status'
  | 'compact'
  | 'context'
```

### 10.2 规则优先级

1. slash 命令优先。
2. “整理 / 生成动作 / 待确认修改” → `draft_action`
3. “接受 / accept / 落盘” → `apply_action`
4. “拒绝 / 不要这样” → `reject_action`
5. “这是我在官网聊出来的” → `ingest_source`
6. “帮我整编 / vibe / 吸收这段” → `vibewrite_source`
7. 其他默认 `discuss`

### 10.3 discuss 输出格式

```text
我查了：
- story/current_state.md：当前第4章限制是……
- story/outline/chapter_map.md：第4章目标是……
- story/hooks.md：hook_001 当前状态是……
- 最近决策：你拒绝过“直接说破长生”

我的判断：
……

建议方向：
1. ……
2. ……
3. ……

是否整理成待确认修改？
```

禁止：

1. 说“我已经修改了文件”，除非真的 apply 成功。
2. 编造上下文中没有的设定。
3. 在未确认时输出大段正文覆盖。
4. 把 proposal 当作 canon。

### 10.4 draft_action 输出格式

生成 ActionSet 后，CLI 渲染为人类可读清单：

```text
生成待确认动作：act_20260522_000001
标题：调整第4章秘密暴露层级

将修改：
1. story/outline/chapter_map.md
   - ch0004 阻力：改为“只能确认外貌异常，不能确认长生”
   - ch0004 章末状态：保留怀疑，不给答案
2. story/current_state.md
   - 更新角色认知表：庄悬墨知道“外貌异常”，不知道“长生真相”
3. story/hooks.md
   - hook_001 当前处理：由“秘密暴露”改为“异常线索升级”

风险：medium
- 会降低本章信息量，需要用物证增强推动感。

下一步：/diff act_... /accept act_... /reject act_... /defer act_...
```

---

## 11. Apply Engine 与安全模型

### 11.1 路径白名单

只允许修改：

```text
LG.md
lg.json
manuscript/
story/
memory/
imports/
sessions/
actions/
.lg/snapshots/
.lg/traces/
```

禁止：

```text
绝对路径
.. 路径穿越
~ 用户目录
.git/
node_modules/
任意 shell 执行
网络写入
```

### 11.2 Preconditions

每个 ActionSet 必须带 preconditions。

```ts
type FilePrecondition = {
  path: ProjectPath
  sha256?: string
  selector?: string
  old_contains?: string[]
}
```

校验失败时：

```text
Action is stale.
story/outline/chapter_map.md changed since this action was drafted.
Run: lg actions diff act_... --refresh
or ask in chat: 重新整理这个动作
```

### 11.3 原子落盘流程

```text
1. 读取 pending action
2. validate schema
3. validate paths
4. validate preconditions
5. generate dry-run next files
6. render diff
7. write snapshot
8. acquire lock
9. write temp files
10. fsync temp files
11. rename temp files
12. append decision ledger
13. append apply audit
14. update pending/archive
15. release lock
```

任何一步失败，必须回滚或保持原文件不变。

### 11.4 正文改写更严格

触碰 `manuscript/chapters/*.md` 的 ActionSet：

1. risk_level 至少为 medium。
2. diff 中必须显示正文改动。
3. CLI 显示二级确认提示。
4. 如果改动确立新事实，必须同步 `current_state.md`、`hooks.md` 或 `chapter_map.md` 中至少一个相关位置。

规则：

```text
任何改变 canon 的正文修改，都应同步至少一个状态文件。
```

---

## 12. 技术实现建议

### 12.1 技术栈

推荐 TypeScript / Node.js 20+。

原因：

1. CLI 分发简单。
2. JSON Schema / Zod / Markdown 解析生态成熟。
3. 和 OpenAI-compatible API 集成直接。
4. 未来做 TUI、VS Code 插件、桌面壳迁移成本低。
5. 对 v1 来说，交付速度比系统语言性能更重要。

建议依赖：

| 模块 | 建议库 | 用途 |
|---|---|---|
| CLI 框架 | `commander` 或 `cac` | 命令解析 |
| 交互输入 | `@inquirer/prompts` 或 `enquirer` | accept/reject/defer 选择 |
| 终端输出 | `chalk`, `ora`, `boxen` | 清晰显示上下文、动作、diff |
| Markdown 解析 | `unified`, `remark-parse`, `gray-matter` | 标题块、front matter、section anchor |
| Schema 校验 | `zod` | `lg.json`、ActionSet、pending.json |
| Diff | `diff` 或 `git diff --no-index` | 预览与落盘前校验 |
| 文件锁 | `proper-lockfile` | 防止两个 CLI 同时写 |
| 原子写 | 自写 `writeFileAtomic` | temp + fsync + rename |
| 模型 SDK | OpenAI-compatible client | DeepSeek API 适配 |

### 12.2 模块分层

```text
packages/lg-cli/
  src/
    cli/
    project/
    schema/
    source/
    ingest/
    vibewrite/
    context/
    model/
    agent/
    actions/
    memory/
    render/
    telemetry/
```

核心接口：

```ts
interface ProjectRepo {
  root: string
  readText(path: ProjectPath): Promise<TextFile>
  writeTextAtomic(path: ProjectPath, next: string, reason: string): Promise<WriteResult>
  snapshot(paths: ProjectPath[], actionId: string): Promise<SnapshotRef>
  gitStatus(): Promise<GitStatus | null>
}

interface ContextBuilder {
  build(input: UserTurn, scope: ContextScope): Promise<ContextPack>
  explain(pack: ContextPack): ContextReport
}

interface ModelGateway {
  chat(messages: LLMMessage[], options: ChatOptions): AsyncIterable<ModelChunk>
  json<T>(messages: LLMMessage[], schema: JsonSchema, options: JsonOptions): Promise<T>
}

interface VibeWritingEngine {
  buildPacket(source: SourceRef | SourceArtifact, context: ContextPack): Promise<VibePacket>
  detectConflicts(packet: VibePacket, context: ContextPack): Promise<ConflictReport>
  proposeActions(packet: VibePacket, report: ConflictReport): Promise<ActionSet>
}

interface ActionEngine {
  validate(action: ActionSet): Promise<ValidationReport>
  preview(action: ActionSet): Promise<DiffReport>
  apply(actionId: string): Promise<ApplyReport>
}
```

### 12.3 对话与动作分两阶段

不要让模型边聊边输出补丁。

```text
Dialog Engine:
  自然语言流式输出
  负责分析、判断、建议、询问是否整理

Action Planner:
  用户明确要求“整理 / 生成动作”后调用
  生成结构化 ActionSet

Patch Applier:
  本地校验、预览、原子写入
  不盲信模型生成的 patch
```

结构化输出只用于：

1. VibePacket；
2. ActionSet；
3. compact action；
4. optional lint report。

普通创作建议保持自然语言。

---

## 13. 开发阶段计划

### Phase 0：骨架与文件协议

目标：能初始化项目，读写基础文件。

交付：

- `lg init`
- 目录模板
- `LG.md`
- `lg.json`
- `ProjectRepo`
- path whitelist
- section anchor parser
- JSONL append helper

### Phase 1：Context Builder

目标：能解释本轮上下文。

交付：

- `lg context --explain`
- stable prompt scaffold
- current chapter lookup
- recent decisions lookup
- Source disclosure levels
- token estimate

### Phase 2：Ingest + VibePacket

目标：能把外部材料变成 VibePacket。

交付：

- `lg ingest <file>`
- `lg vibe latest`
- SourceRef
- SourceArtifact metadata
- VibePacket schema
- conflict report

### Phase 3：ActionSet

目标：能从 VibePacket 生成 pending action。

交付：

- `lg vibe latest --draft-action`
- `actions/pending.json`
- ActionSet schema
- action validation
- `lg actions list/show/diff`

### Phase 4：Accept / Reject / Defer

目标：能安全落盘并记住决策。

交付：

- `lg accept`
- `lg reject`
- `lg defer`
- atomic apply
- snapshot
- decisions append
- apply audit

### Phase 5：Chat REPL

目标：能在项目中对话、讨论、整理。

交付：

- `lg chat`
- session JSONL
- slash commands
- discuss output
- session slice → SourceRef
- “整理” → VibePacket → ActionSet

### Phase 6：Compact 与 Undo

目标：能长期使用。

交付：

- `lg compact` 生成 compact ActionSet
- `lg undo <action-id>`
- snapshot restore
- stale action refresh

---

## 14. 最小测试清单

v1 不做完整评估体系，但必须有工程护栏测试。

### 14.1 Schema 测试

- `lg.json` schema
- SourceRef / SourceArtifact schema
- VibePacket schema
- ActionSet schema
- DecisionEvent schema
- pending.json schema

### 14.2 Markdown 操作测试

- section anchor 定位
- replace_section 成功
- replace_section selector 缺失失败
- old_contains 不匹配失败
- append_under_section 成功
- 正文 replace_excerpt 多处匹配失败

### 14.3 安全测试

- path traversal 被拒绝
- 绝对路径被拒绝
- shell_exec op 被拒绝
- delete_file / rename_file 被拒绝
- 超过 max_files_per_action 被拒绝

### 14.4 Apply 测试

- precondition sha mismatch → stale
- 部分写入失败 → 回滚
- snapshot 生成成功
- decisions.jsonl append 成功
- apply audit append 成功
- pending action 移动 archive

### 14.5 叙事一致性测试

准备 golden fixture：

```text
ch0004 当前 chapter_map 写“长生秘密暴露”
hooks 中 hook_001 禁止提前说破
决策账本中 rejected “庄悬墨直接逼问长生”
source 中包含“直接逼问长生”的建议
```

期望：

1. vibe 识别 high conflict。
2. ActionSet 建议只改为“外貌异常”。
3. accept 后 chapter_map / hooks / current_state 同步更新。
4. decisions.jsonl 追加 accepted decision。
5. 后续 chat 能读到该决策。

---

## 15. v1 完成标准

只要下面这些点全部满足，就不要继续扩 scope：

1. `lg init` 能生成完整项目骨架，包括 `LG.md` 与故事文件模板。
2. `lg ingest` 能导入官网对话 / Markdown 草稿为 proposal source。
3. `lg vibe` 能基于正典上下文生成 VibePacket 和 ConflictReport。
4. `lg context` 能清楚显示本轮真实上下文包。
5. 用户说“整理”后，系统能生成 ActionSet。
6. `lg actions diff` 能预览变更。
7. `lg accept` 能原子应用 ActionSet，并记入 `decisions.jsonl`。
8. `lg reject` / `lg defer` 能把否决方向写进决策日志。
9. 后续会话能读到 accepted / rejected / deferred decisions。
10. `lg compact` 能生成分层摘要 ActionSet，而不是简单聊天总结。
11. 系统永远不会在未 accept 的情况下改写 `story/*` 或 `manuscript/*`。
12. 触碰正文的 ActionSet 会有更高风险提示。
13. 任意一次落盘后，`current_state.md` / `hooks.md` / `chapter_map.md` 不会出现明显失配。

---

## 16. v1 明确排除项

- 多模型适配
- 自动多代理并行
- 向量数据库与嵌入检索
- 完整可视化 GUI
- 自动 Git commit
- 后台守护进程式持续监控
- 无确认直接改正文
- 浏览器自动抓官网对话
- 直接覆盖整章正文
- 用外部 Source 直接污染 canon

---

## 17. 核心结论

LG 灵构 v1 的关键不是让模型“更会写”，而是让灵感进入正典之前被治理。

它要优先证明四件事：

1. **上下文可信。** 模型知道自己看了什么，也能告诉作者它看了什么。
2. **提案可审。** 所有修改都变成 ActionSet，而不是散乱建议。
3. **落盘可控。** 只有 accept 后，才原子修改文件。
4. **决策可记。** 接受、拒绝、搁置都会影响后续创作。

v1 做到这四点，就已经成立。

后续再做 GUI、timeline lint、continuity audit、subagents、向量检索、编辑器插件，才有稳定地基。

