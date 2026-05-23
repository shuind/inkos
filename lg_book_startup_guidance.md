# LG 灵构建书流程指导文档 v0.1

日期：2026-05-22

目标：解决 LG 灵构在“新建小说”阶段的产品与技术边界问题，形成可直接指导 v0.1 开发的建书流程。

---

## 1. 核心结论

LG 的“新建小说”不应该是传统表单，也不应该是一键生成全书架构。

它应该拆成两层：

```text
创建项目壳
→ 启动第一卷创作共识
```

也就是说：

```bash
lg init my-book
lg startup
```

或合并体验：

```bash
lg init my-book --startup
```

`lg init` 只负责创建本地小说工程。

`lg startup` 才负责通过对话、粘贴、追问、确认，把“第一卷启动共识”写入项目文件。

---

## 2. 建书阶段要解决什么

建书不是要一次性确定整本书全部内容。

建书阶段只需要解决四件事：

1. 这本书暂时叫什么。
2. 第一卷写什么。
3. 当前开局从哪里切。
4. AI 后续写作时必须遵守哪些稳定边界。

更具体地说，v0.1 建书只产出：

```text
整书稳定前提
第一卷启动信息
前 3-10 章问题链草案
当前待确认问题
作者偏好和禁区
```

不要强行要求：

- 完整全书大纲；
- 全部角色表；
- 全部世界观；
- 200 章完整规划；
- 所有伏笔回收表；
- 完整商业卖点分析。

长篇小说越早强行定死全书，后面越容易被假精确拖死。

LG 建书的目标是“足够开始写第一卷”，不是“把整本书算完”。

---

## 3. 用户体验原则

### 3.1 粘贴和对话优先

用户不应该先看到一堆字段。

启动时应该看到：

```text
你可以直接描述你的构思，或粘贴你在 Gemini / ChatGPT / Claude 官网聊出的内容。
LG 会先帮你整理，不会直接写入正典。
```

输入可以很混乱：

- 一段小说构思；
- 官网模型对话；
- 人物设定；
- 片段正文；
- 不满意的旧方案；
- 作者临时想法；
- 多轮对话混在一起。

LG 应该做的是：

```text
读取输入
→ 抽取候选
→ 标明明确 / 推测 / 冲突 / 缺口 / 建议
→ 追问关键缺口
→ 生成第一卷启动 ActionSet
→ 作者确认后落盘
```

### 3.2 不把 AI 建议当事实

建书阶段所有输入默认都是 proposal。

只有作者确认后的 ActionSet 才能写入：

```text
story/*
memory/decisions.jsonl
LG.md
lg.json
```

规则：

```text
DeepSeek 可以建议，但不能替作者拍板。
官网模型内容可以参考，但不能直接变成正典。
作者一句话否定的方向，必须进入 rejected/deferred 记忆。
```

### 3.3 建书也要像 Codex 一样可解释

LG 每次整理建书信息时，都必须能说明：

```text
我看到了什么
我判断哪些是明确设定
哪些只是推测
哪些互相冲突
哪些会影响第一卷开局
哪些需要你拍板
```

用户不应该面对“整理结果一大堆块”。

v0.1 的输出应该是少量行动项，而不是素材瀑布流。

---

## 4. 推荐命令设计

### 4.1 创建空项目

```bash
lg init my-book
```

结果：

```text
Created LG project: my-book

Next:
  cd my-book
  lg startup
```

该命令不调用模型。

它只创建基础目录和模板文件。

### 4.2 直接启动建书

```bash
lg init my-book --startup
```

等价于：

```bash
lg init my-book
cd my-book
lg startup
```

### 4.3 启动建书对话

```bash
lg startup
```

进入一个专门的建书 REPL：

```text
LG startup

你可以描述构思，或粘贴官网模型内容。
当前不会写入正典；只有你确认 ActionSet 后才会落盘。

你>
```

用户可以输入：

```text
我想写一个长生流修仙，主角一百岁还是炼气五层，快被天道发现……
```

LG 回复：

```text
我整理到的第一卷启动信息：

明确：
1. 主角顾慎，一百岁，炼气五层。
2. 长生不是安全能力，而是每百年会被天道索命。
3. 第一卷压力来自第一次寿劫。

推测：
1. 主角风格偏苟道、稳健、提前布局。

冲突：
暂无。

缺口：
1. 第一卷第一个可写场景还不够明确。
2. 阻止主角活下来的具体人或制度还不够明确。

建议：
1. 第一卷只围绕“七天后寿劫”展开，不急着设计全书后期。

是否继续追问，还是整理成待确认建书动作？
```

### 4.4 粘贴官网内容

v0.1 不需要单独的 `Gemini 原文保存区`。

在 `lg startup` 或 `lg chat` 里直接粘贴即可。

如果用户明确想保存来源：

```bash
lg ingest ./gemini.md --source official_chat --startup
```

但这不是主流程。

主流程应该是：

