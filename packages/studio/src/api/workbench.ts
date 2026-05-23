import type { ChapterMeta } from "@actalk/inkos-core";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative } from "node:path";

export type WorkbenchBlockKind =
  | "concept"
  | "outline"
  | "character"
  | "world"
  | "chapter"
  | "revision"
  | "prompt"
  | "note";

export type WorkbenchSaveTarget = "note" | "prompt" | "material" | "version" | "chapter" | "setting";
export type WorkbenchDigestStatus = "raw_saved" | "organized" | "applied" | "archived";
export type WorkbenchActionType = "draft" | "setting" | "decision" | "prompt";
export type WorkbenchActionStatus = "pending" | "accepted" | "rejected" | "deferred";

export interface WorkbenchActionItem {
  readonly id: string;
  readonly type: WorkbenchActionType;
  readonly title: string;
  readonly sourceEvidence: string;
  readonly status: WorkbenchActionStatus;
  readonly payload: Record<string, unknown>;
}

export interface WorkbenchActionPlan {
  readonly status: WorkbenchDigestStatus;
  readonly updatedAt: string;
  readonly model?: string;
  readonly targetChapter: number;
  readonly summary: string;
  readonly items: ReadonlyArray<WorkbenchActionItem>;
  readonly nextPrompt: string;
  readonly rawBlockCount: number;
  readonly hiddenBlockCount: number;
}

export interface WorkbenchConsensusSnapshot {
  readonly targetChapter: number;
  readonly currentState: string;
  readonly pendingHooks: string;
  readonly storyFrame: string;
  readonly volumeMap: string;
  readonly currentChapter: string;
  readonly actionHistory: ReadonlyArray<{
    readonly entryId: string;
    readonly itemId: string;
    readonly type: WorkbenchActionType;
    readonly title: string;
    readonly status: WorkbenchActionStatus;
    readonly payloadSummary: string;
  }>;
}

export interface WorkbenchChapterPrompt {
  readonly targetChapter: number;
  readonly prompt: string;
  readonly generatedAt: string;
}

export interface WorkbenchAdvisorContextRef {
  readonly file: string;
  readonly label: string;
  readonly excerpt: string;
}

export interface WorkbenchAdvisorMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly contextRefs?: ReadonlyArray<WorkbenchAdvisorContextRef>;
}

export interface WorkbenchAdvisorThread {
  readonly id: string;
  readonly bookId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: ReadonlyArray<WorkbenchAdvisorMessage>;
}

export interface WorkbenchBlock {
  readonly id: string;
  readonly kind: WorkbenchBlockKind;
  readonly title: string;
  readonly content: string;
  readonly confidence: number;
  readonly charCount: number;
}

export interface WorkbenchSettingCandidate {
  readonly id: string;
  readonly kind: WorkbenchBlockKind;
  readonly label: string;
  readonly targetFile: string;
  readonly content: string;
  readonly evidence: string;
}

export interface WorkbenchDraftCandidate {
  readonly title: string;
  readonly content: string;
  readonly sourceBlockIds: ReadonlyArray<string>;
}

export interface WorkbenchSettingChange {
  readonly id: string;
  readonly label: string;
  readonly targetFile: string;
  readonly content: string;
  readonly evidence: string;
  readonly status: "pending" | "accepted" | "rejected";
  readonly sourceBlockIds: ReadonlyArray<string>;
}

export interface WorkbenchGap {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly severity: "low" | "medium" | "high";
  readonly sourceBlockIds: ReadonlyArray<string>;
}

export interface WorkbenchRoundDigest {
  readonly status: WorkbenchDigestStatus;
  readonly updatedAt: string;
  readonly model?: string;
  readonly draftCandidate: WorkbenchDraftCandidate;
  readonly settingChanges: ReadonlyArray<WorkbenchSettingChange>;
  readonly gaps: ReadonlyArray<WorkbenchGap>;
  readonly nextPrompt: string;
  readonly rawBlockCount: number;
  readonly hiddenBlockCount: number;
}

export interface WorkbenchEntry {
  readonly id: string;
  readonly sourceName: string;
  readonly createdAt: string;
  readonly rawPath: string;
  readonly analysisPath: string;
  readonly rawCharCount: number;
  readonly rawText: string;
  readonly blocks: ReadonlyArray<WorkbenchBlock>;
  readonly settingCandidates: ReadonlyArray<WorkbenchSettingCandidate>;
  readonly digest: WorkbenchRoundDigest;
  readonly actionPlan: WorkbenchActionPlan;
}

export interface WorkbenchEntrySummary {
  readonly id: string;
  readonly sourceName: string;
  readonly createdAt: string;
  readonly rawPath: string;
  readonly rawCharCount: number;
  readonly blockCount: number;
  readonly status: WorkbenchDigestStatus;
  readonly kinds: ReadonlyArray<WorkbenchBlockKind>;
  readonly preview: string;
}

export interface WorkbenchState {
  readonly bookDir: (bookId: string) => string;
  readonly loadBookConfig: (bookId: string) => Promise<{ readonly language?: "zh" | "en" }>;
  readonly loadChapterIndex: (bookId: string) => Promise<ReadonlyArray<ChapterMeta>>;
  readonly saveChapterIndex: (bookId: string, index: ReadonlyArray<ChapterMeta>) => Promise<void>;
  readonly getNextChapterNumber: (bookId: string) => Promise<number>;
}

export class WorkbenchError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkbenchError";
  }
}

export async function createWorkbenchPaste(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly text: string;
  readonly sourceName?: string;
  readonly now?: Date;
}): Promise<WorkbenchEntry> {
  const text = params.text.trim();
  if (!text) {
    throw new WorkbenchError(400, "text is required");
  }

  const bookDir = params.state.bookDir(params.bookId);
  const inboxDir = join(bookDir, "inbox");
  const workspaceDir = join(bookDir, "workspace");
  await Promise.all([
    mkdir(inboxDir, { recursive: true }),
    mkdir(workspaceDir, { recursive: true }),
    mkdir(join(workspaceDir, "materials"), { recursive: true }),
    mkdir(join(bookDir, "notes"), { recursive: true }),
    mkdir(join(bookDir, "prompts"), { recursive: true }),
    mkdir(join(bookDir, "versions"), { recursive: true }),
  ]);

  const createdAt = (params.now ?? new Date()).toISOString();
  const id = `${formatTimestampForFile(createdAt)}-${randomUUID().slice(0, 8)}`;
  const sourceName = normalizeSourceName(params.sourceName);
  const rawPath = join(inboxDir, `${id}.md`);
  const analysisPath = join(workspaceDir, `${id}.json`);
  const blocks = analyzeWorkbenchText(text);
  const settingCandidates = deriveSettingCandidates(blocks);
  const digest = buildFallbackWorkbenchDigest({
    blocks,
    settingCandidates,
    rawText: text,
    status: "raw_saved",
    updatedAt: createdAt,
  });
  const actionPlan = actionPlanFromDigest({
    digest,
    targetChapter: await resolveTargetChapter(params.state, params.bookId),
    updatedAt: createdAt,
  });

  const entry: WorkbenchEntry = {
    id,
    sourceName,
    createdAt,
    rawPath: toBookRelativePath(bookDir, rawPath),
    analysisPath: toBookRelativePath(bookDir, analysisPath),
    rawCharCount: text.length,
    rawText: text,
    blocks,
    settingCandidates,
    digest,
    actionPlan,
  };

  await Promise.all([
    writeFile(rawPath, renderRawPasteMarkdown({ sourceName, createdAt, text }), "utf-8"),
    writeFile(analysisPath, JSON.stringify(entry, null, 2), "utf-8"),
  ]);

  return entry;
}

export async function listWorkbenchEntries(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
}): Promise<ReadonlyArray<WorkbenchEntrySummary>> {
  const bookDir = params.state.bookDir(params.bookId);
  const workspaceDir = join(bookDir, "workspace");
  const files = await readdir(workspaceDir).catch(() => []);
  const entries = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => loadWorkbenchEntryFile(join(workspaceDir, file)).catch(() => null)),
  );

  return entries
    .filter((entry): entry is WorkbenchEntry => entry !== null)
    .map((entry) => summarizeWorkbenchEntry(entry))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadWorkbenchEntry(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly entryId: string;
}): Promise<WorkbenchEntry> {
  assertSafeSegment(params.entryId, "entryId");
  const bookDir = params.state.bookDir(params.bookId);
  const entry = await loadWorkbenchEntryFile(join(bookDir, "workspace", `${params.entryId}.json`)).catch(() => null);
  if (!entry) {
    throw new WorkbenchError(404, "Workbench entry not found");
  }
  const rawText = await readRawPasteText(join(bookDir, entry.rawPath)).catch(() => entry.rawText);
  const settingCandidates = deriveSettingCandidates(entry.blocks);
  const digest = normalizeWorkbenchDigest(entry.digest, {
    blocks: entry.blocks,
    settingCandidates,
    rawText,
    updatedAt: entry.createdAt,
  });
  return {
    ...entry,
    rawText,
    settingCandidates,
    digest,
    actionPlan: normalizeWorkbenchActionPlan(entry.actionPlan, {
      digest,
      blocks: entry.blocks,
      targetChapter: await resolveTargetChapter(params.state, params.bookId),
      updatedAt: entry.createdAt,
    }),
  };
}

export async function updateWorkbenchEntryDigest(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly entryId: string;
  readonly digest: unknown;
}): Promise<WorkbenchEntry> {
  const current = await loadWorkbenchEntry(params);
  const updatedAt = new Date().toISOString();
  const digest = normalizeWorkbenchDigest(params.digest, {
    blocks: current.blocks,
    settingCandidates: current.settingCandidates,
    rawText: current.rawText,
    updatedAt,
  });
  return writeWorkbenchEntry({
    state: params.state,
    bookId: params.bookId,
    entry: {
      ...current,
      digest: {
        ...digest,
        updatedAt,
      },
      actionPlan: actionPlanFromDigest({
        digest: {
          ...digest,
          updatedAt,
        },
        targetChapter: current.actionPlan.targetChapter,
        updatedAt,
      }),
    },
  });
}

export async function updateWorkbenchEntryActionPlan(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly entryId: string;
  readonly actionPlan: unknown;
}): Promise<WorkbenchEntry> {
  const current = await loadWorkbenchEntry(params);
  const updatedAt = new Date().toISOString();
  const actionPlan = normalizeWorkbenchActionPlan(params.actionPlan, {
    digest: current.digest,
    blocks: current.blocks,
    targetChapter: current.actionPlan.targetChapter,
    updatedAt,
  });
  return writeWorkbenchEntry({
    state: params.state,
    bookId: params.bookId,
    entry: {
      ...current,
      actionPlan: {
        ...actionPlan,
        updatedAt,
      },
      digest: {
        ...current.digest,
        status: actionPlan.status,
        updatedAt,
        nextPrompt: actionPlan.nextPrompt,
      },
    },
  });
}

