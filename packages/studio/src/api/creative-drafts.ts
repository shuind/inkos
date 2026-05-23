import type { BookConfig } from "@actalk/inkos-core";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type CreativeCandidateKind = "explicit" | "inferred" | "conflict" | "gap" | "suggestion";
export type CreativeCandidateStatus = "pending" | "accepted" | "rejected";

const PLATFORM_LABELS: Record<string, string> = {
  tomato: "番茄小说",
  qidian: "起点中文网",
  feilu: "飞卢",
  "royal-road": "Royal Road",
  "kindle-unlimited": "Kindle Unlimited",
  "scribble-hub": "Scribble Hub",
  other: "其他",
};

export interface CreativeCandidate {
  readonly id: string;
  readonly kind: CreativeCandidateKind;
  readonly targetPath: string;
  readonly label: string;
  readonly value: string;
  readonly evidence: string;
  readonly status: CreativeCandidateStatus;
}

export interface FirstVolumeChapterBeat {
  readonly index: number;
  readonly title: string;
  readonly problem: string;
  readonly action: string;
  readonly obstacle: string;
  readonly turn: string;
  readonly result: string;
  readonly hook: string;
}

export interface FirstVolumeStartup {
  readonly book: {
    readonly title: string;
    readonly genre: string;
    readonly platform: string;
    readonly targetChapters: number;
    readonly chapterWordCount: number;
    readonly blurb: string;
  };
  readonly stable: {
    readonly premise: string;
    readonly protagonist: string;
    readonly longTermGoal: string;
    readonly style: string;
    readonly prohibitions: string;
  };
  readonly volume1: {
    readonly coreHook: string;
    readonly protagonistState: string;
    readonly goal: string;
    readonly stakes: string;
    readonly opposition: string;
    readonly opening: string;
    readonly endingState: string;
    readonly suspense: string;
  };
  readonly chapters: ReadonlyArray<FirstVolumeChapterBeat>;
  readonly followups: {
    readonly questions: ReadonlyArray<string>;
    readonly geminiPrompt: string;
    readonly suggestions: ReadonlyArray<string>;
  };
}

export interface CreativeDraftAnalysis {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly model?: string;
  readonly candidates: ReadonlyArray<CreativeCandidate>;
  readonly startup: FirstVolumeStartup;
  readonly rawResponse?: string;
}

export interface CreativeDraftRound {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sourceName: string;
  readonly text: string;
  readonly analysis?: CreativeDraftAnalysis;
  readonly snapshot?: CreativeDraftAnalysis;
}

export interface CreativeDraft {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sourceName: string;
  readonly text: string;
  readonly rounds: ReadonlyArray<CreativeDraftRound>;
  readonly activeRoundId?: string;
  readonly analysis?: CreativeDraftAnalysis;
  readonly snapshot?: CreativeDraftAnalysis;
  readonly createdBookId?: string;
}

export class CreativeDraftError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CreativeDraftError";
  }
}

const DRAFT_ID_RE = /^[a-z0-9._-]+$/i;
const DEFAULT_SOURCE_NAME = "Gemini 官网";

export function defaultUntitledTitle(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    "未命名作品-",
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join("");
}

export function defaultFirstVolumeStartup(now: Date = new Date()): FirstVolumeStartup {
  return {
    book: {
      title: defaultUntitledTitle(now),
      genre: "待定",
      platform: "other",
      targetChapters: 200,
      chapterWordCount: 3000,
      blurb: "",
    },
    stable: {
      premise: "",
      protagonist: "",
      longTermGoal: "",
      style: "",
      prohibitions: "",
    },
    volume1: {
      coreHook: "",
      protagonistState: "",
      goal: "",
      stakes: "",
      opposition: "",
      opening: "",
      endingState: "",
      suspense: "",
    },
    chapters: Array.from({ length: 10 }, (_, index) => ({
      index: index + 1,
      title: "",
      problem: "",
      action: "",
      obstacle: "",
      turn: "",
      result: "",
      hook: "",
    })),
    followups: {
      questions: [],
      geminiPrompt: "",
      suggestions: [],
    },
  };
}

export function creativeDraftsDir(root: string): string {
  return join(root, ".inkos", "creative-drafts");
}

function createDraftRoundId(nowIso: string): string {
  return `round-${formatTimestampForFile(nowIso)}-${randomUUID().slice(0, 8)}`;
}

