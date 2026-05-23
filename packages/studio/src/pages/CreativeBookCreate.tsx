import { useEffect, useMemo, useState } from "react";
import {
  BookPlus,
  Check,
  ClipboardPaste,
  Copy,
  FileText,
  MessageSquarePlus,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { fetchJson } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import {
  defaultChapterWordsForLanguage,
  platformOptionsForLanguage,
  pickValidValue,
} from "./BookCreate";

type CandidateKind = "explicit" | "inferred" | "conflict" | "gap" | "suggestion";
type CandidateStatus = "pending" | "accepted" | "rejected";
type Language = "zh" | "en";

export interface Candidate {
  readonly id: string;
  readonly kind: CandidateKind;
  readonly targetPath: string;
  readonly label: string;
  readonly value: string;
  readonly evidence: string;
  readonly status: CandidateStatus;
}

interface ChapterBeat {
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
  readonly chapters: ReadonlyArray<ChapterBeat>;
  readonly followups: {
    readonly questions: ReadonlyArray<string>;
    readonly geminiPrompt: string;
    readonly suggestions: ReadonlyArray<string>;
  };
}

interface DraftAnalysis {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly model?: string;
  readonly candidates: ReadonlyArray<Candidate>;
  readonly startup: FirstVolumeStartup;
  readonly rawResponse?: string;
}

interface CreativeDraft {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sourceName: string;
  readonly text: string;
  readonly rounds: ReadonlyArray<{
    readonly id: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly sourceName: string;
    readonly text: string;
    readonly analysis?: DraftAnalysis;
    readonly snapshot?: DraftAnalysis;
  }>;
  readonly activeRoundId?: string;
  readonly analysis?: DraftAnalysis;
  readonly snapshot?: DraftAnalysis;
  readonly createdBookId?: string;
}

interface Nav {
  readonly toDashboard: () => void;
  readonly toWorkbench: (id: string) => void;
}

interface DraftResponse {
  readonly draft: CreativeDraft | null;
}

interface AnalyzeResponse {
  readonly draft: CreativeDraft;
  readonly analysis: DraftAnalysis;
}

interface CreateBookResponse {
  readonly ok: true;
  readonly bookId: string;
}

const KIND_LABELS: Record<CandidateKind, string> = {
  explicit: "已明确",
  inferred: "推测",
  conflict: "冲突",
  gap: "缺口",
  suggestion: "建议",
};

const KIND_STYLES: Record<CandidateKind, string> = {
  explicit: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  inferred: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  conflict: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  gap: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  suggestion: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

const TARGET_LABELS: Record<string, string> = {
  "book.title": "书名",
  "book.genre": "题材",
  "book.platform": "平台",
  "book.targetChapters": "目标章节",
  "book.chapterWordCount": "每章字数",
  "book.blurb": "简介",
  "stable.premise": "核心前提",
  "stable.protagonist": "主角长期核心",
  "stable.longTermGoal": "长期目标",
  "stable.style": "文风/节奏",
  "stable.prohibitions": "禁忌/边界",
  "volume1.coreHook": "第一卷卖点",
  "volume1.protagonistState": "主角当前状态",
  "volume1.goal": "第一卷目标",
  "volume1.stakes": "非做不可",
  "volume1.opposition": "阻力/敌人",
  "volume1.opening": "开头切入点",
  "volume1.endingState": "卷末状态",
  "volume1.suspense": "悬念",
  "followups.geminiPrompt": "Gemini 提示词",
};

const LANGUAGE: Language = "zh";

export function defaultStartup(now = new Date()): FirstVolumeStartup {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    book: {
      title: `未命名作品-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`,
      genre: "待定",
      platform: platformOptionsForLanguage(LANGUAGE)[0]?.value ?? "other",
      targetChapters: 200,
      chapterWordCount: Number.parseInt(defaultChapterWordsForLanguage(LANGUAGE), 10) || 3000,
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

export function isStartupReady(startup: FirstVolumeStartup): boolean {
  return Boolean(
    startup.book.title.trim()
      && startup.book.genre.trim()
      && startup.book.targetChapters > 0
      && startup.book.chapterWordCount > 0,
  );
}

export function applyCandidateToStartup(startup: FirstVolumeStartup, candidate: Candidate): FirstVolumeStartup {
  if (candidate.status === "rejected" || candidate.kind === "conflict" || candidate.kind === "gap") {
    return startup;
  }
  return setStartupPath(startup, candidate.targetPath, candidate.value);
}

export function buildCandidateRedoPrompt(candidate: Candidate, startup: FirstVolumeStartup): string {
  const targetLabel = TARGET_LABELS[candidate.targetPath] ?? candidate.label;
  const currentVolume = [
    startup.volume1.coreHook ? `第一卷卖点：${startup.volume1.coreHook}` : "",
    startup.volume1.goal ? `第一卷目标：${startup.volume1.goal}` : "",
    startup.volume1.opposition ? `当前阻力：${startup.volume1.opposition}` : "",
    startup.volume1.opening ? `开头切入：${startup.volume1.opening}` : "",
  ].filter(Boolean).join("\n");

  return [
    `我不满意当前“${candidate.label || targetLabel}”设计，请只围绕第一卷重做这一块。`,
    "",
    "当前不满意的内容：",
    candidate.value || "暂无具体内容。",
    "",
    candidate.evidence ? `原依据/证据：\n${candidate.evidence}\n` : "",
    currentVolume ? `已有第一卷上下文：\n${currentVolume}\n` : "",
    "重做要求：",
    "1. 不要只列名单或概念，要落到可写的情节冲突。",
    "2. 说明人物/势力的立场、欲望、阻止主角的具体方式。",
    "3. 给出第一次冲突场景、升级方式、主角应对和解决后引出的新问题。",
    "4. 如果原内容里有可保留的部分，请说明保留理由；不合适的部分直接替换。",
    "5. 输出按“人物功能/情节功能 → 冲突场景 → 升级链条 → 可选方案”整理。",
  ].filter(Boolean).join("\n");
}

export function buildCurrentSituationGeminiPrompt(
  startup: FirstVolumeStartup,
  candidates: ReadonlyArray<Candidate>,
): string {
  const accepted = candidates.filter((candidate) => candidate.status === "accepted");
  const unresolved = candidates.filter((candidate) =>
    candidate.status === "pending" || candidate.kind === "gap" || candidate.kind === "conflict");
  const rejected = candidates.filter((candidate) => candidate.status === "rejected");
  const chapterLines = startup.chapters
    .filter((chapter) =>
      [
        chapter.title,
        chapter.problem,
        chapter.action,
        chapter.obstacle,
        chapter.turn,
        chapter.result,
        chapter.hook,
      ].some((value) => value.trim()))
    .map((chapter) => [
      `第 ${chapter.index} 章${chapter.title ? `《${chapter.title}》` : ""}`,
      chapter.problem ? `问题：${chapter.problem}` : "",
      chapter.action ? `行动：${chapter.action}` : "",
      chapter.obstacle ? `阻力：${chapter.obstacle}` : "",
      chapter.turn ? `反转/代价：${chapter.turn}` : "",
      chapter.result ? `结果：${chapter.result}` : "",
      chapter.hook ? `钩子：${chapter.hook}` : "",
    ].filter(Boolean).join("；"));

  return [
    "我正在用 Gemini 继续构思一部长篇网文。下面是我在 Studio 里审核整理后的当前情况，请先完整理解，不要急着写正文。",
    "",
    "创作目标：",
    "- 现阶段只处理第一卷和最近约 10 章，不要展开全书完整架构。",
    "- 请帮我补强不满意或缺失的部分，尤其要把人物/势力落到具体情节冲突。",
    "- 输出要便于我继续审核和微调，不要把不确定内容写成既定事实。",
    "",
    "书籍基础：",
    ...formatPromptLines([
      ["书名", startup.book.title],
      ["题材", startup.book.genre],
      ["平台", startup.book.platform],
      ["目标章节", String(startup.book.targetChapters)],
      ["每章字数", String(startup.book.chapterWordCount)],
      ["简介/核心前提", startup.book.blurb],
    ]),
    "",
    "整书稳定项：",
    ...formatPromptLines([
      ["核心前提", startup.stable.premise],
      ["主角长期核心", startup.stable.protagonist],
      ["长期目标", startup.stable.longTermGoal],
      ["文风/节奏", startup.stable.style],
      ["禁忌/边界", startup.stable.prohibitions],
    ]),
    "",
    "第一卷当前启动稿：",
    ...formatPromptLines([
      ["第一卷卖点", startup.volume1.coreHook],
      ["主角当前状态", startup.volume1.protagonistState],
      ["阶段目标", startup.volume1.goal],
      ["非做不可", startup.volume1.stakes],
      ["阻力/敌人", startup.volume1.opposition],
      ["开头切入", startup.volume1.opening],
      ["卷末状态", startup.volume1.endingState],
      ["悬念", startup.volume1.suspense],
    ]),
    "",
    "已接受为当前事实的候选：",
    ...formatCandidatePromptLines(accepted, "暂无。"),
    "",
    "仍需处理的缺口/冲突/待定项：",
    ...formatCandidatePromptLines(unresolved, "暂无。"),
    "",
    "已拒绝或不满意、不要直接采用的内容：",
    ...formatCandidatePromptLines(rejected, "暂无。"),
    "",
    "近 10 章问题链草稿：",
    ...(chapterLines.length ? chapterLines.map((line) => `- ${line}`) : ["- 暂无。"]),
    "",
    "我接下来希望你做：",
    "1. 先指出当前第一卷还缺什么、哪里冲突、哪里只是名单不是情节。",
    "2. 针对缺口给 3-5 个可选方案，每个方案都要说明优缺点。",
    "3. 把人物/势力改成“立场 → 欲望 → 阻止主角的具体方式 → 第一次冲突场景 → 升级链条”。",
    "4. 保留我已经接受的事实；如果必须推翻，请明确说明原因。",
    "5. 最后给一版更清晰的第一卷启动稿和最近 10 章问题链。",
  ].join("\n");
}

export function CreativeBookCreate({
  nav,
  theme,
  t,
}: {
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
}) {
  const c = useColors(theme);
  const platformChoices = platformOptionsForLanguage(LANGUAGE);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [roundCount, setRoundCount] = useState(0);
  const [sourceName, setSourceName] = useState("Gemini 官网");
  const [pasteText, setPasteText] = useState("");
  const [candidates, setCandidates] = useState<ReadonlyArray<Candidate>>([]);
  const [startup, setStartup] = useState<FirstVolumeStartup>(() => defaultStartup());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"saving" | "analyzing" | "review" | "creating" | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<DraftResponse>("/creative-drafts/latest")
      .then((result) => {
        if (cancelled) return;
        if (result.draft) {
          loadDraftIntoState(result.draft);
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groupedCandidates = useMemo(
    () => (Object.keys(KIND_LABELS) as CandidateKind[]).map((kind) => ({
      kind,
      items: candidates.filter((candidate) => candidate.kind === kind),
    })).filter((group) => group.items.length > 0),
    [candidates],
  );

  const acceptedCount = candidates.filter((candidate) => candidate.status === "accepted").length;
  const pendingCount = candidates.filter((candidate) => candidate.status === "pending").length;
  const rejectedCount = candidates.filter((candidate) => candidate.status === "rejected").length;
  const ready = isStartupReady(startup) && Boolean(draftId || pasteText.trim());

  const loadDraftIntoState = (draft: CreativeDraft) => {
    setDraftId(draft.id);
    setRoundCount(draft.rounds?.length ?? 0);
    setSourceName(draft.sourceName || "Gemini 官网");
    setPasteText(draft.text ?? "");
    const activeRound = draft.rounds?.find((round) => round.id === draft.activeRoundId) ?? draft.rounds?.[draft.rounds.length - 1];
    const currentAnalysis = activeRound?.snapshot ?? activeRound?.analysis ?? draft.snapshot ?? draft.analysis;
    setCandidates(currentAnalysis?.candidates ?? []);
    setStartup(currentAnalysis?.startup ?? defaultStartup());
    setStatus(currentAnalysis
      ? `已加载最近的建书前草稿和整理结果，共 ${draft.rounds?.length ?? 0} 轮。`
      : "已加载最近的建书前草稿。");
  };

  const persistDraft = async (): Promise<CreativeDraft> => {
    const draft = await fetchJson<{ draft: CreativeDraft }>("/creative-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId, sourceName, text: pasteText }),
    });
    loadDraftIntoState(draft.draft);
    return draft.draft;
  };

  const handleSaveDraft = async () => {
    if (!pasteText.trim()) return;
    setBusy("saving");
    setError(null);
    setStatus("");
    try {
      await persistDraft();
      setStatus("草稿已保存到项目级草稿区。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const handleAnalyze = async () => {
    if (!pasteText.trim()) return;
    setBusy("analyzing");
    setError(null);
    setStatus("正在调用 DeepSeek 整理粘贴内容...");
    try {
      const saved = await persistDraft();
      const result = await fetchJson<AnalyzeResponse>(`/creative-drafts/${encodeURIComponent(saved.id)}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceName, text: pasteText }),
      });
      loadDraftIntoState(result.draft);
      setStatus(`整理完成：${result.analysis.candidates.length} 条候选，模型 ${result.analysis.model ?? "默认模型"}。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("");
    } finally {
      setBusy(null);
    }
  };

  const handleSaveReview = async () => {
    if (!draftId) {
      await handleSaveDraft();
      return;
    }
    setBusy("review");
    setError(null);
    try {
      const result = await fetchJson<AnalyzeResponse>(`/creative-drafts/${encodeURIComponent(draftId)}/analysis`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            candidates,
            startup,
          },
        }),
      });
      loadDraftIntoState(result.draft);
      setStatus("审核状态和第一卷启动稿已保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const handleBuildGeminiPrompt = () => {
    const prompt = buildCurrentSituationGeminiPrompt(startup, candidates);
    setStartup((current) => ({
      ...current,
      followups: {
        ...current.followups,
        geminiPrompt: prompt,
      },
    }));
    setStatus("已生成当前情况提示词，可直接发给 Gemini。");
  };

  const handleCreateBook = async () => {
    if (!ready) return;
    setBusy("creating");
    setError(null);
    setStatus("正在创建书籍骨架...");
    try {
      const saved = draftId ? null : await persistDraft();
      const id = draftId ?? saved!.id;
      await handleSaveReviewForDraft(id);
      const result = await fetchJson<CreateBookResponse>(`/creative-drafts/${encodeURIComponent(id)}/create-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startup, candidates }),
      });
      nav.toWorkbench(result.bookId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("");
    } finally {
      setBusy(null);
    }
  };

  const handleSaveReviewForDraft = async (id: string) => {
    await fetchJson(`/creative-drafts/${encodeURIComponent(id)}/analysis`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        analysis: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          candidates,
          startup,
        },
      }),
    });
  };

  const updateCandidate = (candidateId: string, patch: Partial<Candidate>) => {
    setCandidates((current) =>
      current.map((candidate) => candidate.id === candidateId ? { ...candidate, ...patch } : candidate),
    );
  };

  const acceptCandidate = (candidate: Candidate) => {
    const accepted = { ...candidate, status: "accepted" as const };
    setCandidates((current) => current.map((item) => item.id === candidate.id ? accepted : item));
    setStartup((current) => applyCandidateToStartup(current, accepted));
  };

  const redoCandidate = (candidate: Candidate) => {
    const rejected = { ...candidate, status: "rejected" as const };
    setCandidates((current) => current.map((item) => item.id === candidate.id ? rejected : item));
    setStartup((current) => {
      const prompt = buildCandidateRedoPrompt(rejected, current);
      return {
        ...current,
        followups: {
          ...current.followups,
          geminiPrompt: current.followups.geminiPrompt.trim()
            ? `${current.followups.geminiPrompt.trim()}\n\n---\n\n${prompt}`
            : prompt,
        },
      };
    });
    setStatus("已把这条候选转成 Gemini 重做提示词。");
  };

  const updateStartup = (path: string, value: string | number) => {
    setStartup((current) => setStartupPath(current, path, value));
  };

  const updateChapter = (index: number, patch: Partial<ChapterBeat>) => {
    setStartup((current) => ({
      ...current,
      chapters: current.chapters.map((chapter, itemIndex) =>
        itemIndex === index ? { ...chapter, ...patch } : chapter,
      ),
    }));
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        正在读取建书前草稿...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>首页</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("bread.newBook")}</span>
      </nav>

      <header className="border-b border-border/40 pb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-serif text-4xl">粘贴优先创建书籍</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
              先把 Gemini 官网内容放进草稿区，手动调用 DeepSeek 整理，再由你确认第一卷启动稿后创建书籍。
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground">
            <Metric label="字数" value={pasteText.trim().length} />
            <Metric label="轮次" value={roundCount} />
            <Metric label="接受" value={acceptedCount} />
            <Metric label="待定" value={pendingCount} />
            <Metric label="拒绝" value={rejectedCount} />
          </div>
        </div>
      </header>

      {error && <div className={`rounded-lg border px-4 py-3 text-sm ${c.error}`}>{error}</div>}
      {status && <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{status}</div>}

      <section className={`rounded-lg border ${c.cardStatic} bg-card/70 p-5 shadow-sm`}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <ClipboardPaste size={16} className="text-primary" />
            粘贴收件箱
          </div>
          <div className="text-xs text-muted-foreground">{draftId ? `草稿 ${draftId}` : "尚未保存草稿"}</div>
        </div>
        <div className="grid gap-3 lg:grid-cols-[180px_1fr]">
          <input
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            className={inputClass(c.input)}
            placeholder="来源"
          />
          <textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            rows={12}
            className={textareaClass(c.input, "font-mono")}
            placeholder="把 Gemini 官网里已经聊出来的混合内容粘贴到这里。可以是构思、大纲、人设、正文、修改建议或提示词。"
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={handleSaveDraft}
            disabled={!pasteText.trim() || Boolean(busy)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${c.btnSecondary} disabled:opacity-40`}
          >
            <Save size={15} />
            {busy === "saving" ? "保存中..." : "保存草稿"}
          </button>
          <button
            onClick={handleAnalyze}
            disabled={!pasteText.trim() || Boolean(busy)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
          >
            {busy === "analyzing" ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {busy === "analyzing" ? "整理中..." : "智能整理"}
          </button>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(480px,1.05fr)]">
        <section className={`rounded-lg border ${c.cardStatic} bg-card/70 p-5 shadow-sm`}>
          <div className="mb-4 flex items-center gap-2 text-sm font-bold">
            <FileText size={16} className="text-primary" />
            候选审核
          </div>
          <div className="space-y-4">
            {groupedCandidates.length === 0 && (
              <div className="rounded-lg border border-dashed border-border/70 p-6 text-sm leading-7 text-muted-foreground">
                保存草稿后点击智能整理，这里会出现可接受、编辑、拒绝、标待定的候选信息。
              </div>
            )}
            {groupedCandidates.map((group) => (
              <div key={group.kind} className="space-y-3">
                <div className="text-xs font-bold uppercase text-muted-foreground">{KIND_LABELS[group.kind]}</div>
                {group.items.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    c={c}
                    onChange={(patch) => updateCandidate(candidate.id, patch)}
                    onAccept={() => acceptCandidate(candidate)}
                    onReject={() => updateCandidate(candidate.id, { status: "rejected" })}
                    onRedo={() => redoCandidate(candidate)}
                    onPending={() => updateCandidate(candidate.id, { status: "pending" })}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className={`rounded-lg border ${c.cardStatic} bg-card/70 p-5 shadow-sm`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold">
              <BookPlus size={16} className="text-primary" />
              第一卷启动稿
            </div>
            <button
              onClick={handleSaveReview}
              disabled={Boolean(busy) || !draftId}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold ${c.btnSecondary} disabled:opacity-40`}
            >
              <Save size={14} />
              {busy === "review" ? "保存中..." : "保存审核"}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="书名">
              <input
                value={startup.book.title}
                onChange={(event) => updateStartup("book.title", event.target.value)}
                className={inputClass(c.input)}
              />
            </Field>
            <Field label="题材">
              <input
                value={startup.book.genre}
                onChange={(event) => updateStartup("book.genre", event.target.value)}
                className={inputClass(c.input)}
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="平台">
              <select
                value={startup.book.platform}
                onChange={(event) =>
                  updateStartup("book.platform", pickValidValue(event.target.value, platformChoices.map((item) => item.value)))}
                className={inputClass(c.input, "bg-background")}
              >
                {platformChoices.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="目标章节">
              <input
                type="number"
                min={1}
                value={startup.book.targetChapters}
                onChange={(event) => updateStartup("book.targetChapters", parsePositiveInteger(event.target.value, 200))}
                className={inputClass(c.input)}
              />
            </Field>
            <Field label="每章字数">
              <input
                type="number"
                min={1000}
                value={startup.book.chapterWordCount}
                onChange={(event) => updateStartup("book.chapterWordCount", parsePositiveInteger(event.target.value, 3000))}
                className={inputClass(c.input)}
              />
            </Field>
          </div>

          <Field label="简介 / 核心前提" className="mt-4">
            <textarea
              value={startup.book.blurb}
              onChange={(event) => updateStartup("book.blurb", event.target.value)}
              rows={3}
              className={textareaClass(c.input)}
            />
          </Field>

          <SectionTitle title="整书稳定项" />
          <div className="grid gap-4 md:grid-cols-2">
            <TextAreaField label="核心前提" value={startup.stable.premise} path="stable.premise" update={updateStartup} c={c} />
            <TextAreaField label="主角长期核心" value={startup.stable.protagonist} path="stable.protagonist" update={updateStartup} c={c} />
            <TextAreaField label="长期目标" value={startup.stable.longTermGoal} path="stable.longTermGoal" update={updateStartup} c={c} />
            <TextAreaField label="文风/节奏" value={startup.stable.style} path="stable.style" update={updateStartup} c={c} />
            <TextAreaField label="禁忌/边界" value={startup.stable.prohibitions} path="stable.prohibitions" update={updateStartup} c={c} />
          </div>

          <SectionTitle title="第一卷" />
          <div className="grid gap-4 md:grid-cols-2">
            <TextAreaField label="第一卷卖点" value={startup.volume1.coreHook} path="volume1.coreHook" update={updateStartup} c={c} />
            <TextAreaField label="主角当前状态" value={startup.volume1.protagonistState} path="volume1.protagonistState" update={updateStartup} c={c} />
            <TextAreaField label="阶段目标" value={startup.volume1.goal} path="volume1.goal" update={updateStartup} c={c} />
            <TextAreaField label="非做不可" value={startup.volume1.stakes} path="volume1.stakes" update={updateStartup} c={c} />
            <TextAreaField label="阻力/敌人" value={startup.volume1.opposition} path="volume1.opposition" update={updateStartup} c={c} />
            <TextAreaField label="开头切入" value={startup.volume1.opening} path="volume1.opening" update={updateStartup} c={c} />
            <TextAreaField label="卷末状态" value={startup.volume1.endingState} path="volume1.endingState" update={updateStartup} c={c} />
            <TextAreaField label="悬念" value={startup.volume1.suspense} path="volume1.suspense" update={updateStartup} c={c} />
          </div>

          <SectionTitle title="近 10 章问题链" />
          <div className="space-y-3">
            {startup.chapters.map((chapter, index) => (
              <details key={chapter.index} className="rounded-lg border border-border/60 bg-secondary/20 p-3" open={index < 2}>
                <summary className="cursor-pointer text-sm font-bold">
                  第 {chapter.index} 章 {chapter.title || "待定"}
                </summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Field label="标题">
                    <input
                      value={chapter.title}
                      onChange={(event) => updateChapter(index, { title: event.target.value })}
                      className={inputClass(c.input)}
                    />
                  </Field>
                  <ChapterField label="问题" value={chapter.problem} update={(value) => updateChapter(index, { problem: value })} c={c} />
                  <ChapterField label="行动" value={chapter.action} update={(value) => updateChapter(index, { action: value })} c={c} />
                  <ChapterField label="阻力" value={chapter.obstacle} update={(value) => updateChapter(index, { obstacle: value })} c={c} />
                  <ChapterField label="反转/代价" value={chapter.turn} update={(value) => updateChapter(index, { turn: value })} c={c} />
                  <ChapterField label="结果" value={chapter.result} update={(value) => updateChapter(index, { result: value })} c={c} />
                  <ChapterField label="结尾钩子" value={chapter.hook} update={(value) => updateChapter(index, { hook: value })} c={c} />
                </div>
              </details>
            ))}
          </div>

          <SectionTitle title="追问 / Gemini 提示词" />
          <Field label="追问">
            <textarea
              value={startup.followups.questions.join("\n")}
              onChange={(event) => updateStartup("followups.questions", event.target.value)}
              rows={4}
              className={textareaClass(c.input)}
            />
          </Field>
          <Field label="可复制给 Gemini 的提示词" className="mt-4">
            <div className="relative">
              <textarea
                value={startup.followups.geminiPrompt}
                onChange={(event) => updateStartup("followups.geminiPrompt", event.target.value)}
                rows={6}
                className={textareaClass(c.input)}
              />
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(startup.followups.geminiPrompt)}
                className={`absolute right-2 top-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${c.btnSecondary}`}
              >
                <Copy size={13} />
                复制
              </button>
            </div>
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleBuildGeminiPrompt}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs font-bold ${c.btnSecondary}`}
            >
              <MessageSquarePlus size={13} />
              生成当前情况提示词
            </button>
          </div>
        </section>
      </div>

      <div className="sticky bottom-0 -mx-6 border-t border-border/50 bg-background/90 px-6 py-4 backdrop-blur md:-mx-12 md:px-12">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs leading-6 text-muted-foreground">
            创建时只写入你右侧确认过的第一卷启动稿；冲突、缺口和待定候选不会自动成为权威设定。
          </div>
          <button
            onClick={handleCreateBook}
            disabled={!ready || Boolean(busy)}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
          >
            <BookPlus size={16} />
            {busy === "creating" ? "创建中..." : "确认创建并进入工作台"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  c,
  onChange,
  onAccept,
  onReject,
  onRedo,
  onPending,
}: {
  readonly candidate: Candidate;
  readonly c: ReturnType<typeof useColors>;
  readonly onChange: (patch: Partial<Candidate>) => void;
  readonly onAccept: () => void;
  readonly onReject: () => void;
  readonly onRedo: () => void;
  readonly onPending: () => void;
}) {
  return (
    <article className="rounded-lg border border-border/60 bg-background/45 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${KIND_STYLES[candidate.kind]}`}>
            {KIND_LABELS[candidate.kind]}
          </span>
          <span className="text-sm font-bold">{candidate.label}</span>
          <span className="text-xs text-muted-foreground">{TARGET_LABELS[candidate.targetPath] ?? candidate.targetPath}</span>
        </div>
        <span className="text-xs text-muted-foreground">{statusLabel(candidate.status)}</span>
      </div>
      <textarea
        value={candidate.value}
        onChange={(event) => onChange({ value: event.target.value })}
        rows={3}
        className={textareaClass(c.input)}
      />
      {candidate.evidence && (
        <div className="mt-2 rounded-md bg-secondary/30 px-3 py-2 text-xs leading-6 text-muted-foreground">
          {candidate.evidence}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onAccept} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold ${c.btnSecondary}`}>
          <Check size={13} />
          接受
        </button>
        <button onClick={onPending} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold ${c.btnSecondary}`}>
          <RefreshCw size={13} />
          待定
        </button>
        <button onClick={onReject} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold ${c.btnSecondary}`}>
          <X size={13} />
          拒绝
        </button>
        <button onClick={onRedo} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold ${c.btnSecondary}`}>
          <MessageSquarePlus size={13} />
          重做提示词
        </button>
      </div>
    </article>
  );
}

function TextAreaField({
  label,
  value,
  path,
  update,
  c,
}: {
  readonly label: string;
  readonly value: string;
  readonly path: string;
  readonly update: (path: string, value: string) => void;
  readonly c: ReturnType<typeof useColors>;
}) {
  return (
    <Field label={label}>
      <textarea
        value={value}
        onChange={(event) => update(path, event.target.value)}
        rows={3}
        className={textareaClass(c.input)}
      />
    </Field>
  );
}

function ChapterField({
  label,
  value,
  update,
  c,
}: {
  readonly label: string;
  readonly value: string;
  readonly update: (value: string) => void;
  readonly c: ReturnType<typeof useColors>;
}) {
  return (
    <Field label={label}>
      <textarea
        value={value}
        onChange={(event) => update(event.target.value)}
        rows={2}
        className={textareaClass(c.input)}
      />
    </Field>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <label className={`block space-y-2 ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ title }: { readonly title: string }) {
  return <div className="mb-3 mt-6 border-t border-border/50 pt-5 text-sm font-bold">{title}</div>;
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card px-3 py-2 text-center">
      <div className="text-lg font-bold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function inputClass(base: string, extra = ""): string {
  return `w-full rounded-lg px-3 py-2.5 text-sm outline-none ${base} ${extra}`;
}

function textareaClass(base: string, extra = ""): string {
  return `w-full resize-y rounded-lg px-3 py-3 text-sm leading-7 outline-none ${base} ${extra}`;
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function statusLabel(status: CandidateStatus): string {
  if (status === "accepted") return "已接受";
  if (status === "rejected") return "已拒绝";
  return "待定";
}

function formatPromptLines(entries: ReadonlyArray<[string, string]>): string[] {
  return entries
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `- ${label}：${value}`);
}

function formatCandidatePromptLines(candidates: ReadonlyArray<Candidate>, fallback: string): string[] {
  if (candidates.length === 0) return [fallback];
  return candidates.map((candidate) => [
    `- ${candidate.label || TARGET_LABELS[candidate.targetPath] || candidate.targetPath}`,
    `  - 类型：${KIND_LABELS[candidate.kind]}`,
    `  - 位置：${TARGET_LABELS[candidate.targetPath] ?? candidate.targetPath}`,
    `  - 内容：${candidate.value || "暂无"}`,
    candidate.evidence ? `  - 证据：${candidate.evidence}` : "",
  ].filter(Boolean).join("\n"));
}

function setStartupPath(startup: FirstVolumeStartup, path: string, rawValue: string | number): FirstVolumeStartup {
  const value = typeof rawValue === "number" ? rawValue : rawValue.trim();
  if (path === "followups.questions") {
    return {
      ...startup,
      followups: {
        ...startup.followups,
        questions: String(rawValue).split(/\r?\n/u).map((item) => item.trim()).filter(Boolean),
      },
    };
  }

  const [section, key, chapterKey] = path.split(".");
  if (section === "book" && key && key in startup.book) {
    return {
      ...startup,
      book: {
        ...startup.book,
        [key]: key === "targetChapters" || key === "chapterWordCount"
          ? Number(value) || startup.book[key as "targetChapters" | "chapterWordCount"]
          : value,
      },
    };
  }
  if (section === "stable" && key && key in startup.stable) {
    return { ...startup, stable: { ...startup.stable, [key]: String(value) } };
  }
  if (section === "volume1" && key && key in startup.volume1) {
    return { ...startup, volume1: { ...startup.volume1, [key]: String(value) } };
  }
  if (section === "followups" && key === "geminiPrompt") {
    return { ...startup, followups: { ...startup.followups, geminiPrompt: String(value) } };
  }
  if (section === "chapters" && key && chapterKey) {
    const index = Number.parseInt(key, 10) - 1;
    if (index >= 0 && index < startup.chapters.length) {
      return {
        ...startup,
        chapters: startup.chapters.map((chapter, itemIndex) =>
          itemIndex === index ? { ...chapter, [chapterKey]: String(value) } : chapter,
        ),
      };
    }
  }
  return startup;
}