export async function loadLatestWorkbenchAdvisorThread(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
}): Promise<WorkbenchAdvisorThread | null> {
  const path = advisorThreadPath(params.state.bookDir(params.bookId));
  const raw = await readFile(path, "utf-8").catch(() => "");
  return raw ? normalizeAdvisorThread(JSON.parse(raw) as unknown, params.bookId) : null;
}

export async function saveWorkbenchAdvisorUserMessage(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly threadId?: string;
  readonly message: string;
  readonly now?: Date;
}): Promise<WorkbenchAdvisorThread> {
  const content = normalizeLongText(params.message, "", 12_000);
  if (!content.trim()) {
    throw new WorkbenchError(400, "message is required");
  }
  const existing = params.threadId
    ? await loadWorkbenchAdvisorThread({ state: params.state, bookId: params.bookId, threadId: params.threadId }).catch(() => null)
    : await loadLatestWorkbenchAdvisorThread({ state: params.state, bookId: params.bookId });
  const now = (params.now ?? new Date()).toISOString();
  const thread = existing ?? {
    id: `advisor-${formatTimestampForFile(now)}-${randomUUID().slice(0, 8)}`,
    bookId: params.bookId,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  return writeWorkbenchAdvisorThread({
    state: params.state,
    bookId: params.bookId,
    thread: {
      ...thread,
      updatedAt: now,
      messages: [
        ...thread.messages,
        {
          id: `msg-${formatTimestampForFile(now)}-${randomUUID().slice(0, 6)}`,
          role: "user",
          content,
          createdAt: now,
        },
      ],
    },
  });
}

export async function appendWorkbenchAdvisorAssistantMessage(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly threadId: string;
  readonly content: string;
  readonly contextRefs: ReadonlyArray<WorkbenchAdvisorContextRef>;
  readonly now?: Date;
}): Promise<WorkbenchAdvisorThread> {
  const thread = await loadWorkbenchAdvisorThread({ state: params.state, bookId: params.bookId, threadId: params.threadId });
  const now = (params.now ?? new Date()).toISOString();
  return writeWorkbenchAdvisorThread({
    state: params.state,
    bookId: params.bookId,
    thread: {
      ...thread,
      updatedAt: now,
      messages: [
        ...thread.messages,
        {
          id: `msg-${formatTimestampForFile(now)}-${randomUUID().slice(0, 6)}`,
          role: "assistant",
          content: normalizeLongText(params.content, "", 30_000),
          createdAt: now,
          contextRefs: normalizeContextRefs(params.contextRefs),
        },
      ],
    },
  });
}

export function buildWorkbenchAdvisorMessages(params: {
  readonly bookId: string;
  readonly thread: WorkbenchAdvisorThread;
  readonly snapshot: WorkbenchConsensusSnapshot;
}): Array<{ readonly role: "system" | "user"; readonly content: string }> {
  const recentMessages = params.thread.messages.slice(-10).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  return [
    {
      role: "system",
      content: [
        "你是小说书内创作顾问，只负责和作者讨论设定、剧情、章节问题，不自动改文件。",
        "你必须先对照当前上下文再回答，不能只凭作者一句话下结论。",
        "回复必须使用以下五个小标题：我查到的上下文、我的判断、建议方案、可能影响、是否整理成待确认修改。",
        "不要输出 JSON。不要写正文。不要把建议当成既定事实。需要写入文件的内容只能建议整理成待确认修改。",
        "如果作者提出纠偏，优先区分：已有共识、作者新决定、可能冲突、建议方案。",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        bookId: params.bookId,
        targetChapter: params.snapshot.targetChapter,
        requiredHeadings: ["我查到的上下文", "我的判断", "建议方案", "可能影响", "是否整理成待确认修改"],
        consensusSnapshot: {
          currentState: params.snapshot.currentState,
          pendingHooks: params.snapshot.pendingHooks,
          storyFrame: params.snapshot.storyFrame,
          volumeMap: params.snapshot.volumeMap,
          currentChapter: params.snapshot.currentChapter,
          actionHistory: params.snapshot.actionHistory.slice(-20),
        },
        recentConversation: recentMessages,
      }),
    },
  ];
}

export function buildWorkbenchAdvisorActionPlanMessages(params: {
  readonly bookId: string;
  readonly thread: WorkbenchAdvisorThread;
  readonly snapshot: WorkbenchConsensusSnapshot;
}): Array<{ readonly role: "system" | "user"; readonly content: string }> {
  return [
    {
      role: "system",
      content: [
        "你是小说工作台的顾问对话整理器。你只把最近顾问对话整理成待确认行动单。",
        "必须输出严格 JSON，不要 Markdown，不要代码块。",
        "行动项只允许 draft、setting、decision、prompt。",
        "setting 只能放作者确认后可写入权威文件的设定变更；必须写 targetFile 和 content。",
        "decision 只在需要作者拍板时出现；payload 必须包含 subject、currentConsensus、newContent、reason、options。",
        "prompt 用于给 Gemini 的下一轮追问或重写指令。",
        "如果只是讨论，没有明确可修改内容，items 可以为空。",
        "不要自动把建议当事实；所有 items 默认 status=pending。",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        bookId: params.bookId,
        targetChapter: params.snapshot.targetChapter,
        requiredShape: {
          status: "organized",
          targetChapter: params.snapshot.targetChapter,
          summary: "一句话说明这次顾问对话整理出的待确认修改",
          items: [{
            id: "advisor-action-01",
            type: "setting | decision | prompt | draft",
            title: "行动项标题",
            sourceEvidence: "来自顾问对话或上下文的依据",
            status: "pending",
            payload: {
              content: "设定/正文/提示词内容",
              targetFile: "story/current_state.md | story/pending_hooks.md | story/outline/story_frame.md | story/outline/volume_map.md",
              subject: "decision 才需要：冲突主题",
              currentConsensus: "decision 才需要：当前共识",
              newContent: "decision 才需要：新内容",
              reason: "decision 才需要：为什么必须拍板",
              options: ["keep_current", "adopt_new", "manual", "defer"],
            },
          }],
          nextPrompt: "如需继续问 Gemini，给出提示词；否则空字符串",
          rawBlockCount: 0,
          hiddenBlockCount: 0,
        },
        consensusSnapshot: params.snapshot,
        advisorMessages: params.thread.messages.slice(-12).map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
    },
  ];
}

export function parseWorkbenchAdvisorActionPlanResponse(params: {
  readonly responseText: string;
  readonly model?: string;
  readonly thread: WorkbenchAdvisorThread;
  readonly targetChapter: number;
}): WorkbenchActionPlan {
  const syntheticEntry = advisorThreadToSyntheticEntry(params.thread, params.targetChapter);
  return parseWorkbenchActionPlanResponse({
    responseText: params.responseText,
    model: params.model,
    entry: syntheticEntry,
    targetChapter: params.targetChapter,
  });
}

export async function createWorkbenchEntryFromAdvisorPlan(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly thread: WorkbenchAdvisorThread;
  readonly actionPlan: WorkbenchActionPlan;
  readonly now?: Date;
}): Promise<WorkbenchEntry> {
  const now = (params.now ?? new Date()).toISOString();
  const text = renderAdvisorThreadText(params.thread);
  const entry = advisorThreadToSyntheticEntry(params.thread, params.actionPlan.targetChapter, now, text);
  return writeWorkbenchEntry({
    state: params.state,
    bookId: params.bookId,
    entry: {
      ...entry,
      actionPlan: {
        ...params.actionPlan,
        updatedAt: now,
      },
      digest: {
        ...entry.digest,
        status: params.actionPlan.status,
        updatedAt: now,
        nextPrompt: params.actionPlan.nextPrompt,
      },
    },
  });
}

export function buildWorkbenchOrganizeMessages(params: {
  readonly bookId: string;
  readonly entry: WorkbenchEntry;
  readonly snapshot: WorkbenchConsensusSnapshot;
}): Array<{ readonly role: "system" | "user"; readonly content: string }> {
  return [
    {
      role: "system",
      content: [
        "你是小说创作工作台的行动单整理器。你只负责把用户从 Gemini 官网粘贴的内容，对照当前共识，整理成一张少量可执行行动单。",
        "必须输出严格 JSON，不要 Markdown，不要代码块。",
        "不要输出 blocks、tabs、三栏整理、泛化缺口。只输出 actionPlan。",
        "行动项只允许四类：draft、setting、decision、prompt。",
        "draft 只能放可以直接应用到当前章节编辑器的正文或改写稿；设定、人物、时间线、建议和章纲不能塞进 draft。",
        "setting 只能放可由作者确认后写入权威文件的设定变更；必须写 targetFile 和 content。",
        "decision 只在“当前共识 vs Gemini 新内容”需要用户拍板时出现；payload 必须包含 subject、currentConsensus、newContent、reason、options。",
        "剧情事件、章纲摘要、行动链、普通建议本身不是 decision。只有设定矛盾、时间线冲突、人物动机站不住、目标不清、因果断裂、必须二选一时才生成 decision。",
        "prompt 是下一轮发给 Gemini 的追问或重写指令。",
        "没有需要拍板的问题就不要硬造 decision；items 可以为空。",
        "所有事实必须来自 rawText 或 consensusSnapshot。你可以建议，但建议必须作为 setting/prompt/decision 的待确认内容。",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        bookId: params.bookId,
        targetChapter: params.snapshot.targetChapter,
        requiredShape: {
          status: "organized",
          targetChapter: params.snapshot.targetChapter,
          summary: "本轮一句话说明，只讲作者下一步要处理什么",
          items: [{
            id: "action-01",
            type: "draft | setting | decision | prompt",
            title: "行动项标题",
            sourceEvidence: "来自 Gemini 原文的证据或摘要",
            status: "pending",
            payload: {
              content: "正文/设定/提示词内容",
              targetFile: "story/current_state.md | story/pending_hooks.md | story/outline/story_frame.md | story/outline/volume_map.md",
              subject: "decision 才需要：冲突主题",
              currentConsensus: "decision 才需要：当前共识原文或摘要",
              newContent: "decision 才需要：Gemini 新内容",
              reason: "decision 才需要：为什么必须拍板",
              options: ["keep_current", "adopt_new", "manual", "defer"],
            },
          }],
          nextPrompt: "整合本轮待追问事项后，发给 Gemini 的提示词",
          rawBlockCount: params.entry.blocks.length,
          hiddenBlockCount: 0,
        },
        consensusSnapshot: params.snapshot,
        rawText: params.entry.rawText,
        blocks: params.entry.blocks.map((block) => ({
          id: block.id,
          kind: block.kind,
          title: block.title,
          content: block.content,
        })),
      }),
    },
  ];
}