function createCreativeDraftRound(input: {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sourceName: string;
  readonly text: string;
  readonly analysis?: unknown;
  readonly snapshot?: unknown;
}): CreativeDraftRound {
  const createdAt = normalizeShortText(input.createdAt, new Date().toISOString(), 80);
  const updatedAt = normalizeShortText(input.updatedAt, createdAt, 80);
  return {
    id: normalizeShortText(input.id, createDraftRoundId(createdAt), 120),
    createdAt,
    updatedAt,
    sourceName: normalizeShortText(input.sourceName, DEFAULT_SOURCE_NAME, 80),
    text: normalizeRoundText(input.text, ""),
    ...(input.analysis ? { analysis: normalizeDraftAnalysis(input.analysis, updatedAt) } : {}),
    ...(input.snapshot ? { snapshot: normalizeDraftAnalysis(input.snapshot, updatedAt) } : {}),
  };
}

function normalizeCreativeDraftRounds(
  input: unknown,
  fallback: {
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly sourceName: string;
    readonly text: string;
    readonly analysis?: CreativeDraftAnalysis;
  },
): CreativeDraftRound[] {
  const rounds = Array.isArray(input)
    ? input.slice(0, 80).map((round, index) => normalizeCreativeDraftRound(round, index + 1, fallback))
    : [];

  if (rounds.length > 0) {
    return rounds;
  }

  return [
    createCreativeDraftRound({
      id: createDraftRoundId(fallback.createdAt),
      createdAt: fallback.createdAt,
      updatedAt: fallback.updatedAt,
      sourceName: fallback.sourceName,
      text: fallback.text,
      analysis: fallback.analysis,
    }),
  ];
}

function normalizeCreativeDraftRound(
  input: unknown,
  index: number,
  fallback: {
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly sourceName: string;
    readonly text: string;
    readonly analysis?: CreativeDraftAnalysis;
  },
): CreativeDraftRound {
  const record = isRecord(input) ? input : {};
  return createCreativeDraftRound({
    id: normalizeShortText(record.id, `round-${String(index).padStart(2, "0")}`, 120),
    createdAt: normalizeShortText(record.createdAt, fallback.createdAt, 80),
    updatedAt: normalizeShortText(record.updatedAt, fallback.updatedAt, 80),
    sourceName: normalizeShortText(record.sourceName, fallback.sourceName, 80),
    text: typeof record.text === "string"
      ? record.text
      : index === 1
        ? fallback.text
        : "",
    analysis: record.analysis,
    snapshot: record.snapshot,
  });
}

function resolveCreativeDraftActiveRound(draft: {
  readonly rounds: ReadonlyArray<CreativeDraftRound>;
  readonly activeRoundId?: string;
}): CreativeDraftRound | null {
  if (!draft.rounds.length) {
    return null;
  }
  if (draft.activeRoundId) {
    const activeRound = draft.rounds.find((round) => round.id === draft.activeRoundId);
    if (activeRound) {
      return activeRound;
    }
  }
  return draft.rounds[draft.rounds.length - 1] ?? null;
}

function deriveDraftAnalysisFromRounds(
  rounds: ReadonlyArray<CreativeDraftRound>,
  activeRound: CreativeDraftRound | null,
  fallback: CreativeDraftAnalysis | undefined,
  nowIso: string,
): CreativeDraftAnalysis | undefined {
  const activeRoundAnalysis = activeRound?.snapshot ?? activeRound?.analysis;
  if (activeRoundAnalysis) {
    return normalizeDraftAnalysis(activeRoundAnalysis, nowIso);
  }

  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    if (activeRound && round.id === activeRound.id) {
      continue;
    }
    if (round.snapshot) {
      return normalizeDraftAnalysis(round.snapshot, nowIso);
    }
    if (round.analysis) {
      return normalizeDraftAnalysis(round.analysis, nowIso);
    }
  }

  return fallback ? normalizeDraftAnalysis(fallback, nowIso) : undefined;
}

function deriveDraftSnapshotFromRounds(
  rounds: ReadonlyArray<CreativeDraftRound>,
  activeRound: CreativeDraftRound | null,
  fallback: CreativeDraftAnalysis | undefined,
  nowIso: string,
): CreativeDraftAnalysis | undefined {
  if (activeRound?.snapshot) {
    return normalizeDraftAnalysis(activeRound.snapshot, nowIso);
  }

  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    if (activeRound && round.id === activeRound.id) {
      continue;
    }
    if (round.snapshot) {
      return normalizeDraftAnalysis(round.snapshot, nowIso);
    }
  }

  return fallback ? normalizeDraftAnalysis(fallback, nowIso) : undefined;
}