```text
用户粘贴
→ LG 识别为 Source
→ 进入当前启动对话
→ 必要时生成 SourceRef
→ 不默认生成重型 SourceArtifact
```

---

## 5. 建书阶段文件输出

### 5.1 `lg init` 生成的空文件

```text
my-book/
  LG.md
  lg.json
  README.md

  manuscript/
    chapters/
    fragments/

  story/
    bible.md
    current_state.md
    hooks.md
    style.md
    outline/
      volume_01.md
      chapter_map.md

  memory/
    compact.md
    decisions.jsonl

  sessions/

  actions/
    pending.json
    archive/

  imports/
```

### 5.2 `lg startup` 确认后写入的文件

建书 ActionSet 被接受后，至少写入：

```text
lg.json
LG.md
story/bible.md
story/current_state.md
story/hooks.md
story/style.md
story/outline/volume_01.md
story/outline/chapter_map.md
memory/decisions.jsonl
```

可以创建但不强制创建：

```text
manuscript/chapters/0001.md
```

建议 v0.1 默认不要自动生成第 1 章正文文件。

更好的做法是创建一个章目标，而不是正文：

```text
story/outline/chapter_map.md 中有第 1 章任务
manuscript/chapters/0001.md 只有在用户要求“创建草稿”时生成
```

---

## 6. 建书 ActionSet 设计

建书阶段的落盘也必须走 ActionSet。

示例：

```json
{
  "schema": "lg.action_set.v1",
  "id": "act_startup_20260522_000001",
  "title": "创建《长生不死，我只想苟过天劫》第一卷启动共识",
  "summary": "写入书籍基础、整书稳定前提、第一卷目标、前10章问题链草案和作者偏好。",
  "risk_level": "medium",
  "origin": {
    "kind": "startup_chat"
  },
  "related": {
    "chapters": ["0001"],
    "files": [
      "lg.json",
      "LG.md",
      "story/bible.md",
      "story/current_state.md",
      "story/hooks.md",
      "story/style.md",
      "story/outline/volume_01.md",
      "story/outline/chapter_map.md",
      "memory/decisions.jsonl"
    ]
  },
  "ops": []
}
```

实际 `ops` 可以包括：

- `replace_section`
- `append_under_section`
- `create_file`
- `append_decision`

建书 ActionSet 的风险至少是 `medium`，因为它会定义后续写作基线。

---

## 7. 第一卷启动稿最小结构

LG 不应该强制用户填表，但内部可以整理成固定结构。

建议结构：

```markdown
# 第一卷启动稿

## 书籍基础
- 书名：
- 类型/题材：
- 目标平台：
- 预计篇幅：
- 单章字数：

## 整书稳定前提
- 核心设定：
- 主角长期问题：
- 长期目标：
- 风格关键词：
- 明确禁区：

## 第一卷核心
- 第一卷问题：
- 第一卷目标：
- 失败代价：
- 主要阻力：
- 开局切入：
- 卷末状态：

## 当前主角状态
- 身份：
- 能力：
- 弱点：
- 当前压力：
- 当前误解/秘密：

## 近 3-10 章问题链

### 第 1 章
- 问题：
- 行动：
- 阻力：
- 转折：
- 结果：
- 章末钩子：

## 待确认问题
- 

## 明确拒绝方向
- 
```

注意：

```text
近 3-10 章问题链是草案，不是硬性全书规划。
```

---

## 8. 新建小说的状态机

项目状态建议分为：

```text
empty
startup_drafting
startup_pending
active
```

含义：

| 状态 | 含义 |
|---|---|
| `empty` | 只有目录骨架，没有可写上下文 |
| `startup_drafting` | 正在对话整理建书信息 |
| `startup_pending` | 已生成建书 ActionSet，等待确认 |
| `active` | 已接受建书 ActionSet，可以进入普通 `lg chat` |

写入 `lg.json`：

```json
{
  "workspace": {
    "status": "startup_drafting",
    "active_volume": "volume_01",
    "active_chapter": "0001"
  }
}
```

状态规则：

```text
empty 项目进入 lg chat 时，自动提示先运行 lg startup。
startup_pending 状态进入 lg chat 时，优先展示 pending startup action。
active 后才默认进入普通章节创作对话。
```

---

## 9. 建书对话的模型职责

DeepSeek 在建书阶段只负责：

1. 整理用户输入；
2. 区分事实、推测、建议、冲突、缺口；
3. 提出追问；
4. 生成第一卷启动 ActionSet；
5. 生成给外部模型的追问提示词。

DeepSeek 不负责：

- 替作者直接定死全书；
- 未确认就写入文件；
- 把官网模型内容当权威；
- 自动生成整章正文；
- 自动覆盖作者旧构思。

---

## 10. 建书阶段 Prompt 规则

### 10.1 startup discuss prompt 输出

固定输出：

```text
我整理到的内容
需要你拍板的点
我建议先别定死的点
下一步最小行动
是否整理成待确认建书动作
```

禁止输出：