export async function buildWorkbenchConsensusSnapshot(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly entryId?: string;
  readonly targetChapter?: number;
}): Promise<WorkbenchConsensusSnapshot> {
  const bookDir = params.state.bookDir(params.bookId);
  const targetChapter = Number.isInteger(params.targetChapter) && (params.targetChapter ?? 0) > 0
    ? params.targetChapter as number
    : await resolveTargetChapter(params.state, params.bookId);
  const [currentState, pendingHooks, storyFrame, volumeMap, currentChapter, actionHistory] = await Promise.all([
    readOptionalText(join(bookDir, "story", "current_state.md")),
    readOptionalText(join(bookDir, "story", "pending_hooks.md")),
    readOptionalText(join(bookDir, "story", "outline", "story_frame.md")),
    readOptionalText(join(bookDir, "story", "outline", "volume_map.md")),
    readCurrentChapterText(bookDir, targetChapter),
    loadWorkbenchActionHistory(bookDir, params.entryId),
  ]);
  return {
    targetChapter,
    currentState: currentState.slice(0, 12_000),
    pendingHooks: pendingHooks.slice(0, 8_000),
    storyFrame: storyFrame.slice(0, 12_000),
    volumeMap: volumeMap.slice(0, 12_000),
    currentChapter: currentChapter.slice(0, 20_000),
    actionHistory,
  };
}

export async function buildWorkbenchChapterPrompt(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly draftTitle?: string;
  readonly draftContent?: string;
  readonly instruction?: string;
}): Promise<WorkbenchChapterPrompt> {
  const targetChapter = Number.isInteger(params.chapterNumber) && (params.chapterNumber ?? 0) > 0
    ? params.chapterNumber as number
    : undefined;
  const snapshot = await buildWorkbenchConsensusSnapshot({
    state: params.state,
    bookId: params.bookId,
    targetChapter,
  });
  const prompt = renderWorkbenchChapterPrompt({
    bookId: params.bookId,
    snapshot,
    draftTitle: params.draftTitle,
    draftContent: params.draftContent,
    instruction: params.instruction,
  });
  return {
    targetChapter: snapshot.targetChapter,
    prompt,
    generatedAt: new Date().toISOString(),
  };
}

function renderWorkbenchChapterPrompt(params: {
  readonly bookId: string;
  readonly snapshot: WorkbenchConsensusSnapshot;
  readonly draftTitle?: string;
  readonly draftContent?: string;
  readonly instruction?: string;
}): string {
  const title = normalizeShortText(params.draftTitle, `第 ${params.snapshot.targetChapter} 章`, 120);
  const draft = normalizeLongText(params.draftContent, params.snapshot.currentChapter, 4_000);
  const chapterBrief = extractChapterBrief(params.snapshot, title);
  const coreSettings = extractPromptBullets(
    [params.snapshot.currentState, params.snapshot.storyFrame],
    [
      /主角/u,
      /当前处境|当前状态|主角当前状态/u,
      /阶段目标|第一卷显性目标/u,
      /失败代价|非做不可|阶段压力/u,
      /阻力|敌人|对立势力/u,
      /开头切入/u,
      /核心前提|第一卷核心|第一卷卖点|核心卖点|卷围绕/u,
      /文风|节奏|必须避免|禁忌/u,
    ],
    10,
  );
  return [
    `请为我生成《${extractBookTitle(params.snapshot.currentState) || cleanBookTitle(params.bookId)}》第 ${params.snapshot.targetChapter} 章正文。`,
    "",
    "你要做的是写本章正文，不是讨论方案，也不是输出大纲。",
    "",
    "## 本章标题",
    title,
    "",
    "## 本章任务",
    chapterBrief || "从当前危机切入，写出本章明确目标、阻力升级、主角应对和章末钩子。",
    "",
    "## 必须遵守的设定",
    coreSettings.length ? coreSettings.map((line) => `- ${line}`).join("\n") : "- 按当前已确认设定推进，不擅自改主线硬设定。",
    "",
    "## 已有草稿",
    draft || "暂无草稿，请直接从本章任务开始写。",
    "",
    "## 额外要求",
    normalizeLongText(params.instruction, "", 4_000) || "按当前共识推进本章，不要擅自新增会改变主线的硬设定。",
    "",
    "## 输出要求",
    `- 只输出第 ${params.snapshot.targetChapter} 章正文。`,
    "- 开头直接进入正文，不要解释你怎么写。",
    "- 字数按网文单章节奏展开，优先写场景、动作、对话和心理压力。",
    "- 保持长篇网文节奏：目标明确、冲突推进、场景有压力、章末留可追的钩子。",
    "- 不要擅自改已确认设定；如果你发现设定矛盾，把矛盾写在正文后面的“待作者确认”里，不要写成既定事实。",
    "- 不要复述资料，不要输出设定说明，不要输出分析。",
  ].join("\n");
}

function extractChapterBrief(snapshot: WorkbenchConsensusSnapshot, title: string): string {
  const sources = [snapshot.pendingHooks, snapshot.volumeMap, snapshot.currentState, snapshot.storyFrame];
  const chapterPattern = new RegExp(`第\\s*${snapshot.targetChapter}\\s*章[^\\n]*`, "u");
  for (const source of sources) {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const start = lines.findIndex((line) =>
      chapterPattern.test(line)
      || (title.trim() && line.includes(title.trim())),
    );
    if (start === -1) continue;
    const picked = lines
      .slice(start, start + 16)
      .map((line) => line.trim())
      .filter(Boolean);
    const cleaned = stopAtNextChapter(picked, snapshot.targetChapter).join("\n");
    if (cleaned.trim()) return cleaned.slice(0, 1_500);
  }
  return "";
}

function stopAtNextChapter(lines: string[], chapterNumber: number): string[] {
  const result: string[] = [];
  const nextChapterPattern = new RegExp(`^#{0,4}\\s*第\\s*(?!${chapterNumber}\\s*章)[零〇一二三四五六七八九十百千万\\d]+\\s*章`, "u");
  for (const line of lines) {
    if (result.length > 0 && nextChapterPattern.test(line)) break;
    if (shouldSkipPromptLine(line)) continue;
    result.push(stripMarkdownBullet(line));
  }
  return result.slice(0, 10);
}

function extractPromptBullets(
  sources: ReadonlyArray<string>,
  patterns: ReadonlyArray<RegExp>,
  limit: number,
): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const source of sources) {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    for (const line of lines) {
      const cleaned = stripMarkdownBullet(line.trim());
      if (!cleaned || shouldSkipPromptLine(cleaned) || cleaned.length > 220) continue;
      if (!patterns.some((pattern) => pattern.test(cleaned))) continue;
      const normalized = cleaned.replace(/\s+/g, " ");
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      results.push(normalized);
      if (results.length >= limit) return results;
    }
  }
  return results;
}