function normalizeRoundText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, 120_000);
}

export async function saveCreativeDraft(params: {
  readonly root: string;
  readonly draftId?: string;
  readonly sourceName?: string;
  readonly text?: string;
  readonly now?: Date;
}): Promise<CreativeDraft> {
  const now = params.now ?? new Date();
  const dir = creativeDraftsDir(params.root);
  await mkdir(dir, { recursive: true });
  const nowIso = now.toISOString();
  const sourceName = normalizeShortText(params.sourceName, DEFAULT_SOURCE_NAME, 80);
  const text = typeof params.text === "string" ? params.text.trim() : "";
  if (!text) {
    throw new CreativeDraftError(400, "TEXT_REQUIRED", "text is required");
  }

  const existing = params.draftId
    ? await loadCreativeDraft(params.root, params.draftId).catch(() => null)
    : null;
  const id = existing?.id ?? `${formatTimestampForFile(nowIso)}-${randomUUID().slice(0, 8)}`;
  assertSafeDraftId(id);

  if (!existing) {
    const round = createCreativeDraftRound({
      id: createDraftRoundId(nowIso),
      createdAt: nowIso,
      updatedAt: nowIso,
      sourceName,
      text,
    });
    const draft = materializeCreativeDraft({
      id,
      createdAt: nowIso,
      updatedAt: nowIso,
      sourceName,
      text,
      rounds: [round],
      activeRoundId: round.id,
    });
    await writeCreativeDraft(params.root, draft);
    return draft;
  }

  const current = materializeCreativeDraft(existing);
  const activeRound = resolveCreativeDraftActiveRound(current);

  let draft: CreativeDraft;
  if (activeRound && !activeRound.analysis && !activeRound.snapshot) {
    const updatedRound = {
      ...activeRound,
      updatedAt: nowIso,
      sourceName,
      text,
    };
    draft = materializeCreativeDraft({
      ...current,
      updatedAt: nowIso,
      rounds: current.rounds.map((round) => round.id === activeRound.id ? updatedRound : round),
      activeRoundId: activeRound.id,
    });
  } else {
    const round = createCreativeDraftRound({
      id: createDraftRoundId(nowIso),
      createdAt: nowIso,
      updatedAt: nowIso,
      sourceName,
      text,
    });
    draft = materializeCreativeDraft({
      ...current,
      updatedAt: nowIso,
      rounds: [...current.rounds, round],
      activeRoundId: round.id,
    });
  }

  await writeCreativeDraft(params.root, draft);
  return draft;
}