```text
完整大纲
完整正文
大量泛化建议
没有证据的设定补全
```

### 10.2 startup action prompt 输出

必须输出严格 JSON：

```json
{
  "startup": {
    "book": {},
    "stable": {},
    "volume1": {},
    "chapters": [],
    "followups": [],
    "rejections": []
  },
  "actionSet": {}
}
```

所有来源必须标注：

```text
explicit
inferred
suggestion
conflict
gap
```

只有 `explicit` 和作者在当前对话中确认的内容，可以进入强设定。

`suggestion` 必须进入待确认项。

---

## 11. 用户不清楚时的默认策略

建书阶段用户经常不知道怎么填。

LG 应该主动兜底：

| 缺失项 | 默认策略 |
|---|---|
| 缺书名 | `未命名作品-YYYYMMDD-HHmm` |
| 缺题材 | `待定` |
| 缺平台 | `unknown`，不要显示成拼音标签 |
| 缺目标章节 | 先用 `200`，标记为可改 |
| 缺单章字数 | 先用 `3000`，标记为可改 |
| 缺第一卷目标 | 追问，不要硬编 |
| 缺第一章切入 | 给 2-3 个可选切入方案 |
| 冲突设定 | 生成 decision，不自动合并 |

重要：

```text
默认值只是占位，不是作者确认的事实。
```

---

## 12. 建书阶段避免的问题

### 12.1 表单化

不要让用户一开始填：

```text
书名
题材
简介
主角
世界观
冲突
章数
字数
……
```

这会回到旧系统的问题。

正确做法：

```text
让用户粘贴或说想法
LG 自动整理
用户只拍板关键点
```

### 12.2 块堆积

不要展示几十个候选卡片。

建书阶段右侧或终端输出只显示：

```text
明确内容
需要拍板
缺口追问
下一步动作
```

原文和详细拆解只做追溯。

### 12.3 全书过早架构

建书阶段不要强制确定：

- 所有卷；
- 所有大反派；
- 所有角色结局；
- 所有伏笔回收；
- 全书最终主题。

只要求：

```text
整书稳定前提 + 第一卷启动稿
```

### 12.4 自动正典污染

官网模型说的内容、DeepSeek 建议的内容、作者随口试探的内容，都不能自动写入正典。

必须经过：

```text
ActionSet
→ diff
→ accept
```

---

## 13. v0.1 开发切分

### Step 1：`lg init`

实现：

- 创建目录；
- 写模板；
- 初始化 `lg.json`；
- 状态为 `empty`。

不调用模型。

### Step 2：`lg startup`

实现：

- 启动 REPL；
- 记录 `sessions/startup-*.jsonl`；
- 用户可粘贴构思；
- DeepSeek 回复结构化讨论；
- 不写正典。

### Step 3：`startup -> ActionSet`

实现：

- 用户输入“整理”；
- 读取 startup session；
- 生成建书 ActionSet；
- 写入 `actions/pending.json`；
- 状态改为 `startup_pending`。

### Step 4：`lg actions diff`

实现：

- 展示将写入哪些文件；
- 展示每个文件的摘要 diff；
- 明确提示“接受后才进入 active”。

### Step 5：`lg accept`

实现：

- 应用建书 ActionSet；
- 写入 story 文件；
- 追加 `memory/decisions.jsonl`；
- action 归档；
- 状态改为 `active`。

### Step 6：普通 `lg chat`

实现：

- 如果项目不是 `active`，先引导 startup；
- active 后读取建书文件作为上下文。

---

## 14. 验收标准

建书 v0.1 只要满足下面标准即可：

1. `lg init my-book` 能创建项目骨架。
2. 空项目运行 `lg chat` 会提示先 `lg startup`。
3. `lg startup` 支持自然语言构思和官网内容粘贴。
4. DeepSeek 会区分明确、推测、冲突、缺口、建议。
5. 用户说“整理”后生成建书 ActionSet。
6. 建书 ActionSet 未接受前，不修改 `story/*`。
7. `lg actions diff` 能看到将写入哪些文件。
8. `lg accept` 后写入第一卷启动共识。
9. `memory/decisions.jsonl` 记录建书决策。
10. 后续 `lg chat --chapter 0001` 能读到建书共识。

不要求：

- GUI；
- 完整 SourceArtifact；
- undo；
- compact 自动触发；
- 多模型；
- 全书完整架构。

---

## 15. 最终建议

LG 建书阶段的产品定位应该是：

```text
把混乱灵感启动成可写的第一卷工程。
```

不是：

```text
创建一个空目录
填一张小说表单
一次性生成全书大纲
保存一堆官网原文
```

v0.1 的最短闭环应该是：

```text
lg init
→ lg startup
→ 自然语言 / 粘贴构思
→ DeepSeek 整理与追问
→ 生成建书 ActionSet
→ diff
→ accept
→ 项目进入 active
→ lg chat 开始写第 1 章
```

只要这条闭环顺，LG 就真正进入了 vibewriting，而不是换皮的表单建书工具。