function stripMarkdownBullet(line: string): string {
  return line
    .replace(/^#{1,6}\s*/u, "")
    .replace(/^[-*]\s*/u, "")
    .trim();
}

function shouldSkipPromptLine(line: string): boolean {
  return !line
    || /^>/.test(line)
    || /工作台确认|已接受候选|第一卷启动稿|后续追问|发给 Gemini 的提示词|最近已确认|已拒绝|已搁置|平台：qidian/u.test(line);
}

function cleanBookTitle(bookId: string): string {
  const title = bookId
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title || bookId;
}

function extractBookTitle(source: string): string {
  return source.match(/作品：?《([^》]+)》/u)?.[1]?.trim()
    || source.match(/书名：?《([^》]+)》/u)?.[1]?.trim()
    || "";
}

export function parseWorkbenchActionPlanResponse(params: {
  readonly responseText: string;
  readonly model?: string;
  readonly entry: WorkbenchEntry;
  readonly targetChapter: number;
}): WorkbenchActionPlan {
  const parsed = parseStrictJsonObject(params.responseText);
  const updatedAt = new Date().toISOString();
  const input = isRecord(parsed.actionPlan) ? parsed.actionPlan : parsed;
  return normalizeWorkbenchActionPlan({
    ...input,
    status: "organized",
    updatedAt,
    model: params.model,
    targetChapter: params.targetChapter,
    rawBlockCount: params.entry.blocks.length,
    hiddenBlockCount: Math.max(0, params.entry.blocks.length - visibleActionItemCount(input)),
  }, {
    digest: params.entry.digest,
    blocks: params.entry.blocks,
    targetChapter: params.targetChapter,
    updatedAt,
  });
}

export function parseWorkbenchDigestResponse(params: {
  readonly responseText: string;
  readonly model?: string;
  readonly entry: WorkbenchEntry;
}): WorkbenchRoundDigest {
  const parsed = parseStrictJsonObject(params.responseText);
  const updatedAt = new Date().toISOString();
  return normalizeWorkbenchDigest({
    ...parsed,
    status: "organized",
    updatedAt,
    model: params.model,
    rawBlockCount: params.entry.blocks.length,
    hiddenBlockCount: Math.max(0, params.entry.blocks.length - visibleDigestItemCount(parsed)),
  }, {
    blocks: params.entry.blocks,
    settingCandidates: params.entry.settingCandidates,
    rawText: params.entry.rawText,
    updatedAt,
  });
}

export async function archiveWorkbenchEntry(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly entryId: string;
}): Promise<WorkbenchEntry> {
  const current = await loadWorkbenchEntry(params);
  return writeWorkbenchEntry({
    state: params.state,
    bookId: params.bookId,
    entry: {
      ...current,
      digest: {
        ...current.digest,
        status: "archived",
        updatedAt: new Date().toISOString(),
      },
      actionPlan: {
        ...current.actionPlan,
        status: "archived",
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

export async function applyWorkbenchAction(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly entryId: string;
  readonly actionId: string;
  readonly operation: "accept" | "reject" | "defer" | "keep_current" | "adopt_new" | "manual";
  readonly content?: string;
  readonly targetFile?: string;
  readonly title?: string;
  readonly prompt?: string;
}): Promise<{
  readonly entry: WorkbenchEntry;
  readonly result: {
    readonly ok: true;
    readonly actionId: string;
    readonly operation: string;
    readonly wroteFile?: string;
  };
}> {
  assertSafeSegment(params.entryId, "entryId");
  assertSafeSegment(params.actionId, "actionId");
  const current = await loadWorkbenchEntry(params);
  const action = current.actionPlan.items.find((item) => item.id === params.actionId);
  if (!action) {
    throw new WorkbenchError(404, "Workbench action not found");
  }

  const nextStatus = statusForActionOperation(params.operation);
  const now = new Date().toISOString();
  let wroteFile: string | undefined;
  let nextPayload: Record<string, unknown> = {
    ...action.payload,
    ...(params.prompt !== undefined ? { generatedPrompt: params.prompt } : {}),
  };

  if (params.operation === "accept" && action.type === "setting") {
    const targetFile = normalizeSettingTargetFile(params.targetFile ?? stringFromPayload(action.payload, "targetFile"));
    const content = normalizeLongText(params.content, stringFromPayload(action.payload, "content") ?? "", 20_000);
    if (!content.trim()) {
      throw new WorkbenchError(400, "content is required");
    }
    const result = await appendSelectionToSettingFile({
      state: params.state,
      bookId: params.bookId,
      target: "setting",
      title: params.title ?? action.title,
      kind: "world",
      sourceEntryId: params.entryId,
      settingTargetFile: targetFile,
    }, content);
    wroteFile = result.path;
    nextPayload = {
      ...nextPayload,
      content,
      targetFile,
      appliedAt: now,
      appliedPath: result.path,
    };
  }

  if ((params.operation === "adopt_new" || params.operation === "manual") && action.type === "decision") {
    const targetFile = normalizeSettingTargetFile(params.targetFile ?? stringFromPayload(action.payload, "targetFile"));
    const content = normalizeLongText(
      params.content,
      params.operation === "manual"
        ? stringFromPayload(action.payload, "manualContent") ?? ""
        : stringFromPayload(action.payload, "newContent") ?? "",
      20_000,
    );
    if (!content.trim()) {
      throw new WorkbenchError(400, "content is required");
    }
    const result = await appendSelectionToSettingFile({
      state: params.state,
      bookId: params.bookId,
      target: "setting",
      title: params.title ?? action.title,
      kind: "revision",
      sourceEntryId: params.entryId,
      settingTargetFile: targetFile,
    }, renderDecisionApplication({
      action,
      operation: params.operation,
      content,
    }));
    wroteFile = result.path;
    nextPayload = {
      ...nextPayload,
      selectedOption: params.operation,
      content,
      targetFile,
      appliedAt: now,
      appliedPath: result.path,
    };
  } else if ((params.operation === "keep_current" || params.operation === "defer") && action.type === "decision") {
    nextPayload = {
      ...nextPayload,
      selectedOption: params.operation,
      decidedAt: now,
    };
  }

  const updatedPlan: WorkbenchActionPlan = {
    ...current.actionPlan,
    status: nextStatus === "accepted" ? "applied" : current.actionPlan.status,
    updatedAt: now,
    items: current.actionPlan.items.map((item) =>
      item.id === action.id
        ? {
            ...item,
            status: nextStatus,
            payload: nextPayload,
          }
        : item,
    ),
    nextPrompt: params.prompt ?? current.actionPlan.nextPrompt,
  };

  const entry = await writeWorkbenchEntry({
    state: params.state,
    bookId: params.bookId,
    entry: {
      ...current,
      actionPlan: updatedPlan,
      digest: {
        ...current.digest,
        status: updatedPlan.status,
        updatedAt: now,
        nextPrompt: updatedPlan.nextPrompt,
      },
    },
  });

  return {
    entry,
    result: {
      ok: true,
      actionId: params.actionId,
      operation: params.operation,
      ...(wroteFile ? { wroteFile } : {}),
    },
  };
}

async function writeWorkbenchEntry(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly entry: WorkbenchEntry;
}): Promise<WorkbenchEntry> {
  assertSafeSegment(params.entry.id, "entryId");
  const bookDir = params.state.bookDir(params.bookId);
  const analysisPath = join(bookDir, "workspace", `${params.entry.id}.json`);
  const rawPath = join(bookDir, params.entry.rawPath);
  await mkdir(dirname(rawPath), { recursive: true });
  await writeFile(rawPath, renderRawPasteMarkdown({
    sourceName: params.entry.sourceName,
    createdAt: params.entry.createdAt,
    text: params.entry.rawText,
  }), "utf-8");
  await writeFile(analysisPath, JSON.stringify(params.entry, null, 2), "utf-8");
  return loadWorkbenchEntry({
    state: params.state,
    bookId: params.bookId,
    entryId: params.entry.id,
  });
}

async function loadWorkbenchAdvisorThread(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly threadId: string;
}): Promise<WorkbenchAdvisorThread> {
  assertSafeSegment(params.threadId, "threadId");
  const latest = await loadLatestWorkbenchAdvisorThread(params);
  if (!latest || latest.id !== params.threadId) {
    throw new WorkbenchError(404, "Workbench advisor thread not found");
  }
  return latest;
}

async function writeWorkbenchAdvisorThread(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly thread: WorkbenchAdvisorThread;
}): Promise<WorkbenchAdvisorThread> {
  assertSafeSegment(params.thread.id, "threadId");
  const bookDir = params.state.bookDir(params.bookId);
  const path = advisorThreadPath(bookDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(params.thread, null, 2), "utf-8");
  return normalizeAdvisorThread(JSON.parse(await readFile(path, "utf-8")) as unknown, params.bookId);
}

function advisorThreadPath(bookDir: string): string {
  return join(bookDir, "workspace", "advisor", "latest.json");
}

function normalizeAdvisorThread(input: unknown, bookId: string): WorkbenchAdvisorThread {
  const record = isRecord(input) ? input : {};
  const createdAt = normalizeShortText(record.createdAt, new Date().toISOString(), 80);
  return {
    id: normalizeActionId(record.id, `advisor-${formatTimestampForFile(createdAt)}`),
    bookId,
    createdAt,
    updatedAt: normalizeShortText(record.updatedAt, createdAt, 80),
    messages: normalizeAdvisorMessages(record.messages),
  };
}

function normalizeAdvisorMessages(input: unknown): WorkbenchAdvisorMessage[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.slice(-80).map((item, index): WorkbenchAdvisorMessage => {
    const record = isRecord(item) ? item : {};
    const role: WorkbenchAdvisorMessage["role"] = record.role === "assistant" ? "assistant" : "user";
    const createdAt = normalizeShortText(record.createdAt, new Date().toISOString(), 80);
    return {
      id: normalizeActionId(record.id, `msg-${String(index + 1).padStart(2, "0")}`),
      role,
      content: normalizeLongText(record.content, "", 30_000),
      createdAt,
      ...(role === "assistant" ? { contextRefs: normalizeContextRefs(record.contextRefs) } : {}),
    };
  }).filter((message) => message.content.trim());
}

function normalizeContextRefs(input: unknown): WorkbenchAdvisorContextRef[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.slice(0, 12).map((item) => {
    const record = isRecord(item) ? item : {};
    return {
      file: normalizeShortText(record.file, "", 120),
      label: normalizeShortText(record.label, "", 120),
      excerpt: normalizeLongText(record.excerpt, "", 1_000),
    };
  }).filter((ref) => ref.file && ref.label);
}

export function buildAdvisorContextRefs(snapshot: WorkbenchConsensusSnapshot): WorkbenchAdvisorContextRef[] {
  return [
    {
      file: "story/current_state.md",
      label: "当前状态",
      excerpt: snapshot.currentState.slice(0, 800),
    },
    {
      file: "story/pending_hooks.md",
      label: "待回收悬念",
      excerpt: snapshot.pendingHooks.slice(0, 800),
    },
    {
      file: "story/outline/story_frame.md",
      label: "故事框架",
      excerpt: snapshot.storyFrame.slice(0, 800),
    },
    {
      file: "story/outline/volume_map.md",
      label: "第一卷卷纲",
      excerpt: snapshot.volumeMap.slice(0, 800),
    },
    {
      file: `chapters/${String(snapshot.targetChapter).padStart(4, "0")}_*.md`,
      label: `当前第 ${snapshot.targetChapter} 章`,
      excerpt: snapshot.currentChapter.slice(0, 800),
    },
    {
      file: "workspace/*.json",
      label: "最近工作台结论",
      excerpt: snapshot.actionHistory
        .slice(-8)
        .map((item) => `${item.status} / ${item.type} / ${item.title}${item.payloadSummary ? `：${item.payloadSummary}` : ""}`)
        .join("\n")
        .slice(0, 1_000),
    },
  ].filter((ref) => ref.excerpt.trim());
}

function renderAdvisorThreadText(thread: WorkbenchAdvisorThread): string {
  return thread.messages
    .map((message) => `## ${message.role === "user" ? "作者" : "DeepSeek 顾问"}\n\n${message.content.trim()}`)
    .join("\n\n")
    .trim();
}

function advisorThreadToSyntheticEntry(
  thread: WorkbenchAdvisorThread,
  targetChapter: number,
  now = new Date().toISOString(),
  text = renderAdvisorThreadText(thread),
): WorkbenchEntry {
  const id = `advisor-${formatTimestampForFile(now)}-${randomUUID().slice(0, 8)}`;
  const blocks = analyzeWorkbenchText(text || "顾问对话");
  const settingCandidates = deriveSettingCandidates(blocks);
  const digest = buildFallbackWorkbenchDigest({
    blocks,
    settingCandidates,
    rawText: text,
    status: "organized",
    updatedAt: now,
  });
  return {
    id,
    sourceName: "DeepSeek 顾问",
    createdAt: now,
    rawPath: `workspace/advisor/${thread.id}.md`,
    analysisPath: `workspace/${id}.json`,
    rawCharCount: text.length,
    rawText: text,
    blocks,
    settingCandidates,
    digest,
    actionPlan: {
      status: "organized",
      updatedAt: now,
      targetChapter,
      summary: "顾问对话整理出的待确认修改",
      items: [],
      nextPrompt: "",
      rawBlockCount: blocks.length,
      hiddenBlockCount: blocks.length,
    },
  };
}

export async function saveWorkbenchSelection(params: {
  readonly state: WorkbenchState;
  readonly bookId: string;
  readonly target: WorkbenchSaveTarget;
  readonly content: string;
  readonly title?: string;
  readonly kind?: WorkbenchBlockKind;
  readonly sourceEntryId?: string;
  readonly settingTargetFile?: string;
  readonly chapterNumber?: number;
}): Promise<{
  readonly ok: true;
  readonly target: WorkbenchSaveTarget;
  readonly path: string;
  readonly chapterNumber?: number;
  readonly title: string;
}> {
  const content = params.content.trim();
  if (!content) {
    throw new WorkbenchError(400, "content is required");
  }
  if (params.sourceEntryId) {
    assertSafeSegment(params.sourceEntryId, "sourceEntryId");
  }

  if (params.target === "chapter") {
    return saveSelectionAsChapter(params, content);
  }
  if (params.target === "setting") {
    return appendSelectionToSettingFile(params, content);
  }

  const bookDir = params.state.bookDir(params.bookId);
  const targetDir = targetDirectory(bookDir, params.target);
  await mkdir(targetDir, { recursive: true });

  const title = normalizeTitle(params.title, defaultTitleForTarget(params.target));
  const filename = `${formatTimestampForFile(new Date().toISOString())}_${sanitizeFilename(title)}.md`;
  const filePath = join(targetDir, filename);
  const header = renderSavedSelectionHeader({
    title,
    target: params.target,
    kind: params.kind,
    sourceEntryId: params.sourceEntryId,
  });
  await writeFile(filePath, `${header}${content.trimEnd()}\n`, "utf-8");

  return {
    ok: true,
    target: params.target,
    path: toBookRelativePath(bookDir, filePath),
    title,
  };
}

export function analyzeWorkbenchText(text: string): ReadonlyArray<WorkbenchBlock> {
  const cleaned = stripCommonChatChrome(text);
  const sections = splitIntoSections(cleaned);
  const rawBlocks = sections.length > 0 ? sections : [{ title: "粘贴内容", content: cleaned }];

  return rawBlocks.slice(0, 30).map((section, index) => {
    const kind = classifyBlock(section.title, section.content);
    return {
      id: `block-${String(index + 1).padStart(2, "0")}`,
      kind,
      title: section.title || defaultBlockTitle(kind, index + 1),
      content: section.content.trim(),
      confidence: confidenceForKind(kind, section.content),
      charCount: section.content.trim().length,
    };
  });
}

async function saveSelectionAsChapter(
  params: {
    readonly state: WorkbenchState;
    readonly bookId: string;
    readonly target: WorkbenchSaveTarget;
    readonly title?: string;
    readonly kind?: WorkbenchBlockKind;
    readonly sourceEntryId?: string;
    readonly chapterNumber?: number;
  },
  content: string,
): Promise<{
  readonly ok: true;
  readonly target: WorkbenchSaveTarget;
  readonly path: string;
  readonly chapterNumber: number;
  readonly title: string;
}> {
  const bookDir = params.state.bookDir(params.bookId);
  const chaptersDir = join(bookDir, "chapters");
  await mkdir(chaptersDir, { recursive: true });

  const book = await params.state.loadBookConfig(params.bookId).catch(() => ({ language: "zh" as const }));
  const explicitChapterNumber = normalizeOptionalChapterNumber(params.chapterNumber);
  const chapterNumber = explicitChapterNumber ?? await params.state.getNextChapterNumber(params.bookId);
  const existing = await params.state.loadChapterIndex(params.bookId);
  const existingMeta = existing.find((chapter) => chapter.number === chapterNumber);
  const title = normalizeTitle(params.title, extractTitleFromMarkdown(content) ?? existingMeta?.title ?? `粘贴章节 ${chapterNumber}`);
  const padded = String(chapterNumber).padStart(4, "0");
  const existingFilename = (await readdir(chaptersDir).catch(() => []))
    .find((file) => file.startsWith(`${padded}_`) && file.endsWith(".md"));
  const filePath = join(chaptersDir, existingFilename ?? `${padded}_${sanitizeFilename(title)}.md`);
  const chapterMarkdown = normalizeChapterMarkdown({
    content,
    title,
    chapterNumber,
    language: book.language ?? "zh",
  });
  await writeFile(filePath, chapterMarkdown, "utf-8");

  const now = new Date().toISOString();
  const entry: ChapterMeta = {
    number: chapterNumber,
    title,
    status: explicitChapterNumber ? "drafted" : "imported",
    wordCount: countTextUnits(content, book.language ?? "zh"),
    createdAt: existingMeta?.createdAt ?? now,
    updatedAt: now,
    auditIssues: explicitChapterNumber ? existingMeta?.auditIssues ?? [] : [],
    lengthWarnings: explicitChapterNumber ? existingMeta?.lengthWarnings ?? [] : [],
    reviewNote: params.sourceEntryId
      ? `${explicitChapterNumber ? "Saved" : "Imported"} from workbench entry ${params.sourceEntryId}.`
      : existingMeta?.reviewNote,
  };
  const updated = [
    ...existing.filter((chapter) => chapter.number !== chapterNumber),
    entry,
  ].sort((a, b) => a.number - b.number);
  await params.state.saveChapterIndex(params.bookId, updated);

  return {
    ok: true,
    target: "chapter",
    path: toBookRelativePath(bookDir, filePath),
    chapterNumber,
    title,
  };
}

function normalizeOptionalChapterNumber(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new WorkbenchError(400, "chapterNumber must be a positive integer");
  }
  return value;
}