export async function listCreativeDrafts(root: string): Promise<ReadonlyArray<CreativeDraft>> {
  const dir = creativeDraftsDir(root);
  const files = await readdir(dir).catch(() => []);
  const drafts = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map((file) => loadCreativeDraft(root, basename(file, ".json")).catch(() => null)),
  );
  return drafts
    .filter((draft): draft is CreativeDraft => draft !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadLatestCreativeDraft(root: string): Promise<CreativeDraft | null> {
  const drafts = await listCreativeDrafts(root);
  return drafts.find((draft) => !draft.createdBookId) ?? null;
}

export async function loadCreativeDraft(root: string, draftId: string): Promise<CreativeDraft> {
  assertSafeDraftId(draftId);
  const path = join(creativeDraftsDir(root), `${draftId}.json`);
  const raw = await readFile(path, "utf-8").catch(() => null);
  if (!raw) {
    throw new CreativeDraftError(404, "DRAFT_NOT_FOUND", "Creative draft not found");
  }
  return normalizeCreativeDraft(JSON.parse(raw) as Partial<CreativeDraft>);
}

export async function updateCreativeDraftAnalysis(params: {
  readonly root: string;
  readonly draftId: string;
  readonly analysis: unknown;
  readonly now?: Date;
}): Promise<CreativeDraft> {
  const draft = await loadCreativeDraft(params.root, params.draftId);
  const nowIso = (params.now ?? new Date()).toISOString();
  const analysis = normalizeDraftAnalysis(params.analysis, nowIso);
  const activeRound = resolveCreativeDraftActiveRound(draft);
  if (!activeRound) {
    throw new CreativeDraftError(409, "NO_ACTIVE_ROUND", "Creative draft has no active round");
  }
  const updatedRound: CreativeDraftRound = {
    ...activeRound,
    updatedAt: nowIso,
    analysis: {
      ...analysis,
      updatedAt: nowIso,
    },
  };
  const updated = materializeCreativeDraft({
    ...draft,
    updatedAt: nowIso,
    rounds: draft.rounds.map((round) => round.id === activeRound.id ? updatedRound : round),
    activeRoundId: activeRound.id,
  });
  await writeCreativeDraft(params.root, updated);
  return updated;
}

export async function updateCreativeDraftSnapshot(params: {
  readonly root: string;
  readonly draftId: string;
  readonly snapshot: unknown;
  readonly now?: Date;
}): Promise<CreativeDraft> {
  const draft = await loadCreativeDraft(params.root, params.draftId);
  const nowIso = (params.now ?? new Date()).toISOString();
  const snapshot = normalizeDraftAnalysis(params.snapshot, nowIso);
  const activeRound = resolveCreativeDraftActiveRound(draft);
  if (!activeRound) {
    throw new CreativeDraftError(409, "NO_ACTIVE_ROUND", "Creative draft has no active round");
  }
  const updatedRound: CreativeDraftRound = {
    ...activeRound,
    updatedAt: nowIso,
    snapshot: {
      ...snapshot,
      updatedAt: nowIso,
    },
  };
  const updated = materializeCreativeDraft({
    ...draft,
    updatedAt: nowIso,
    rounds: draft.rounds.map((round) => round.id === activeRound.id ? updatedRound : round),
    activeRoundId: activeRound.id,
  });
  await writeCreativeDraft(params.root, updated);
  return updated;
}

export async function markCreativeDraftCreated(params: {
  readonly root: string;
  readonly draftId: string;
  readonly bookId: string;
  readonly now?: Date;
}): Promise<CreativeDraft> {
  const draft = await loadCreativeDraft(params.root, params.draftId);
  const updated: CreativeDraft = {
    ...draft,
    updatedAt: (params.now ?? new Date()).toISOString(),
    createdBookId: params.bookId,
  };
  await writeCreativeDraft(params.root, updated);
  return updated;
}

export function buildCreativeDraftAnalyzeMessages(draft: CreativeDraft): ReadonlyArray<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "你是一个中文长篇网文创作整理助手，只做抽取、诊断、建议和追问，不代替作者定稿。",
        "你必须输出严格 JSON，不要 Markdown，不要代码块，不要解释。",
        "事实只能来自用户粘贴内容；如果你补全可能方案，candidate.kind 必须是 suggestion。",
        "创建阶段只处理整书稳定信息、第一卷启动稿、近 10 章问题链，不要强行规划全书详细架构。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "请把下面从 Gemini 官网复制来的混合内容整理成 JSON。",
        "",
        "JSON 结构必须是：",
        JSON.stringify({
          candidates: [
            {
              kind: "explicit|inferred|conflict|gap|suggestion",
              targetPath: "book.title",
              label: "书名",
              value: "候选值或问题描述",
              evidence: "来自粘贴内容的证据；建议可写推理依据",
              status: "pending",
            },
          ],
          startup: defaultFirstVolumeStartup(new Date("2026-01-01T00:00:00.000Z")),
        }, null, 2),
        "",
        "targetPath 只能使用这些前缀：book., stable., volume1., chapters.N., followups.",
        "chapters 最多 10 条。followups.questions 只给 3-5 个最关键追问。",
        "followups.geminiPrompt 要是一段可直接复制给 Gemini 的中文提示词。",
        "",
        "粘贴内容：",
        draft.text.slice(0, 80_000),
      ].join("\n"),
    },
  ];
}