async function appendSelectionToSettingFile(
  params: {
    readonly state: WorkbenchState;
    readonly bookId: string;
    readonly target: WorkbenchSaveTarget;
    readonly title?: string;
    readonly kind?: WorkbenchBlockKind;
    readonly sourceEntryId?: string;
    readonly settingTargetFile?: string;
  },
  content: string,
): Promise<{
  readonly ok: true;
  readonly target: WorkbenchSaveTarget;
  readonly path: string;
  readonly title: string;
}> {
  const bookDir = params.state.bookDir(params.bookId);
  const targetFile = normalizeSettingTargetFile(params.settingTargetFile);
  const filePath = join(bookDir, targetFile);
  await mkdir(dirname(filePath), { recursive: true });

  const title = normalizeTitle(params.title, "工作台设定确认");
  const now = new Date().toISOString();
  const section = [
    "",
    `## 工作台确认：${title}`,
    "",
    `> 时间：${now}`,
    `> 来源：创作工作台${params.sourceEntryId ? ` / ${params.sourceEntryId}` : ""}`,
    `> 类型：${params.kind ?? "setting"}`,
    "",
    content.trimEnd(),
    "",
  ].join("\n");
  await appendFile(filePath, section, "utf-8");

  return {
    ok: true,
    target: "setting",
    path: toBookRelativePath(bookDir, filePath),
    title,
  };
}

function normalizeSettingTargetFile(value: string | undefined): string {
  if (value === "story/pending_hooks.md") {
    return value;
  }
  if (value === "story/outline/story_frame.md") {
    return value;
  }
  if (value === "story/outline/volume_map.md") {
    return value;
  }
  return "story/current_state.md";
}

function normalizeDigestStatus(value: unknown, fallback: WorkbenchDigestStatus): WorkbenchDigestStatus {
  return value === "raw_saved"
    || value === "organized"
    || value === "applied"
    || value === "archived"
    ? value
    : fallback;
}

function normalizeSettingStatus(value: unknown, fallback: WorkbenchSettingChange["status"]): WorkbenchSettingChange["status"] {
  return value === "pending" || value === "accepted" || value === "rejected" ? value : fallback;
}

function normalizeGapSeverity(value: unknown, fallback: WorkbenchGap["severity"]): WorkbenchGap["severity"] {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function normalizeActionStatus(value: unknown, fallback: WorkbenchActionStatus): WorkbenchActionStatus {
  return value === "pending" || value === "accepted" || value === "rejected" || value === "deferred" ? value : fallback;
}

function normalizeActionType(value: unknown, fallback: WorkbenchActionType): WorkbenchActionType {
  return value === "draft" || value === "setting" || value === "decision" || value === "prompt" ? value : fallback;
}

function statusForActionOperation(operation: "accept" | "reject" | "defer" | "keep_current" | "adopt_new" | "manual"): WorkbenchActionStatus {
  if (operation === "reject" || operation === "keep_current") return "rejected";
  if (operation === "defer") return "deferred";
  return "accepted";
}

function normalizeShortText(value: unknown, fallback: string, limit: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, limit);
}

function normalizeLongText(value: unknown, fallback: string, limit: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, limit);
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseInt(value, 10)
      : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeStringArray(value: unknown, fallback: ReadonlyArray<string>, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [...fallback].slice(0, limit);
  }
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 120))
    .slice(0, limit);
}

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  return { ...value };
}

function stringFromPayload(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function loadWorkbenchEntryFile(path: string): Promise<WorkbenchEntry> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as WorkbenchEntry;
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
  const settingCandidates = Array.isArray(parsed.settingCandidates)
    ? parsed.settingCandidates
    : deriveSettingCandidates(blocks);
  const rawText = typeof parsed.rawText === "string" ? parsed.rawText : "";
  const digest = normalizeWorkbenchDigest(parsed.digest, {
    blocks,
    settingCandidates,
    rawText,
    updatedAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
  });
  return {
    ...parsed,
    rawText,
    blocks,
    settingCandidates,
    digest,
    actionPlan: normalizeWorkbenchActionPlan(parsed.actionPlan, {
      digest,
      blocks,
      targetChapter: 1,
      updatedAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
    }),
  };
}

async function readRawPasteText(path: string): Promise<string> {
  const raw = await readFile(path, "utf-8");
  return stripRawPasteFrontmatter(raw);
}

function stripRawPasteFrontmatter(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return normalized.trim();
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return normalized.trim();
  }
  return normalized.slice(end + "\n---\n".length).trim();
}

function summarizeWorkbenchEntry(entry: WorkbenchEntry): WorkbenchEntrySummary {
  return {
    id: entry.id,
    sourceName: entry.sourceName,
    createdAt: entry.createdAt,
    rawPath: entry.rawPath,
    rawCharCount: entry.rawCharCount,
    blockCount: entry.blocks.length,
    status: entry.actionPlan.status ?? entry.digest.status,
    kinds: [...new Set(entry.blocks.map((block) => block.kind))],
    preview: entry.actionPlan.summary.slice(0, 160)
      || entry.actionPlan.items[0]?.title.slice(0, 160)
      || entry.actionPlan.nextPrompt.slice(0, 160)
      || entry.digest.draftCandidate.content.slice(0, 160)
      || entry.digest.nextPrompt.slice(0, 160)
      || entry.blocks[0]?.content.slice(0, 160)
      || "",
  };
}

function normalizeWorkbenchDigest(
  input: unknown,
  fallback: {
    readonly blocks: ReadonlyArray<WorkbenchBlock>;
    readonly settingCandidates: ReadonlyArray<WorkbenchSettingCandidate>;
    readonly rawText: string;
    readonly updatedAt: string;
  },
): WorkbenchRoundDigest {
  const fallbackDigest = buildFallbackWorkbenchDigest({
    blocks: fallback.blocks,
    settingCandidates: fallback.settingCandidates,
    rawText: fallback.rawText,
    status: "raw_saved",
    updatedAt: fallback.updatedAt,
  });
  const record = isRecord(input) ? input : {};
  return {
    status: normalizeDigestStatus(record.status, fallbackDigest.status),
    updatedAt: normalizeShortText(record.updatedAt, fallbackDigest.updatedAt, 80),
    ...(typeof record.model === "string" && record.model.trim() ? { model: record.model.trim().slice(0, 120) } : {}),
    draftCandidate: normalizeDraftCandidate(record.draftCandidate, fallbackDigest.draftCandidate),
    settingChanges: normalizeSettingChanges(record.settingChanges, fallbackDigest.settingChanges),
    gaps: normalizeGaps(record.gaps, fallbackDigest.gaps),
    nextPrompt: normalizeLongText(record.nextPrompt, fallbackDigest.nextPrompt, 12_000),
    rawBlockCount: normalizeNonNegativeInt(record.rawBlockCount, fallbackDigest.rawBlockCount),
    hiddenBlockCount: normalizeNonNegativeInt(record.hiddenBlockCount, fallbackDigest.hiddenBlockCount),
  };
}