export function buildCreativeDraftAnalyzeMessagesV2(
  draft: CreativeDraft,
): ReadonlyArray<{ role: "system" | "user"; content: string }> {
  const snapshot = draft.snapshot ?? draft.analysis;
  return [
    {
      role: "system",
      content: [
        "你是一个中文长篇网文创作整理助手，只做抽取、诊断、建议和追问，不代替作者定稿。",
        "你必须输出严格 JSON，不要 Markdown，不要代码块，不要解释。",
        "事实只能来自用户粘贴内容；如果你补全可能方案，candidate.kind 必须是 suggestion。",
        "创建阶段只处理整书稳定信息、第一卷启动稿、近 10 章问题链，不要强行规划全书详细架构。",
        "多轮迭代时，只能在当前已确认的内容基础上继续，不要重写历史上已经决定的部分。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "请把下面这一轮 Gemini 复制内容整理成 JSON。",
        "",
        "JSON 结构必须是：",
        JSON.stringify({
          candidates: [
            {
              kind: "explicit|inferred|conflict|gap|suggestion",
              targetPath: "book.title",
              label: "书名",
              value: "候选值或问题描述",
              evidence: "来自粘贴内容的证据；建议可写推理依据",
              status: "pending",
            },
          ],
          startup: defaultFirstVolumeStartup(new Date("2026-01-01T00:00:00.000Z")),
        }, null, 2),
        "",
        "targetPath 只能使用这些前缀：book., stable., volume1., chapters.N., followups.",
        "chapters 最多 10 条。followups.questions 只给 3-5 个最关键追问。",
        "followups.geminiPrompt 要是一段可直接复制给 Gemini 的中文提示词。",
        "",
        "当前快照：",
        snapshot ? JSON.stringify(snapshot, null, 2) : "暂无。",
        "",
        "本轮粘贴内容：",
        draft.text.slice(0, 80_000),
        "",
        `历史轮次数：${draft.rounds.length}`,
      ].join("\n"),
    },
  ];
}

export function parseCreativeDraftAnalysisResponse(params: {
  readonly responseText: string;
  readonly model?: string;
  readonly now?: Date;
}): CreativeDraftAnalysis {
  const nowIso = (params.now ?? new Date()).toISOString();
  let parsed: unknown;
  try {
    parsed = JSON.parse(params.responseText.trim());
  } catch (error) {
    throw new CreativeDraftError(
      502,
      "INVALID_ANALYSIS_JSON",
      `DeepSeek did not return strict JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const analysis = normalizeDraftAnalysis(parsed, nowIso);
  return {
    ...analysis,
    createdAt: analysis.createdAt || nowIso,
    updatedAt: nowIso,
    ...(params.model ? { model: params.model } : {}),
    rawResponse: params.responseText,
  };
}

export function renderCreativeDraftStoryFrame(params: {
  readonly book: BookConfig;
  readonly startup: FirstVolumeStartup;
  readonly candidates: ReadonlyArray<CreativeCandidate>;
}): string {
  const accepted = params.candidates.filter((candidate) => candidate.status === "accepted");
  return [
    `# ${params.book.title} 故事框架`,
    "",
    "## 整书稳定信息",
    "",
    `- 题材：${todo(params.startup.book.genre)}`,
    `- 核心前提：${todo(params.startup.stable.premise || params.startup.book.blurb)}`,
    `- 主角长期核心：${todo(params.startup.stable.protagonist)}`,
    `- 长期目标：${todo(params.startup.stable.longTermGoal)}`,
    `- 文风/节奏：${todo(params.startup.stable.style)}`,
    `- 禁忌/边界：${todo(params.startup.stable.prohibitions)}`,
    "",
    "## 第一卷核心",
    "",
    `- 第一卷卖点：${todo(params.startup.volume1.coreHook)}`,
    `- 主角当前状态：${todo(params.startup.volume1.protagonistState)}`,
    `- 阶段目标：${todo(params.startup.volume1.goal)}`,
    `- 非做不可：${todo(params.startup.volume1.stakes)}`,
    `- 阻力/敌人：${todo(params.startup.volume1.opposition)}`,
    `- 开头切入点：${todo(params.startup.volume1.opening)}`,
    `- 第一卷结尾状态：${todo(params.startup.volume1.endingState)}`,
    `- 悬念：${todo(params.startup.volume1.suspense)}`,
    "",
    "## 已接受候选",
    "",
    accepted.length
      ? accepted.map((candidate) => `- ${candidate.label}：${candidate.value}`).join("\n")
      : "暂无。",
    "",
  ].join("\n");
}

export function renderCreativeDraftVolumeMap(startup: FirstVolumeStartup): string {
  const chapters = normalizeChapters(startup.chapters);
  return [
    "# 第一卷启动稿",
    "",
    "## 第一卷卷纲",
    "",
    `- 核心卖点：${todo(startup.volume1.coreHook)}`,
    `- 主角当前状态：${todo(startup.volume1.protagonistState)}`,
    `- 阶段目标：${todo(startup.volume1.goal)}`,
    `- 阶段阻力：${todo(startup.volume1.opposition)}`,
    `- 开头切入：${todo(startup.volume1.opening)}`,
    `- 卷末变化：${todo(startup.volume1.endingState)}`,
    "",
    "## 近 10 章问题链",
    "",
    chapters.map((chapter) => [
      `### 第 ${chapter.index} 章 ${chapter.title || "待定"}`,
      "",
      `- 问题：${todo(chapter.problem)}`,
      `- 行动：${todo(chapter.action)}`,
      `- 阻力：${todo(chapter.obstacle)}`,
      `- 反转/代价：${todo(chapter.turn)}`,
      `- 结果：${todo(chapter.result)}`,
      `- 结尾钩子：${todo(chapter.hook)}`,
      "",
    ].join("\n")).join("\n"),
    "## 后续追问",
    "",
    startup.followups.questions.length
      ? startup.followups.questions.map((question) => `- ${question}`).join("\n")
      : "- 暂无。",
    "",
    "## 发给 Gemini 的提示词",
    "",
    startup.followups.geminiPrompt || "暂无。",
    "",
  ].join("\n");
}

export function renderCreativeDraftCurrentState(book: BookConfig, startup: FirstVolumeStartup): string {
  return [
    "# 当前状态",
    "",
    `作品：${book.title}`,
    "",
    "## 第一卷写作前状态",
    "",
    `- 主角：${todo(startup.stable.protagonist)}`,
    `- 当前处境：${todo(startup.volume1.protagonistState)}`,
    `- 阶段目标：${todo(startup.volume1.goal)}`,
    `- 阶段压力：${todo(startup.volume1.stakes)}`,
    `- 阻力/敌人：${todo(startup.volume1.opposition)}`,
    "",
    "## 章节进度",
    "",
    "尚未写入正式章节。",
    "",
  ].join("\n");
}

export function renderCreativeDraftPendingHooks(startup: FirstVolumeStartup): string {
  const hooks = [
    startup.volume1.suspense,
    ...startup.chapters.map((chapter) => chapter.hook),
  ].map((hook) => hook.trim()).filter(Boolean);
  return [
    "# 待回收悬念",
    "",
    hooks.length ? hooks.map((hook) => `- ${hook}`).join("\n") : "- 待设计第一卷核心悬念。",
    "",
  ].join("\n");
}

export function renderCreativeDraftBookRules(startup: FirstVolumeStartup): string {
  return [
    "# 创作规则",
    "",
    "## 工作流",
    "",
    "- Gemini 官网输出先进入创作工作台，人工确认后再保存为设定、素材、提示词、版本或章节。",
    "- DeepSeek 整理结果只作为候选，建议不得自动成为事实。",
    "",
    "## 文风与边界",
    "",
    `- 文风/节奏：${todo(startup.stable.style)}`,
    `- 禁忌/边界：${todo(startup.stable.prohibitions)}`,
    "",
  ].join("\n");
}

export function renderCreativeDraftStartupMarkdown(startup: FirstVolumeStartup): string {
  return [
    "# 第一卷启动稿",
    "",
    "## 书籍基础",
    "",
    `- 书名：${startup.book.title}`,
    `- 题材：${startup.book.genre}`,
    `- 平台：${platformDisplayName(startup.book.platform)}`,
    `- 目标章节：${startup.book.targetChapters}`,
    `- 每章字数：${startup.book.chapterWordCount}`,
    "",
    renderCreativeDraftVolumeMap(startup),
  ].join("\n");
}

function platformDisplayName(platform: string): string {
  const value = platform.trim();
  return (PLATFORM_LABELS[value] ?? value) || "其他";
}

function normalizeCreativeDraft(input: Partial<CreativeDraft>): CreativeDraft {
  const id = normalizeShortText(input.id, "", 120);
  assertSafeDraftId(id);
  const createdAt = normalizeShortText(input.createdAt, new Date().toISOString(), 80);
  const updatedAt = normalizeShortText(input.updatedAt, createdAt, 80);
  const sourceName = normalizeShortText(input.sourceName, DEFAULT_SOURCE_NAME, 80);
  const text = typeof input.text === "string" ? input.text : "";
  const analysis = input.analysis ? normalizeDraftAnalysis(input.analysis, updatedAt) : undefined;
  const snapshot = input.snapshot ? normalizeDraftAnalysis(input.snapshot, updatedAt) : undefined;
  const rounds = normalizeCreativeDraftRounds(input.rounds, {
    createdAt,
    updatedAt,
    sourceName,
    text,
    analysis,
  });
  const activeRoundId = typeof input.activeRoundId === "string" && input.activeRoundId.trim()
    ? input.activeRoundId.trim()
    : rounds[rounds.length - 1]?.id;
  const materialized = materializeCreativeDraft({
    id,
    createdAt,
    updatedAt,
    sourceName,
    text,
    rounds,
    activeRoundId,
    ...(snapshot ? { snapshot } : {}),
    ...(typeof input.createdBookId === "string" && input.createdBookId.trim()
      ? { createdBookId: input.createdBookId.trim() }
      : {}),
  });
  return {
    ...materialized,
  };
}

function normalizeDraftAnalysis(input: unknown, nowIso: string): CreativeDraftAnalysis {
  const record = isRecord(input) ? input : {};
  return {
    createdAt: normalizeShortText(record.createdAt, nowIso, 80),
    updatedAt: normalizeShortText(record.updatedAt, nowIso, 80),
    ...(typeof record.model === "string" && record.model.trim() ? { model: record.model.trim().slice(0, 120) } : {}),
    candidates: normalizeCandidates(record.candidates),
    startup: normalizeStartup(record.startup),
    ...(typeof record.rawResponse === "string" ? { rawResponse: record.rawResponse.slice(0, 120_000) } : {}),
  };
}

function materializeCreativeDraft(input: {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sourceName: string;
  readonly text: string;
  readonly rounds: ReadonlyArray<CreativeDraftRound>;
  readonly activeRoundId?: string;
  readonly snapshot?: CreativeDraftAnalysis;
  readonly createdBookId?: string;
}): CreativeDraft {
  const rounds = input.rounds.map((round) => createCreativeDraftRound(round));
  const activeRound = resolveCreativeDraftActiveRound({ rounds, activeRoundId: input.activeRoundId });
  const analysis = deriveDraftAnalysisFromRounds(
    rounds,
    activeRound,
    input.snapshot,
    input.updatedAt,
  );
  const snapshot = deriveDraftSnapshotFromRounds(
    rounds,
    activeRound,
    input.snapshot,
    input.updatedAt,
  );
  const currentRound = activeRound ?? rounds[0] ?? null;
  return {
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    sourceName: input.sourceName,
    text: currentRound?.text ?? input.text,
    rounds,
    ...(activeRound?.id ? { activeRoundId: activeRound.id } : {}),
    ...(analysis ? { analysis } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(input.createdBookId ? { createdBookId: input.createdBookId } : {}),
  };
}

function normalizeCandidates(input: unknown): CreativeCandidate[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 80).map((candidate, index) => normalizeCandidate(candidate, index + 1));
}

function normalizeCandidate(input: unknown, index: number): CreativeCandidate {
  const record = isRecord(input) ? input : {};
  const kind = normalizeCandidateKind(record.kind);
  return {
    id: normalizeShortText(record.id, `candidate-${String(index).padStart(2, "0")}`, 80),
    kind,
    targetPath: normalizeTargetPath(record.targetPath),
    label: normalizeShortText(record.label, defaultCandidateLabel(kind), 80),
    value: normalizeLongText(record.value, ""),
    evidence: normalizeLongText(record.evidence, ""),
    status: normalizeCandidateStatus(record.status),
  };
}

function normalizeStartup(input: unknown): FirstVolumeStartup {
  const record = isRecord(input) ? input : {};
  const defaults = defaultFirstVolumeStartup();
  const book = isRecord(record.book) ? record.book : {};
  const stable = isRecord(record.stable) ? record.stable : {};
  const volume1 = isRecord(record.volume1) ? record.volume1 : {};
  const followups = isRecord(record.followups) ? record.followups : {};
  return {
    book: {
      title: normalizeShortText(book.title, defaults.book.title, 120),
      genre: normalizeShortText(book.genre, defaults.book.genre, 80),
      platform: normalizeShortText(book.platform, defaults.book.platform, 40),
      targetChapters: normalizePositiveInt(book.targetChapters, defaults.book.targetChapters),
      chapterWordCount: normalizePositiveInt(book.chapterWordCount, defaults.book.chapterWordCount),
      blurb: normalizeLongText(book.blurb, ""),
    },
    stable: {
      premise: normalizeLongText(stable.premise, ""),
      protagonist: normalizeLongText(stable.protagonist, ""),
      longTermGoal: normalizeLongText(stable.longTermGoal, ""),
      style: normalizeLongText(stable.style, ""),
      prohibitions: normalizeLongText(stable.prohibitions, ""),
    },
    volume1: {
      coreHook: normalizeLongText(volume1.coreHook, ""),
      protagonistState: normalizeLongText(volume1.protagonistState, ""),
      goal: normalizeLongText(volume1.goal, ""),
      stakes: normalizeLongText(volume1.stakes, ""),
      opposition: normalizeLongText(volume1.opposition, ""),
      opening: normalizeLongText(volume1.opening, ""),
      endingState: normalizeLongText(volume1.endingState, ""),
      suspense: normalizeLongText(volume1.suspense, ""),
    },
    chapters: normalizeChapters(record.chapters),
    followups: {
      questions: normalizeStringArray(followups.questions, 5),
      geminiPrompt: normalizeLongText(followups.geminiPrompt, ""),
      suggestions: normalizeStringArray(followups.suggestions, 8),
    },
  };
}

function normalizeChapters(input: unknown): FirstVolumeChapterBeat[] {
  const items = Array.isArray(input) ? input.slice(0, 10) : [];
  const normalized = items.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      index: normalizePositiveInt(record.index, index + 1),
      title: normalizeShortText(record.title, "", 80),
      problem: normalizeLongText(record.problem, ""),
      action: normalizeLongText(record.action, ""),
      obstacle: normalizeLongText(record.obstacle, ""),
      turn: normalizeLongText(record.turn, ""),
      result: normalizeLongText(record.result, ""),
      hook: normalizeLongText(record.hook, ""),
    };
  });
  while (normalized.length < 10) {
    normalized.push({
      index: normalized.length + 1,
      title: "",
      problem: "",
      action: "",
      obstacle: "",
      turn: "",
      result: "",
      hook: "",
    });
  }
  return normalized.map((chapter, index) => ({ ...chapter, index: index + 1 }));
}