function normalizeWorkbenchActionPlan(
  input: unknown,
  fallback: {
    readonly digest: WorkbenchRoundDigest;
    readonly blocks: ReadonlyArray<WorkbenchBlock>;
    readonly targetChapter: number;
    readonly updatedAt: string;
  },
): WorkbenchActionPlan {
  const fallbackPlan = actionPlanFromDigest({
    digest: fallback.digest,
    targetChapter: fallback.targetChapter,
    updatedAt: fallback.updatedAt,
  });
  const record = isRecord(input) ? input : {};
  const items = normalizeActionItems(record.items, fallbackPlan.items);
  return {
    status: normalizeDigestStatus(record.status, fallbackPlan.status),
    updatedAt: normalizeShortText(record.updatedAt, fallbackPlan.updatedAt, 80),
    ...(typeof record.model === "string" && record.model.trim() ? { model: record.model.trim().slice(0, 120) } : {}),
    targetChapter: normalizePositiveInt(record.targetChapter, fallbackPlan.targetChapter),
    summary: normalizeLongText(record.summary, fallbackPlan.summary, 1_000),
    items,
    nextPrompt: normalizeLongText(record.nextPrompt, fallbackPlan.nextPrompt, 20_000),
    rawBlockCount: normalizeNonNegativeInt(record.rawBlockCount, fallback.blocks.length),
    hiddenBlockCount: normalizeNonNegativeInt(record.hiddenBlockCount, Math.max(0, fallback.blocks.length - items.length)),
  };
}

function normalizeActionItems(input: unknown, fallback: ReadonlyArray<WorkbenchActionItem>): WorkbenchActionItem[] {
  if (!Array.isArray(input)) {
    return [...fallback];
  }
  return input.slice(0, 20).map((item, index) => {
    const record = isRecord(item) ? item : {};
    const fallbackItem = fallback[index];
    const type = normalizeActionType(record.type, fallbackItem?.type ?? "prompt");
    const payload = normalizePayload(record.payload);
    return {
      id: normalizeActionId(record.id, fallbackItem?.id ?? `action-${String(index + 1).padStart(2, "0")}`),
      type,
      title: normalizeShortText(record.title, fallbackItem?.title ?? labelForActionType(type), 120),
      sourceEvidence: normalizeLongText(record.sourceEvidence, fallbackItem?.sourceEvidence ?? "", 2_000),
      status: normalizeActionStatus(record.status, fallbackItem?.status ?? "pending"),
      payload: normalizeActionPayload(type, payload, fallbackItem?.payload ?? {}),
    };
  }).filter((item) => shouldKeepActionItem(item));
}

function normalizeActionPayload(
  type: WorkbenchActionType,
  payload: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const base = { ...fallback, ...payload };
  if (type === "setting") {
    return {
      ...base,
      targetFile: normalizeSettingTargetFile(typeof base.targetFile === "string" ? base.targetFile : undefined),
      content: normalizeLongText(base.content, "", 20_000),
    };
  }
  if (type === "draft") {
    return {
      ...base,
      content: normalizeLongText(base.content, "", 80_000),
      targetChapter: normalizePositiveInt(base.targetChapter, 1),
    };
  }
  if (type === "decision") {
    return {
      ...base,
      targetFile: normalizeSettingTargetFile(typeof base.targetFile === "string" ? base.targetFile : undefined),
      subject: normalizeShortText(base.subject, "", 160),
      currentConsensus: normalizeLongText(base.currentConsensus, "", 8_000),
      newContent: normalizeLongText(base.newContent, "", 8_000),
      reason: normalizeLongText(base.reason, "", 2_000),
      options: normalizeStringArray(base.options, ["keep_current", "adopt_new", "manual", "defer"], 8),
      selectedOption: typeof base.selectedOption === "string" ? base.selectedOption : "",
    };
  }
  return {
    ...base,
    content: normalizeLongText(base.content, "", 20_000),
    generatedPrompt: normalizeLongText(base.generatedPrompt, "", 20_000),
  };
}

function actionPlanFromDigest(params: {
  readonly digest: WorkbenchRoundDigest;
  readonly targetChapter: number;
  readonly updatedAt: string;
}): WorkbenchActionPlan {
  const items: WorkbenchActionItem[] = [];
  if (params.digest.draftCandidate.content.trim()) {
    items.push({
      id: "action-draft-01",
      type: "draft",
      title: params.digest.draftCandidate.title || "应用正文候选",
      sourceEvidence: params.digest.draftCandidate.sourceBlockIds.join(", "),
      status: params.digest.status === "applied" ? "accepted" : "pending",
      payload: {
        content: params.digest.draftCandidate.content,
        targetChapter: params.targetChapter,
        sourceBlockIds: params.digest.draftCandidate.sourceBlockIds,
      },
    });
  }
  params.digest.settingChanges.forEach((change, index) => {
    items.push({
      id: normalizeActionId(change.id, `action-setting-${String(index + 1).padStart(2, "0")}`),
      type: "setting",
      title: change.label,
      sourceEvidence: change.evidence,
      status: change.status === "accepted" ? "accepted" : change.status === "rejected" ? "rejected" : "pending",
      payload: {
        targetFile: change.targetFile,
        content: change.content,
        sourceBlockIds: change.sourceBlockIds,
      },
    });
  });
  params.digest.gaps.forEach((gap, index) => {
    if (!looksLikeActionableGap(`${gap.label}\n${gap.detail}`)) {
      return;
    }
    items.push({
      id: normalizeActionId(gap.id, `action-decision-${String(index + 1).padStart(2, "0")}`),
      type: "decision",
      title: gap.label,
      sourceEvidence: gap.detail,
      status: "pending",
      payload: {
        subject: gap.label,
        currentConsensus: "",
        newContent: "",
        reason: gap.detail,
        targetFile: "story/current_state.md",
        options: ["keep_current", "adopt_new", "manual", "defer"],
        sourceBlockIds: gap.sourceBlockIds,
      },
    });
  });
  if (params.digest.nextPrompt.trim()) {
    items.push({
      id: "action-prompt-01",
      type: "prompt",
      title: "下一轮 Gemini 提示词",
      sourceEvidence: "",
      status: "pending",
      payload: {
        content: params.digest.nextPrompt,
      },
    });
  }

  return {
    status: params.digest.status,
    updatedAt: params.updatedAt,
    ...(params.digest.model ? { model: params.digest.model } : {}),
    targetChapter: params.targetChapter,
    summary: summarizeActionPlan(items),
    items,
    nextPrompt: params.digest.nextPrompt,
    rawBlockCount: params.digest.rawBlockCount,
    hiddenBlockCount: Math.max(0, params.digest.rawBlockCount - items.length),
  };
}

function summarizeActionPlan(items: ReadonlyArray<WorkbenchActionItem>): string {
  const pending = items.filter((item) => item.status === "pending");
  if (pending.length === 0) {
    return "本轮没有需要你决定的问题。";
  }
  const draftCount = pending.filter((item) => item.type === "draft").length;
  const settingCount = pending.filter((item) => item.type === "setting").length;
  const decisionCount = pending.filter((item) => item.type === "decision").length;
  const promptCount = pending.filter((item) => item.type === "prompt").length;
  return [
    draftCount ? `${draftCount} 条正文可应用` : "",
    settingCount ? `${settingCount} 条设定待确认` : "",
    decisionCount ? `${decisionCount} 个问题要拍板` : "",
    promptCount ? `${promptCount} 条可追问 Gemini` : "",
  ].filter(Boolean).join("，") || "本轮有内容待处理。";
}

function shouldKeepActionItem(item: WorkbenchActionItem): boolean {
  if (item.type === "decision") {
    const current = stringFromPayload(item.payload, "currentConsensus") ?? "";
    const next = stringFromPayload(item.payload, "newContent") ?? "";
    const reason = stringFromPayload(item.payload, "reason") ?? "";
    return Boolean(item.title.trim() && reason.trim() && (current.trim() || next.trim()));
  }
  if (item.type === "draft" || item.type === "setting") {
    return Boolean(item.title.trim() && stringFromPayload(item.payload, "content")?.trim());
  }
  return Boolean(item.title.trim() || stringFromPayload(item.payload, "content")?.trim() || stringFromPayload(item.payload, "generatedPrompt")?.trim());
}

function visibleActionItemCount(input: unknown): number {
  const record = isRecord(input) ? input : {};
  return Array.isArray(record.items) ? record.items.length : 0;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseInt(value, 10)
      : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeActionId(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  const cleaned = (text || fallback)
    .replace(/[^A-Za-z0-9._-]/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function labelForActionType(type: WorkbenchActionType): string {
  if (type === "draft") return "正文行动";
  if (type === "setting") return "设定行动";
  if (type === "decision") return "需要拍板";
  return "追问 Gemini";
}

function buildFallbackWorkbenchDigest(params: {
  readonly blocks: ReadonlyArray<WorkbenchBlock>;
  readonly settingCandidates: ReadonlyArray<WorkbenchSettingCandidate>;
  readonly rawText: string;
  readonly status: WorkbenchDigestStatus;
  readonly updatedAt: string;
}): WorkbenchRoundDigest {
  const draftBlocks = params.blocks.filter((block) => block.kind === "chapter" && looksLikeNarrative(block.content));
  const primaryDraft = draftBlocks[0];
  const settingChanges = params.settingCandidates.slice(0, 8).map((candidate, index): WorkbenchSettingChange => ({
    id: candidate.id || `setting-${String(index + 1).padStart(2, "0")}`,
    label: candidate.label,
    targetFile: candidate.targetFile,
    content: candidate.content,
    evidence: candidate.evidence,
    status: "pending",
    sourceBlockIds: [],
  }));
  const promptBlock = params.blocks.find((block) => block.kind === "prompt");
  const gaps = deriveFallbackGaps(params.blocks);
  return {
    status: params.status,
    updatedAt: params.updatedAt,
    draftCandidate: {
      title: primaryDraft?.title ?? "当前正文草稿",
      content: primaryDraft?.content ?? "",
      sourceBlockIds: primaryDraft ? [primaryDraft.id] : [],
    },
    settingChanges,
    gaps,
    nextPrompt: promptBlock?.content ?? buildFallbackNextPrompt({
      rawText: params.rawText,
      draft: primaryDraft?.content ?? "",
      gaps,
    }),
    rawBlockCount: params.blocks.length,
    hiddenBlockCount: Math.max(0, params.blocks.length - 1 - settingChanges.length - gaps.length),
  };
}

function deriveFallbackGaps(blocks: ReadonlyArray<WorkbenchBlock>): WorkbenchGap[] {
  return blocks
    .filter((block) => block.kind === "revision" || /缺口|冲突|问题|风险|不足|待定/u.test(block.content))
    .filter((block) => looksLikeActionableGap(block.content))
    .slice(0, 5)
    .map((block, index) => ({
      id: `gap-${String(index + 1).padStart(2, "0")}`,
      label: summarizeGapLabel(block.title || "待处理问题"),
      detail: summarizeGapDetail(block.content),
      severity: block.kind === "revision" ? "medium" : "low",
      sourceBlockIds: [block.id],
    }));
}

function looksLikeActionableGap(value: string): boolean {
  const sample = value.slice(0, 1000);
  const hasDecisionProblem = /(?:动机|目标|因果|逻辑|时间线|人物行为|设定|节奏|冲突|悬念|代价|收益|反派|阻力).{0,24}(?:不清|不足|缺失|断裂|矛盾|冲突|薄弱|站不住|没有解释|需要决定|需要确认|需要补足)/u.test(sample)
    || /(?:不清|不足|缺失|断裂|矛盾|薄弱|站不住|没有解释).{0,24}(?:动机|目标|因果|逻辑|时间线|人物行为|设定|节奏|冲突|悬念|代价|收益|反派|阻力)/u.test(sample)
    || /作者需要.{0,20}(?:决定|选择|确认)|需要你.{0,20}(?:决定|选择|确认)/u.test(sample);
  const looksLikePlotSummary = /第[零〇一二三四五六七八九十百千万\d]+章|行动：|回溯|危机：|悬念：|他找到|她找到|开始|进入|遇到|发现|回收/u.test(sample);
  return hasDecisionProblem && !(looksLikePlotSummary && !hasDecisionProblem);
}

function summarizeGapLabel(value: string): string {
  return value
    .replace(/^[一二三四五六七八九十\d]+[、.．]\s*/u, "")
    .replace(/\s+/g, " ")
    .slice(0, 36)
    || "待处理问题";
}

function summarizeGapDetail(value: string): string {
  const cleaned = value
    .replace(/\r\n/g, "\n")
    .split(/\n+/u)
    .map((line) => line.trim().replace(/^[-*]\s*/u, ""))
    .filter(Boolean)
    .filter((line) => !/^第[零〇一二三四五六七八九十百千万\d]+章/u.test(line))
    .join(" ");
  const problem = firstMatch(cleaned, /(?:缺口|冲突|问题|风险|不足|待定|矛盾)[：:，,。；;\s]*(.{8,80})/u)
    || "还没有被整理成可判断的问题。";
  const impact = firstMatch(cleaned, /(?:影响|导致|会让|容易|可能)[：:，,。；;\s]*(.{8,80})/u)
    || "可能影响当前章节的目标、因果或读者期待。";
  const decision = firstMatch(cleaned, /(?:需要|决定|选择|确认|补足)[：:，,。；;\s]*(.{8,80})/u)
    || "需要决定是否接受这条调整，或让 Gemini 重做。";
  return [
    `问题：${trimGapSentence(problem)}`,
    `影响：${trimGapSentence(impact)}`,
    `决定：${trimGapSentence(decision)}`,
  ].join("\n");
}

function firstMatch(value: string, pattern: RegExp): string | null {
  return value.match(pattern)?.[1]?.trim() ?? null;
}

function trimGapSentence(value: string): string {
  const sentence = value.split(/[。！？；;]/u).find(Boolean)?.trim() ?? value.trim();
  return sentence.length > 70 ? `${sentence.slice(0, 68)}...` : sentence;
}

function buildFallbackNextPrompt(params: {
  readonly rawText: string;
  readonly draft: string;
  readonly gaps: ReadonlyArray<WorkbenchGap>;
}): string {
  return [
    "请基于下面当前草稿继续协助我创作，不要把不确定内容写成既定事实。",
    "",
    "当前草稿：",
    params.draft.trim() || params.rawText.trim().slice(0, 1200) || "暂无。",
    "",
    "待处理问题：",
    ...(params.gaps.length ? params.gaps.map((gap) => `- ${gap.label}：${gap.detail}`) : ["- 暂无明确问题，请先指出潜在卡点。"]),
    "",
    "请输出：正文改进方案、设定风险、下一段冲突链。",
  ].join("\n");
}

async function resolveTargetChapter(state: WorkbenchState, bookId: string): Promise<number> {
  const [nextChapter, chapters] = await Promise.all([
    state.getNextChapterNumber(bookId).catch(() => 1),
    state.loadChapterIndex(bookId).catch(() => [] as ReadonlyArray<ChapterMeta>),
  ]);
  const actionable = [...chapters]
    .filter((chapter) => chapter.status !== "approved")
    .sort((a, b) => b.number - a.number)[0];
  return actionable?.number ?? nextChapter;
}

async function readOptionalText(path: string): Promise<string> {
  return readFile(path, "utf-8").catch(() => "");
}

async function readCurrentChapterText(bookDir: string, chapterNumber: number): Promise<string> {
  const chaptersDir = join(bookDir, "chapters");
  const padded = String(chapterNumber).padStart(4, "0");
  const files = await readdir(chaptersDir).catch(() => []);
  const file = files.find((name) => name.startsWith(`${padded}_`) && name.endsWith(".md"));
  return file ? readOptionalText(join(chaptersDir, file)) : "";
}

async function loadWorkbenchActionHistory(
  bookDir: string,
  currentEntryId?: string,
): Promise<WorkbenchConsensusSnapshot["actionHistory"]> {
  const workspaceDir = join(bookDir, "workspace");
  const files = await readdir(workspaceDir).catch(() => []);
  const entries = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => loadWorkbenchEntryFile(join(workspaceDir, file)).catch(() => null)),
  );
  return entries
    .filter((entry): entry is WorkbenchEntry => entry !== null)
    .filter((entry) => entry.id !== currentEntryId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap((entry) =>
      entry.actionPlan.items
        .filter((item) => item.status !== "pending")
        .map((item) => ({
          entryId: entry.id,
          itemId: item.id,
          type: item.type,
          title: item.title,
          status: item.status,
          payloadSummary: summarizeActionPayloadForHistory(item),
        })),
    )
    .slice(-60);
}

function summarizeActionPayloadForHistory(item: WorkbenchActionItem): string {
  if (item.type === "decision") {
    return [
      stringFromPayload(item.payload, "subject"),
      stringFromPayload(item.payload, "selectedOption"),
      stringFromPayload(item.payload, "content"),
      stringFromPayload(item.payload, "newContent"),
    ].filter(Boolean).join(" / ").slice(0, 500);
  }
  return [
    stringFromPayload(item.payload, "targetFile"),
    stringFromPayload(item.payload, "content"),
    stringFromPayload(item.payload, "generatedPrompt"),
  ].filter(Boolean).join(" / ").slice(0, 500);
}

function renderDecisionApplication(params: {
  readonly action: WorkbenchActionItem;
  readonly operation: "adopt_new" | "manual";
  readonly content: string;
}): string {
  return [
    `决策主题：${stringFromPayload(params.action.payload, "subject") ?? params.action.title}`,
    `采用方式：${params.operation === "manual" ? "手动改" : "采用 Gemini 新内容"}`,
    "",
    "原当前共识：",
    stringFromPayload(params.action.payload, "currentConsensus") || "未记录。",
    "",
    "Gemini 新内容：",
    stringFromPayload(params.action.payload, "newContent") || "未记录。",
    "",
    "写入内容：",
    params.content.trimEnd(),
  ].join("\n");
}

function normalizeDraftCandidate(input: unknown, fallback: WorkbenchDraftCandidate): WorkbenchDraftCandidate {
  const record = isRecord(input) ? input : {};
  return {
    title: normalizeShortText(record.title, fallback.title, 120),
    content: normalizeLongText(record.content, fallback.content, 80_000),
    sourceBlockIds: normalizeStringArray(record.sourceBlockIds, fallback.sourceBlockIds, 40),
  };
}

function normalizeSettingChanges(input: unknown, fallback: ReadonlyArray<WorkbenchSettingChange>): WorkbenchSettingChange[] {
  if (!Array.isArray(input)) {
    return [...fallback];
  }
  return input.slice(0, 12).map((item, index) => {
    const record = isRecord(item) ? item : {};
    const fallbackItem = fallback[index];
    return {
      id: normalizeShortText(record.id, fallbackItem?.id ?? `setting-${String(index + 1).padStart(2, "0")}`, 80),
      label: normalizeShortText(record.label, fallbackItem?.label ?? "设定变更", 120),
      targetFile: normalizeSettingTargetFile(typeof record.targetFile === "string" ? record.targetFile : fallbackItem?.targetFile),
      content: normalizeLongText(record.content, fallbackItem?.content ?? "", 20_000),
      evidence: normalizeLongText(record.evidence, fallbackItem?.evidence ?? "", 2_000),
      status: normalizeSettingStatus(record.status, fallbackItem?.status ?? "pending"),
      sourceBlockIds: normalizeStringArray(record.sourceBlockIds, fallbackItem?.sourceBlockIds ?? [], 40),
    };
  }).filter((item) => item.content.trim() || item.label.trim());
}

function normalizeGaps(input: unknown, fallback: ReadonlyArray<WorkbenchGap>): WorkbenchGap[] {
  if (!Array.isArray(input)) {
    return [...fallback];
  }
  return input.slice(0, 8).map((item, index) => {
    const record = isRecord(item) ? item : {};
    const fallbackItem = fallback[index];
    const rawDetail = normalizeLongText(record.detail, fallbackItem?.detail ?? "", 4_000);
    return {
      id: normalizeShortText(record.id, fallbackItem?.id ?? `gap-${String(index + 1).padStart(2, "0")}`, 80),
      label: summarizeGapLabel(normalizeShortText(record.label, fallbackItem?.label ?? "待处理问题", 120)),
      detail: normalizeGapDetail(rawDetail),
      severity: normalizeGapSeverity(record.severity, fallbackItem?.severity ?? "medium"),
      sourceBlockIds: normalizeStringArray(record.sourceBlockIds, fallbackItem?.sourceBlockIds ?? [], 40),
    };
  }).filter((item) => item.detail.trim() && item.label.trim());
}

function normalizeGapDetail(value: string): string {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasStructured = lines.some((line) => /^问题[:：]/u.test(line))
    && lines.some((line) => /^影响[:：]/u.test(line))
    && lines.some((line) => /^决定[:：]/u.test(line));
  if (hasStructured) {
    const structured = lines
      .filter((line) => /^(问题|影响|决定)[:：]/u.test(line))
      .slice(0, 3)
      .map((line) => {
        const [label = "", ...rest] = line.split(/[:：]/u);
        return `${label}：${trimGapSentence(rest.join("："))}`;
      })
      .join("\n");
    return looksLikeStructuredGap(structured) ? structured : "";
  }
  if (!looksLikeActionableGap(value)) {
    return "";
  }
  return summarizeGapDetail(value);
}

function looksLikeStructuredGap(value: string): boolean {
  const problem = value.match(/问题[:：]\s*([^\n]+)/u)?.[1] ?? "";
  const decision = value.match(/决定[:：]\s*([^\n]+)/u)?.[1] ?? "";
  const problemLooksLikePlot = /他找到|她找到|开始|进入|遇到|发现|回收|潜入|行动|危机|第[零〇一二三四五六七八九十百千万\d]+章/u.test(problem);
  const hasRealProblem = /不清|不足|缺失|断裂|矛盾|冲突|薄弱|站不住|没有解释|需要决定|需要确认|需要补足/u.test(problem)
    || /决定|选择|确认|补足|删掉|保留|重做/u.test(decision);
  return hasRealProblem && !problemLooksLikePlot;
}

function parseStrictJsonObject(responseText: string): Record<string, unknown> {
  const trimmed = responseText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new WorkbenchError(502, "DeepSeek did not return strict JSON.");
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!isRecord(parsed)) {
    throw new WorkbenchError(502, "DeepSeek JSON response must be an object.");
  }
  return parsed;
}

function visibleDigestItemCount(input: unknown): number {
  const record = isRecord(input) ? input : {};
  const settings = Array.isArray(record.settingChanges) ? record.settingChanges.length : 0;
  const gaps = Array.isArray(record.gaps) ? record.gaps.length : 0;
  const draft = isRecord(record.draftCandidate) && typeof record.draftCandidate.content === "string" && record.draftCandidate.content.trim()
    ? 1
    : 0;
  const prompt = typeof record.nextPrompt === "string" && record.nextPrompt.trim() ? 1 : 0;
  return settings + gaps + draft + prompt;
}

function deriveSettingCandidates(blocks: ReadonlyArray<WorkbenchBlock>): ReadonlyArray<WorkbenchSettingCandidate> {
  return blocks
    .filter((block) => isSettingCandidateKind(block.kind))
    .slice(0, 20)
    .map((block, index) => ({
      id: `setting-${String(index + 1).padStart(2, "0")}`,
      kind: block.kind,
      label: block.title || defaultBlockTitle(block.kind, index + 1),
      targetFile: targetFileForSettingCandidate(block),
      content: block.content.trim(),
      evidence: block.content.trim().slice(0, 240),
    }));
}

function isSettingCandidateKind(kind: WorkbenchBlockKind): boolean {
  return kind === "concept"
    || kind === "outline"
    || kind === "character"
    || kind === "world"
    || kind === "revision";
}

function targetFileForSettingCandidate(block: WorkbenchBlock): string {
  if (block.kind === "outline") {
    return "story/outline/volume_map.md";
  }
  if (/伏笔|悬念|钩子|未解|回收/u.test(block.content)) {
    return "story/pending_hooks.md";
  }
  return "story/current_state.md";
}

function splitIntoSections(text: string): Array<{ readonly title: string; readonly content: string }> {
  const lines = text.split(/\r?\n/u);
  const headingIndexes: number[] = [];
  lines.forEach((line, index) => {
    if (/^\s{0,3}(#{1,3}\s+|【[^】]{2,40}】|[一二三四五六七八九十]+[、.．]\s*|(?:\d{1,2})[.．、]\s+|第[零〇一二三四五六七八九十百千万\d]+章\b)/u.test(line)) {
      headingIndexes.push(index);
    }
  });

  if (headingIndexes.length === 0) {
    return splitByBlankGroups(text);
  }

  const sections: Array<{ title: string; content: string }> = [];
  for (let i = 0; i < headingIndexes.length; i += 1) {
    const start = headingIndexes[i]!;
    const end = headingIndexes[i + 1] ?? lines.length;
    const rawTitle = lines[start]!.replace(/^\s{0,3}#{1,3}\s+/u, "").trim();
    const content = lines.slice(start, end).join("\n").trim();
    if (content) {
      sections.push({ title: normalizeHeading(rawTitle), content });
    }
  }

  const beforeFirst = lines.slice(0, headingIndexes[0]).join("\n").trim();
  if (beforeFirst) {
    sections.unshift({ title: "前置内容", content: beforeFirst });
  }

  return sections;
}

function splitByBlankGroups(text: string): Array<{ readonly title: string; readonly content: string }> {
  const chunks = text
    .split(/\n\s*\n\s*\n+/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length <= 1) {
    return text.trim() ? [{ title: "粘贴内容", content: text.trim() }] : [];
  }

  return chunks.map((chunk, index) => ({
    title: firstMeaningfulLine(chunk) ?? `片段 ${index + 1}`,
    content: chunk,
  }));
}

function classifyBlock(title: string, content: string): WorkbenchBlockKind {
  const sample = `${title}\n${content.slice(0, 800)}`;
  if (/第[零〇一二三四五六七八九十百千万\d]+章|chapter\s+\d+|^\s*#\s*(第.+章|chapter)/imu.test(sample)) return "chapter";
  if (/提示词|prompt|请你|帮我|继续写|按照.*写|发给\s*Gemini|发给\s*gemini/u.test(sample)) return "prompt";
  if (/人设|人物|角色|主角|男主|女主|反派|配角|小传|说话方式/u.test(sample)) return "character";
  if (/世界观|设定|规则|体系|宗门|势力|地图|阶层|制度|资源/u.test(sample)) return "world";
  if (/大纲|卷纲|章纲|剧情线|三段式|第一段|第二段|第三段|关卡|难题/u.test(sample)) return "outline";
  if (/修改|建议|问题|优化|润色|改写|微调|审校|不足|风险/u.test(sample)) return "revision";
  if (/构思|脑洞|主题|核心冲突|一句话故事|动机|目标|悬念/u.test(sample)) return "concept";
  return looksLikeNarrative(content) ? "chapter" : "note";
}

function looksLikeNarrative(content: string): boolean {
  const lines = content.split(/\r?\n/u).filter((line) => line.trim());
  const dialogueLines = lines.filter((line) => /[“”"]|：|:/.test(line)).length;
  return content.length > 600 && dialogueLines >= 2 && !/[|]{2,}|^\s*[-*]\s+/mu.test(content);
}

function stripCommonChatChrome(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*(Gemini|You|你|我)\s*[:：]\s*$/iu.test(line.trim()))
    .join("\n")
    .trim();
}

function renderRawPasteMarkdown(params: {
  readonly sourceName: string;
  readonly createdAt: string;
  readonly text: string;
}): string {
  return [
    "---",
    `source: ${JSON.stringify(params.sourceName)}`,
    `createdAt: ${JSON.stringify(params.createdAt)}`,
    "type: raw-paste",
    "---",
    "",
    params.text.trimEnd(),
    "",
  ].join("\n");
}

function renderSavedSelectionHeader(params: {
  readonly title: string;
  readonly target: WorkbenchSaveTarget;
  readonly kind?: WorkbenchBlockKind;
  readonly sourceEntryId?: string;
}): string {
  return [
    `# ${params.title}`,
    "",
    `> 来源：创作工作台${params.sourceEntryId ? ` / ${params.sourceEntryId}` : ""}`,
    `> 类型：${params.kind ?? params.target}`,
    "",
  ].join("\n");
}

function normalizeChapterMarkdown(params: {
  readonly content: string;
  readonly title: string;
  readonly chapterNumber: number;
  readonly language: "zh" | "en";
}): string {
  const trimmed = params.content.trim();
  if (/^\s*#\s+/u.test(trimmed)) {
    return `${trimmed}\n`;
  }

  const heading = params.language === "en"
    ? `# Chapter ${params.chapterNumber}: ${params.title}`
    : `# 第${params.chapterNumber}章 ${params.title}`;
  return `${heading}\n\n${trimmed}\n`;
}

function targetDirectory(bookDir: string, target: Exclude<WorkbenchSaveTarget, "chapter" | "setting">): string {
  if (target === "prompt") return join(bookDir, "prompts");
  if (target === "version") return join(bookDir, "versions");
  if (target === "material") return join(bookDir, "workspace", "materials");
  return join(bookDir, "notes");
}

function defaultTitleForTarget(target: WorkbenchSaveTarget): string {
  if (target === "setting") return "工作台设定确认";
  if (target === "prompt") return "Gemini 提示词";
  if (target === "material") return "整理素材";
  if (target === "version") return "改写版本";
  if (target === "chapter") return "粘贴章节";
  return "创作笔记";
}

function normalizeTitle(title: string | undefined, fallback: string): string {
  const trimmed = title?.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/\s+/g, " ").slice(0, 80);
}

function extractTitleFromMarkdown(content: string): string | null {
  const firstHeading = content.match(/^\s*#\s+(.+)$/mu)?.[1]?.trim();
  if (firstHeading) {
    return firstHeading.replace(/^第[零〇一二三四五六七八九十百千万\d]+章\s*/u, "").trim() || firstHeading;
  }
  return firstMeaningfulLine(content)?.slice(0, 40) ?? null;
}

function firstMeaningfulLine(content: string): string | null {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^[-*_`#>]+$/u.test(line))
    ?? null;
}

function defaultBlockTitle(kind: WorkbenchBlockKind, index: number): string {
  const labels: Record<WorkbenchBlockKind, string> = {
    concept: "构思",
    outline: "大纲",
    character: "人物",
    world: "设定",
    chapter: "正文",
    revision: "修改建议",
    prompt: "提示词",
    note: "笔记",
  };
  return `${labels[kind]} ${index}`;
}

function confidenceForKind(kind: WorkbenchBlockKind, content: string): number {
  if (kind === "note") return 0.45;
  if (kind === "chapter" && content.length > 1000) return 0.82;
  return 0.68;
}

function normalizeHeading(raw: string): string {
  return raw
    .replace(/^【(.+)】$/u, "$1")
    .replace(/^[一二三四五六七八九十]+[、.．]\s*/u, "")
    .replace(/^\d{1,2}[.．、]\s*/u, "")
    .trim()
    .slice(0, 80);
}

function sanitizeFilename(value: string): string {
  const sanitized = value
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[.]+$/g, "")
    .slice(0, 50);
  return sanitized || "untitled";
}

function assertSafeSegment(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) || basename(value) !== value) {
    throw new WorkbenchError(400, `Invalid ${field}`);
  }
}

function normalizeSourceName(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 80) : "Gemini";
}

function formatTimestampForFile(iso: string): string {
  return iso.replace(/[-:.TZ]/g, "").slice(0, 14);
}

function toBookRelativePath(bookDir: string, path: string): string {
  return relative(bookDir, path).replace(/\\/g, "/");
}

function countTextUnits(text: string, language: "zh" | "en"): number {
  if (language === "en") {
    return text.trim().split(/\s+/u).filter(Boolean).length;
  }
  return text.replace(/\s+/gu, "").length;
}