async function writeCreativeDraft(root: string, draft: CreativeDraft): Promise<void> {
  await mkdir(creativeDraftsDir(root), { recursive: true });
  await writeFile(join(creativeDraftsDir(root), `${draft.id}.json`), `${JSON.stringify(draft, null, 2)}\n`, "utf-8");
}

function assertSafeDraftId(draftId: string): void {
  if (!draftId || !DRAFT_ID_RE.test(draftId)) {
    throw new CreativeDraftError(400, "INVALID_DRAFT_ID", `Invalid creative draft ID: "${draftId}"`);
  }
}

function formatTimestampForFile(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/u, "Z");
}

function normalizeCandidateKind(value: unknown): CreativeCandidateKind {
  return value === "explicit"
    || value === "inferred"
    || value === "conflict"
    || value === "gap"
    || value === "suggestion"
    ? value
    : "suggestion";
}

function normalizeCandidateStatus(value: unknown): CreativeCandidateStatus {
  return value === "accepted" || value === "rejected" || value === "pending" ? value : "pending";
}

function normalizeTargetPath(value: unknown): string {
  const path = normalizeShortText(value, "stable.premise", 80);
  return /^(book|stable|volume1|followups)\.[a-zA-Z0-9]+$/u.test(path)
    || /^chapters\.\d{1,2}\.[a-zA-Z0-9]+$/u.test(path)
    ? path
    : "stable.premise";
}

function defaultCandidateLabel(kind: CreativeCandidateKind): string {
  if (kind === "gap") return "缺口";
  if (kind === "conflict") return "冲突";
  if (kind === "inferred") return "推测";
  if (kind === "explicit") return "已明确";
  return "建议";
}

function normalizeShortText(value: unknown, fallback: string, limit: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, limit);
}

function normalizeLongText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, 12_000);
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseInt(value, 10)
      : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => normalizeLongText(item, ""))
      .filter(Boolean)
      .slice(0, limit)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function todo(value: string): string {
  return value.trim() || "待补充";
}
