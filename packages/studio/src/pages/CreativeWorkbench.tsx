import { useEffect, useMemo, useState } from "react";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import {
  Archive,
  BookOpen,
  Check,
  ChevronLeft,
  Clipboard,
  ClipboardPaste,
  Edit3,
  Eye,
  History,
  HelpCircle,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  X,
} from "lucide-react";

type WorkbenchBlockKind =
  | "concept"
  | "outline"
  | "character"
  | "world"
  | "chapter"
  | "revision"
  | "prompt"
  | "note";

type WorkbenchSaveTarget = "note" | "prompt" | "material" | "version" | "chapter" | "setting";
type WorkbenchStatus = "raw_saved" | "organized" | "applied" | "archived";
type WorkbenchActionType = "draft" | "setting" | "decision" | "prompt";
type WorkbenchActionStatus = "pending" | "accepted" | "rejected" | "deferred";
type BusyState = "paste" | "organize" | "action" | "chapter" | "archive" | "advisor" | "advisor-plan" | null;
type RightPanelMode = "actions" | "advisor";

interface WorkbenchBlock {
  readonly id: string;
  readonly kind: WorkbenchBlockKind;
  readonly title: string;
  readonly content: string;
  readonly confidence: number;
  readonly charCount: number;
}

interface WorkbenchActionItem {
  readonly id: string;
  readonly type: WorkbenchActionType;
  readonly title: string;
  readonly sourceEvidence: string;
  readonly status: WorkbenchActionStatus;
  readonly payload: Record<string, unknown>;
}

interface WorkbenchActionPlan {
  readonly status: WorkbenchStatus;
  readonly updatedAt: string;
  readonly model?: string;
  readonly targetChapter: number;
  readonly summary: string;
  readonly items: ReadonlyArray<WorkbenchActionItem>;
  readonly nextPrompt: string;
  readonly rawBlockCount: number;
  readonly hiddenBlockCount: number;
}

interface WorkbenchEntry {
  readonly id: string;
  readonly sourceName: string;
  readonly createdAt: string;
  readonly rawPath: string;
  readonly analysisPath: string;
  readonly rawCharCount: number;
  readonly rawText: string;
  readonly blocks: ReadonlyArray<WorkbenchBlock>;
  readonly actionPlan: WorkbenchActionPlan;
}

interface WorkbenchEntrySummary {
  readonly id: string;
  readonly sourceName: string;
  readonly createdAt: string;
  readonly rawPath: string;
  readonly rawCharCount: number;
  readonly blockCount: number;
  readonly status: WorkbenchStatus;
  readonly kinds: ReadonlyArray<WorkbenchBlockKind>;
  readonly preview: string;
}

interface SaveResult {
  readonly ok: true;
  readonly target: WorkbenchSaveTarget;
  readonly path: string;
  readonly chapterNumber?: number;
  readonly title: string;
}

interface ChapterDraftData {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

interface ChapterPromptData {
  readonly targetChapter: number;
  readonly prompt: string;
  readonly generatedAt: string;
}

interface WorkbenchAdvisorContextRef {
  readonly file: string;
  readonly label: string;
  readonly excerpt: string;
}

interface WorkbenchAdvisorMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly contextRefs?: ReadonlyArray<WorkbenchAdvisorContextRef>;
}

interface WorkbenchAdvisorThread {
  readonly id: string;
  readonly bookId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: ReadonlyArray<WorkbenchAdvisorMessage>;
}

interface BookData {
  readonly nextChapter: number;
  readonly chapters: ReadonlyArray<{
    readonly number: number;
    readonly title: string;
    readonly status: string;
    readonly wordCount: number;
  }>;
}

interface Nav {
  readonly toBook: (id: string) => void;
  readonly toDashboard: () => void;
  readonly toChapter: (bookId: string, chapterNumber: number) => void;
}

const STATUS_LABELS: Record<WorkbenchStatus, string> = {
  raw_saved: "待整理",
  organized: "已整理",
  applied: "已应用",
  archived: "已归档",
};

const ACTION_STATUS_LABELS: Record<WorkbenchActionStatus, string> = {
  pending: "待处理",
  accepted: "已接受",
  rejected: "已拒绝",
  deferred: "已搁置",
};

const ACTION_TYPE_LABELS: Record<WorkbenchActionType, string> = {
  draft: "正文",
  setting: "设定",
  decision: "拍板",
  prompt: "追问",
};

export function CreativeWorkbench({
  bookId,
  nav,
  theme,
  t: _t,
}: {
  readonly bookId: string;
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
}) {
  const c = useColors(theme);
  const { data, refetch } = useApi<{ entries: ReadonlyArray<WorkbenchEntrySummary> }>(`/books/${bookId}/workbench`);
  const { data: bookData, refetch: refetchBook } = useApi<BookData>(`/books/${bookId}`);
  const entries = data?.entries ?? [];
  const activeEntries = entries.filter((entry) => entry.status !== "archived");
  const archivedEntries = entries.filter((entry) => entry.status === "archived");
  const targetChapter = pickWorkbenchTargetChapter(bookData);

  const [sourceName, setSourceName] = useState("Gemini");
  const [pasteText, setPasteText] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<WorkbenchEntry | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [chapterLoaded, setChapterLoaded] = useState<number | null>(null);
  const [chapterExists, setChapterExists] = useState(false);
  const [chapterPrompt, setChapterPrompt] = useState("");
  const [chapterPromptVisible, setChapterPromptVisible] = useState(false);
  const [chapterPromptInstruction, setChapterPromptInstruction] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [showRawBlocks, setShowRawBlocks] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("actions");
  const [advisorThread, setAdvisorThread] = useState<WorkbenchAdvisorThread | null>(null);
  const [advisorInput, setAdvisorInput] = useState("");
  const [busy, setBusy] = useState<BusyState>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!selectedEntryId && activeEntries[0]) {
      setSelectedEntryId(activeEntries[0].id);
    }
  }, [activeEntries, selectedEntryId]);

  useEffect(() => {
    if (!selectedEntryId) {
      setSelectedEntry(null);
      return;
    }
    let cancelled = false;
    fetchJson<{ entry: WorkbenchEntry }>(`/books/${bookId}/workbench/${selectedEntryId}`)
      .then((result) => {
        if (cancelled) return;
        loadEntry(result.entry);
      })
      .catch((e) => {
        if (!cancelled) setStatus(`读取失败：${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, selectedEntryId]);

  useEffect(() => {
    let cancelled = false;
    setChapterLoaded(null);
    setChapterExists(false);
    fetchJson<ChapterDraftData>(`/books/${bookId}/chapters/${targetChapter}`)
      .then((chapter) => {
        if (cancelled) return;
        const parsed = splitChapterMarkdown(chapter.content, targetChapter);
        setDraftTitle(parsed.title);
        setDraftContent(parsed.content);
        setChapterLoaded(targetChapter);
        setChapterExists(true);
      })
      .catch(() => {
        if (cancelled) return;
        setDraftTitle("");
        setDraftContent("");
        setChapterLoaded(targetChapter);
        setChapterExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, targetChapter]);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ thread: WorkbenchAdvisorThread | null }>(`/books/${bookId}/workbench/advisor/latest`)
      .then((result) => {
        if (!cancelled) {
          setAdvisorThread(result.thread);
        }
      })
      .catch((e) => {
        if (!cancelled) setStatus(`读取顾问对话失败：${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const selectedSummary = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId) ?? null,
    [entries, selectedEntryId],
  );
  const actionPlan = selectedEntry?.actionPlan ?? null;
  const pendingActionCount = actionPlan?.items.filter((item) => item.status === "pending").length ?? 0;
  const decisionCount = actionPlan?.items.filter((item) => item.type === "decision" && item.status === "pending").length ?? 0;

  function loadEntry(entry: WorkbenchEntry) {
    setSelectedEntry(entry);
    setShowRawBlocks(false);
    setStatus("");
  }

  const refreshSelectedEntry = async (entryId = selectedEntryId) => {
    if (!entryId) return null;
    const result = await fetchJson<{ entry: WorkbenchEntry }>(`/books/${bookId}/workbench/${entryId}`);
    loadEntry(result.entry);
    return result.entry;
  };

  const handlePaste = async () => {
    if (!pasteText.trim()) return;
    setBusy("paste");
    setStatus("");
    try {
      const result = await fetchJson<{ entry: WorkbenchEntry }>(`/books/${bookId}/workbench/paste`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText, sourceName }),
      });
      setPasteText("");
      await refetch();
      setSelectedEntryId(result.entry.id);
      loadEntry(result.entry);
      setStatus("已保存原文。还没有调用 DeepSeek，点“智能整理”后才生成行动单。");
    } catch (e) {
      setStatus(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleOrganize = async () => {
    if (!selectedEntry) return;
    setBusy("organize");
    setStatus("正在调用 DeepSeek 对照当前共识生成行动单...");
    try {
      const result = await fetchJson<{ entry: WorkbenchEntry; actionPlan: WorkbenchActionPlan }>(
        `/books/${bookId}/workbench/${selectedEntry.id}/organize`,
        { method: "POST" },
      );
      await refetch();
      loadEntry(result.entry);
      setStatus("行动单已生成。右侧只保留需要你处理的事项。");
    } catch (e) {
      setStatus(`整理失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const persistActionPlan = async (nextPlan: WorkbenchActionPlan) => {
    if (!selectedEntry) return null;
    setBusy("action");
    const result = await fetchJson<{ entry: WorkbenchEntry; actionPlan: WorkbenchActionPlan }>(
      `/books/${bookId}/workbench/${selectedEntry.id}/action-plan`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionPlan: nextPlan }),
      },
    );
    await refetch();
    loadEntry(result.entry);
    setBusy(null);
    return result.entry;
  };

  const applyAction = async (
    action: WorkbenchActionItem,
    operation: "accept" | "reject" | "defer" | "keep_current" | "adopt_new" | "manual",
    extra: { readonly content?: string; readonly targetFile?: string; readonly prompt?: string } = {},
  ) => {
    if (!selectedEntry || !actionPlan) return;
    if (action.type === "draft" && operation === "accept") {
      const content = extra.content ?? stringPayload(action, "content");
      if (content.trim()) {
        setDraftContent(content);
      }
      const title = action.title.trim();
      if (title) {
        setDraftTitle(title);
      }
      await persistActionPlan(updateActionInPlan(actionPlan, action.id, {
        status: "accepted",
        payload: {
          ...action.payload,
          content,
          appliedToEditorAt: new Date().toISOString(),
        },
        statusOverride: "applied",
      }));
      setStatus("已应用到章节编辑器。章节文件还没保存，点“保存章节”才会落盘。");
      return;
    }

    if (action.type === "prompt" && operation === "accept") {
      const prompt = (extra.prompt ?? stringPayload(action, "content")) || actionPlan.nextPrompt;
      await navigator.clipboard.writeText(prompt);
      await persistActionPlan(updateActionInPlan(actionPlan, action.id, {
        status: "accepted",
        payload: {
          ...action.payload,
          content: prompt,
          copiedAt: new Date().toISOString(),
        },
      }));
      setStatus("已复制追问提示词，可以发给 Gemini。");
      return;
    }

    setBusy("action");
    try {
      const result = await fetchJson<{ entry: WorkbenchEntry; actionPlan: WorkbenchActionPlan }>(
        `/books/${bookId}/workbench/${selectedEntry.id}/actions/${action.id}/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation,
            content: extra.content,
            targetFile: extra.targetFile,
            prompt: extra.prompt,
          }),
        },
      );
      await refetch();
      loadEntry(result.entry);
      setStatus(statusForAppliedAction(action, operation));
    } catch (e) {
      setStatus(`操作失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleRejectAction = async (action: WorkbenchActionItem) => {
    if (!actionPlan) return;
    await persistActionPlan(updateActionInPlan(actionPlan, action.id, { status: "rejected" }));
    setStatus("已拒绝这一项，不会写入权威文件。");
  };

  const handleAskGemini = async (action: WorkbenchActionItem) => {
    if (!actionPlan) return;
    const prompt = buildActionPrompt(action);
    await navigator.clipboard.writeText(prompt);
    await persistActionPlan(updateActionInPlan(actionPlan, action.id, {
      status: "deferred",
      payload: {
        ...action.payload,
        generatedPrompt: prompt,
      },
      nextPrompt: prompt,
    }));
    setStatus("已生成并复制追问 Gemini 的提示词。");
  };

  const handleSaveChapter = async () => {
    if (!draftContent.trim()) return;
    setBusy("chapter");
    setStatus("");
    try {
      const result = await saveWorkbenchTarget("chapter", {
        title: draftTitle || `第 ${targetChapter} 章草稿`,
        content: draftContent,
        kind: "chapter",
        chapterNumber: targetChapter,
      });
      await refetchBook();
      setChapterExists(true);
      if (result.chapterNumber) {
        const saveMessage = `章节已保存：第 ${result.chapterNumber} 章 ${result.title}`;
        if (selectedEntry && selectedEntry.actionPlan.status !== "archived" && isActionPlanHandled(selectedEntry.actionPlan)) {
          await fetchJson(`/books/${bookId}/workbench/${selectedEntry.id}/archive`, { method: "POST" });
          await refetch();
          setSelectedEntryId(null);
          setSelectedEntry(null);
          setStatus(`${saveMessage}。本轮行动已清空并归档。`);
        } else {
          setStatus(saveMessage);
        }
      }
    } catch (e) {
      setStatus(`保存章节失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleArchive = async () => {
    if (!selectedEntry) return;
    setBusy("archive");
    setStatus("");
    try {
      await fetchJson(`/books/${bookId}/workbench/${selectedEntry.id}/archive`, { method: "POST" });
      await refetch();
      setSelectedEntryId(null);
      setSelectedEntry(null);
      setStatus("本轮已完成并归档。");
    } catch (e) {
      setStatus(`归档失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleGenerateChapterPrompt = async () => {
    setBusy("action");
    setStatus("");
    try {
      const result = await fetchJson<ChapterPromptData>(`/books/${bookId}/workbench/chapter-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterNumber: targetChapter,
          draftTitle,
          draftContent,
          instruction: chapterPromptInstruction,
        }),
      });
      setChapterPrompt(result.prompt);
      setChapterPromptVisible(true);
      await navigator.clipboard.writeText(result.prompt);
      setStatus(`已生成第 ${result.targetChapter} 章 Gemini 提示词，并复制到剪贴板。`);
    } catch (e) {
      setStatus(`生成提示词失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleCopyChapterPrompt = async () => {
    if (!chapterPrompt.trim()) return;
    await navigator.clipboard.writeText(chapterPrompt);
    setStatus("已复制本章 Gemini 提示词。");
  };

  const handleAdvisorSend = async () => {
    if (!advisorInput.trim()) return;
    const message = advisorInput;
    setBusy("advisor");
    setStatus("正在让 DeepSeek 读取上下文并回复...");
    try {
      const result = await fetchJson<{ thread: WorkbenchAdvisorThread }>(`/books/${bookId}/workbench/advisor/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: advisorThread?.id, message }),
      });
      setAdvisorInput("");
      setAdvisorThread(result.thread);
      setRightPanelMode("advisor");
      setStatus("顾问已回复。对话只保存在工作台，不会写入设定或章节。");
    } catch (e) {
      setStatus(`顾问回复失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleAdvisorCreateActionPlan = async () => {
    if (!advisorThread) return;
    setBusy("advisor-plan");
    setStatus("正在把最近顾问对话整理成待确认行动项...");
    try {
      const result = await fetchJson<{ entry: WorkbenchEntry; actionPlan: WorkbenchActionPlan }>(
        `/books/${bookId}/workbench/advisor/${advisorThread.id}/action-plan`,
        { method: "POST" },
      );
      await refetch();
      setSelectedEntryId(result.entry.id);
      loadEntry(result.entry);
      setRightPanelMode("actions");
      setStatus("已生成待确认行动项。接受前不会写入设定或章节。");
    } catch (e) {
      setStatus(`整理成行动单失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const saveWorkbenchTarget = async (
    target: WorkbenchSaveTarget,
    payload: {
      readonly title: string;
      readonly content: string;
      readonly kind: WorkbenchBlockKind;
      readonly chapterNumber?: number;
    },
  ): Promise<SaveResult> => fetchJson<SaveResult>(`/books/${bookId}/workbench/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target,
      title: payload.title,
      content: payload.content,
      kind: payload.kind,
      sourceEntryId: selectedEntry?.id,
      chapterNumber: payload.chapterNumber,
    }),
  });

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>首页</button>
        <span className="text-border">/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">创作工作台</span>
      </nav>

      <header className="flex flex-col gap-4 border-b border-border/40 pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <button
            onClick={() => nav.toBook(bookId)}
            className="mb-3 inline-flex items-center gap-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft size={14} />
            返回书籍
          </button>
          <h1 className="font-serif text-4xl">当前章节创作台</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            中间永远是第 {targetChapter} 章正文。Gemini 粘贴内容只生成右侧一张行动单，原文和原始拆解只做追溯。
          </p>
        </div>
        <div className="space-y-3">
          <button
            onClick={handleGenerateChapterPrompt}
            disabled={busy !== null}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
          >
            {busy === "action" ? <RefreshCw size={15} className="animate-spin" /> : <Clipboard size={15} />}
            生成本章 Gemini 提示词
          </button>
          <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground">
            <Metric label="目标章" value={targetChapter} />
            <Metric label="待处理轮" value={activeEntries.length} />
            <Metric label="待处理项" value={pendingActionCount} />
            <Metric label="需拍板" value={decisionCount} />
          </div>
        </div>
      </header>

      <section className={`rounded-lg border ${c.cardStatic} bg-card/70 p-4 shadow-sm`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold">
            <ClipboardPaste size={16} className="text-primary" />
            新一轮 Gemini 内容
          </div>
          <div className="text-xs text-muted-foreground">保存原文不会调用 DeepSeek；智能整理才会生成行动单。</div>
        </div>
        <div className="grid gap-3 lg:grid-cols-[160px_1fr_auto] lg:items-start">
          <input
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
            placeholder="来源"
          />
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            className="min-h-24 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm leading-6 outline-none resize-y focus:border-primary/50"
            placeholder="粘贴 Gemini 官网生成的正文、改写、设定讨论或修改建议。"
          />
          <div className="flex flex-col gap-2">
            <button
              onClick={handlePaste}
              disabled={busy !== null || !pasteText.trim()}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
            >
              {busy === "paste" ? <RefreshCw size={15} className="animate-spin" /> : <Archive size={15} />}
              保存原文
            </button>
            <button
              onClick={handleOrganize}
              disabled={busy !== null || !selectedEntry || selectedEntry.actionPlan.status === "archived"}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${c.btnSecondary} disabled:opacity-40`}
            >
              {busy === "organize" ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
              智能整理
            </button>
            <button
              onClick={() => setRightPanelMode("advisor")}
              disabled={busy !== null}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background/60 px-4 py-2 text-sm font-bold hover:bg-secondary disabled:opacity-40"
            >
              <MessageCircle size={15} />
              和 DeepSeek 商量
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(520px,1fr)_420px]">
        <RoundTimeline
          entries={activeEntries}
          archivedEntries={archivedEntries}
          selectedEntryId={selectedEntryId}
          c={c}
          onSelect={setSelectedEntryId}
        />

        <section className={`min-h-[700px] rounded-lg border ${c.cardStatic} bg-card/70 p-4`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <PanelTitle icon={<BookOpen size={16} />} title={`第 ${targetChapter} 章正文草稿`} />
            <div className="flex flex-wrap gap-2">
              {selectedEntry && (
                <button
                  onClick={() => setShowRaw(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-bold hover:bg-secondary"
                >
                  <Eye size={13} />
                  查看原文
                </button>
              )}
              <button
                onClick={() => nav.toChapter(bookId, targetChapter)}
                disabled={!chapterExists}
                className="rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-bold hover:bg-secondary disabled:opacity-40"
              >
                打开章节编辑
              </button>
              <button
                onClick={handleSaveChapter}
                disabled={busy !== null || !draftContent.trim()}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold ${c.btnPrimary} disabled:opacity-40`}
              >
                <Save size={13} />
                保存章节
              </button>
            </div>
          </div>

          <div className="mb-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm font-bold outline-none focus:border-primary/50"
              placeholder={`第 ${targetChapter} 章标题`}
            />
            <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
              {selectedSummary
                ? `${STATUS_LABELS[selectedSummary.status]} · ${selectedSummary.rawCharCount.toLocaleString()} 字符原文`
                : chapterLoaded === targetChapter
                  ? chapterExists ? "章节草稿已载入" : "下一章草稿尚未落盘"
                  : "正在读取章节草稿"}
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-border/60 bg-secondary/20 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold">给 Gemini 的本章生成要求</div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleGenerateChapterPrompt}
                  disabled={busy !== null}
                  className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-bold ${c.btnSecondary} disabled:opacity-40`}
                >
                  {busy === "action" ? <RefreshCw size={13} className="animate-spin" /> : <Clipboard size={13} />}
                  生成本章提示词
                </button>
                {chapterPrompt && (
                  <button
                    onClick={() => setChapterPromptVisible((current) => !current)}
                    className="rounded-md border border-border bg-background/60 px-3 py-1.5 text-xs font-bold hover:bg-secondary"
                  >
                    {chapterPromptVisible ? "收起提示词" : "查看提示词"}
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={chapterPromptInstruction}
              onChange={(e) => setChapterPromptInstruction(e.target.value)}
              className="min-h-16 w-full rounded-md border border-border bg-background/60 px-3 py-2 text-xs leading-5 outline-none resize-y focus:border-primary/50"
              placeholder="可选：这次想让 Gemini 特别注意什么，比如加强压迫感、少写解释、多写动作、章末留钩子。"
            />
          </div>

          {chapterPromptVisible && (
            <div className="mb-4 rounded-lg border border-border/60 bg-background/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-bold">本章 Gemini 提示词</div>
                <button
                  onClick={() => void handleCopyChapterPrompt()}
                  disabled={!chapterPrompt.trim()}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1 text-xs font-bold hover:bg-secondary disabled:opacity-40"
                >
                  <Clipboard size={12} />
                  复制
                </button>
              </div>
              <textarea
                value={chapterPrompt}
                onChange={(e) => setChapterPrompt(e.target.value)}
                className="min-h-72 w-full rounded-md border border-border bg-secondary/30 px-3 py-3 font-mono text-xs leading-5 outline-none resize-y focus:border-primary/50"
                placeholder="点击“生成本章提示词”后，这里会出现可复制给 Gemini 官网的完整提示词。"
              />
            </div>
          )}

          <textarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            className="min-h-[500px] w-full rounded-lg border border-border bg-secondary/30 px-4 py-4 font-mono text-sm leading-7 outline-none resize-y focus:border-primary/50"
            placeholder="这里是当前章节正文草稿。可以直接写，也可以接受右侧正文行动项应用进来。"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {draftContent.trim().length.toLocaleString()} 字符 · {chapterExists ? "已有章节文件" : "尚未保存为章节"}
            </div>
            <div className="relative">
              <button
                onClick={() => setShowMore((current) => !current)}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-bold hover:bg-secondary"
              >
                <MoreHorizontal size={13} />
                更多
              </button>
              {showMore && (
                <div className="absolute bottom-full right-0 z-20 mb-2 w-44 rounded-lg border border-border bg-popover p-2 shadow-lg">
                  <MoreAction label="保存版本记录" onClick={() => void saveWorkbenchTarget("version", { title: draftTitle || "工作台版本", content: draftContent, kind: "revision" })} />
                  <MoreAction label="保存素材" onClick={() => void saveWorkbenchTarget("material", { title: draftTitle || "工作台素材", content: draftContent, kind: "note" })} />
                  <MoreAction label="保存笔记" onClick={() => void saveWorkbenchTarget("note", { title: draftTitle || "工作台笔记", content: draftContent, kind: "note" })} />
                  <MoreAction label="显示原始拆解" onClick={() => setShowRawBlocks((current) => !current)} />
                </div>
              )}
            </div>
          </div>

          {showRawBlocks && selectedEntry && (
            <RawBlocks entry={selectedEntry} />
          )}

          {status && (
            <div className={`mt-4 rounded-lg px-3 py-2 text-sm ${
              status.includes("失败") || status.includes("读取失败") || status.includes("操作失败")
                ? "bg-destructive/10 text-destructive"
                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            }`}>
              {status}
            </div>
          )}
        </section>

        <section className={`min-h-[700px] rounded-lg border ${c.cardStatic} bg-card/70 p-3`}>
          <div className="mb-3 grid grid-cols-2 rounded-lg border border-border bg-secondary/20 p-1 text-xs font-bold">
            <button
              onClick={() => setRightPanelMode("actions")}
              className={`rounded-md px-3 py-2 transition-colors ${rightPanelMode === "actions" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              行动单
            </button>
            <button
              onClick={() => setRightPanelMode("advisor")}
              className={`rounded-md px-3 py-2 transition-colors ${rightPanelMode === "advisor" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              顾问
            </button>
          </div>
          {rightPanelMode === "advisor" ? (
            <AdvisorPanel
              thread={advisorThread}
              input={advisorInput}
              busy={busy !== null}
              c={c}
              onInputChange={setAdvisorInput}
              onSend={() => void handleAdvisorSend()}
              onCreateActionPlan={() => void handleAdvisorCreateActionPlan()}
            />
          ) : (
            <ActionPlanPanel
              entry={selectedEntry}
              busy={busy !== null}
              onAccept={(action, content) => void applyAction(action, "accept", { content })}
              onReject={(action) => void handleRejectAction(action)}
              onAskGemini={(action) => void handleAskGemini(action)}
              onDecision={(action, operation, content) => void applyAction(action, operation, { content })}
              onSavePlan={(plan) => void persistActionPlan(plan)}
              onArchive={() => void handleArchive()}
            />
          )}
        </section>
      </div>

      {showRaw && selectedEntry && (
        <RawTextDrawer entry={selectedEntry} onClose={() => setShowRaw(false)} />
      )}
    </div>
  );
}

export function pickWorkbenchTargetChapter(data: BookData | null | undefined): number {
  if (!data) return 1;
  const actionable = [...data.chapters]
    .filter((chapter) => chapter.status !== "approved")
    .sort((a, b) => b.number - a.number)[0];
  return actionable?.number ?? data.nextChapter;
}

export function splitChapterMarkdown(content: string, chapterNumber: number): { readonly title: string; readonly content: string } {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const titleIndex = lines.findIndex((line) => /^\s*#\s+/.test(line));
  if (titleIndex === -1) {
    return { title: `第 ${chapterNumber} 章草稿`, content };
  }
  const titleLine = lines[titleIndex] ?? "";
  const title = titleLine
    .replace(/^\s*#\s+/u, "")
    .replace(/^第\s*[零〇一二三四五六七八九十百千万\d]+\s*章[:：\s]*/u, "")
    .trim()
    || `第 ${chapterNumber} 章草稿`;
  const body = [
    ...lines.slice(0, titleIndex),
    ...lines.slice(titleIndex + 1),
  ].join("\n").trim();
  return { title, content: body };
}

function RoundTimeline({
  entries,
  archivedEntries,
  selectedEntryId,
  c,
  onSelect,
}: {
  readonly entries: ReadonlyArray<WorkbenchEntrySummary>;
  readonly archivedEntries: ReadonlyArray<WorkbenchEntrySummary>;
  readonly selectedEntryId: string | null;
  readonly c: ReturnType<typeof useColors>;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <section className={`min-h-[700px] rounded-lg border ${c.cardStatic} bg-card/70 p-3`}>
      <PanelTitle icon={<History size={16} />} title="轮次" />
      <div className="space-y-2">
        {entries.map((entry) => (
          <RoundButton
            key={entry.id}
            entry={entry}
            active={selectedEntryId === entry.id}
            onClick={() => onSelect(entry.id)}
          />
        ))}
        {entries.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
            没有待处理轮次。
          </div>
        )}
      </div>

      {archivedEntries.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">归档</div>
          <div className="space-y-2">
            {archivedEntries.slice(0, 8).map((entry) => (
              <RoundButton
                key={entry.id}
                entry={entry}
                active={selectedEntryId === entry.id}
                muted
                onClick={() => onSelect(entry.id)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AdvisorPanel({
  thread,
  input,
  busy,
  c,
  onInputChange,
  onSend,
  onCreateActionPlan,
}: {
  readonly thread: WorkbenchAdvisorThread | null;
  readonly input: string;
  readonly busy: boolean;
  readonly c: ReturnType<typeof useColors>;
  readonly onInputChange: (value: string) => void;
  readonly onSend: () => void;
  readonly onCreateActionPlan: () => void;
}) {
  const messages = thread?.messages ?? [];
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const latestAssistant = assistantMessages.at(-1);

  return (
    <div className="flex min-h-[650px] flex-col gap-3">
      <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
        <div className="flex items-center gap-2 text-sm font-bold">
          <MessageCircle size={15} className="text-primary" />
          DeepSeek 顾问
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          用自然语言说你哪里不满意、想怎么改。顾问会先查书内上下文，只讨论，不自动写入文件。
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-border/60 bg-background/40 p-3">
        {messages.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm leading-6 text-muted-foreground">
            例如：第4章“长生秘密暴露”太直接，我觉得暂时只暴露外貌年轻没变过。请先查上下文，帮我判断该怎么改。
          </div>
        )}
        {messages.map((message) => (
          <AdvisorMessageBubble key={message.id} message={message} />
        ))}
      </div>

      {latestAssistant?.contextRefs?.length ? (
        <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
          <div className="mb-2 text-xs font-bold">已参考上下文</div>
          <div className="space-y-2">
            {latestAssistant.contextRefs.slice(0, 5).map((ref) => (
              <details key={`${ref.file}-${ref.label}`} className="rounded-md border border-border/60 bg-background/50 p-2">
                <summary className="cursor-pointer text-xs font-bold">
                  {ref.label}
                  <span className="ml-2 font-normal text-muted-foreground">{ref.file}</span>
                </summary>
                <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
                  {ref.excerpt}
                </p>
              </details>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          className="min-h-28 w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm leading-6 outline-none resize-y focus:border-primary/50"
          placeholder="直接说你的想法、疑问或不满。比如：第4章这个阻力太大了，我觉得现在只能暴露外貌异常，不能直接暴露长生。"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            onClick={onSend}
            disabled={busy || !input.trim()}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
          >
            {busy ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
            发送给 DeepSeek
          </button>
          <button
            onClick={onCreateActionPlan}
            disabled={busy || !latestAssistant}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${c.btnSecondary} disabled:opacity-40`}
          >
            {busy ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
            整理成待确认修改
          </button>
        </div>
      </div>
    </div>
  );
}

function AdvisorMessageBubble({ message }: { readonly message: WorkbenchAdvisorMessage }) {
  const isAssistant = message.role === "assistant";
  return (
    <div className={`rounded-lg border p-3 ${
      isAssistant
        ? "border-primary/20 bg-primary/5"
        : "border-border/60 bg-secondary/30"
    }`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-bold">{isAssistant ? "DeepSeek 顾问" : "你"}</div>
        <div className="text-[10px] text-muted-foreground">{formatDateTime(message.createdAt)}</div>
      </div>
      <div className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">{message.content}</div>
    </div>
  );
}

function ActionPlanPanel({
  entry,
  busy,
  onAccept,
  onReject,
  onAskGemini,
  onDecision,
  onSavePlan,
  onArchive,
}: {
  readonly entry: WorkbenchEntry | null;
  readonly busy: boolean;
  readonly onAccept: (action: WorkbenchActionItem, content?: string) => void;
  readonly onReject: (action: WorkbenchActionItem) => void;
  readonly onAskGemini: (action: WorkbenchActionItem) => void;
  readonly onDecision: (
    action: WorkbenchActionItem,
    operation: "keep_current" | "adopt_new" | "manual" | "defer",
    content?: string,
  ) => void;
  readonly onSavePlan: (plan: WorkbenchActionPlan) => void;
  readonly onArchive: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  useEffect(() => {
    setEditingId(null);
    setEditingText("");
  }, [entry?.id]);

  if (!entry) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        选择一轮或粘贴新内容后，这里显示本轮行动单。
      </div>
    );
  }

  const plan = entry.actionPlan;
  const visibleItems = plan.items.filter((item) => item.status === "pending");
  const handledCount = plan.items.length - visibleItems.length;

  function startEdit(action: WorkbenchActionItem) {
    setEditingId(action.id);
    setEditingText(editableTextForAction(action));
  }

  function saveEdit(action: WorkbenchActionItem) {
    const nextPlan = {
      ...plan,
      items: plan.items.map((item) =>
        item.id === action.id
          ? {
              ...item,
              payload: {
                ...item.payload,
                content: editingText,
                ...(item.type === "decision" ? { manualContent: editingText } : {}),
              },
            }
          : item,
      ),
    };
    onSavePlan(nextPlan);
    setEditingId(null);
    setEditingText("");
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold">本轮行动单</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {plan.summary || "本轮没有需要你决定的问题。"}
            </p>
          </div>
          <StatusBadge status={plan.status} />
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          目标第 {plan.targetChapter} 章 · 待处理 {visibleItems.length} · 已处理 {handledCount} · 原始块 {plan.rawBlockCount}
        </div>
      </div>

      {visibleItems.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {handledCount > 0 ? "本轮行动项已处理完。" : "本轮没有需要你决定的问题。"}
        </div>
      )}

      {visibleItems.map((action) => (
        <div key={action.id} className="rounded-lg border border-border/60 bg-secondary/20 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-border bg-background/70 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                  {ACTION_TYPE_LABELS[action.type]}
                </span>
                <span className="rounded-md border border-border bg-background/70 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                  {ACTION_STATUS_LABELS[action.status]}
                </span>
              </div>
              <div className="mt-2 text-sm font-bold leading-5">{action.title}</div>
            </div>
          </div>

          <ActionPayloadView action={action} />

          {action.sourceEvidence && (
            <div className="mt-2 border-l-2 border-border pl-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">来源依据</div>
              <p className="mt-1 line-clamp-4 text-[11px] leading-5 text-muted-foreground">{action.sourceEvidence}</p>
            </div>
          )}

          {editingId === action.id && (
            <div className="mt-3 space-y-2">
              <textarea
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                className="min-h-32 w-full rounded-md border border-border bg-background/70 px-3 py-2 text-xs leading-5 outline-none resize-y focus:border-primary/50"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => saveEdit(action)}
                  disabled={busy}
                  className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-bold text-primary hover:bg-primary/15 disabled:opacity-40"
                >
                  保存微调
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="rounded-md border border-border bg-background/60 px-2 py-1 text-xs font-bold hover:bg-secondary"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {action.type === "decision" ? (
              <>
                <ActionButton disabled={busy || action.status !== "pending"} onClick={() => onDecision(action, "keep_current")} icon={<Check size={12} />} label="保留当前" />
                <ActionButton disabled={busy || action.status !== "pending"} onClick={() => onDecision(action, "adopt_new", stringPayload(action, "newContent"))} icon={<Check size={12} />} label="采用新内容" />
                <ActionButton disabled={busy || action.status !== "pending"} onClick={() => onDecision(action, "manual", editingText || stringPayload(action, "manualContent") || stringPayload(action, "newContent"))} icon={<Edit3 size={12} />} label="手动改" />
                <ActionButton disabled={busy || action.status !== "pending"} onClick={() => onDecision(action, "defer")} icon={<Archive size={12} />} label="暂时搁置" />
              </>
            ) : (
              <ActionButton disabled={busy || action.status !== "pending"} onClick={() => onAccept(action, editingText || undefined)} icon={<Check size={12} />} label="接受" />
            )}
            <ActionButton disabled={busy} onClick={() => startEdit(action)} icon={<Edit3 size={12} />} label="编辑" />
            <ActionButton disabled={busy || action.status !== "pending"} onClick={() => onReject(action)} icon={<X size={12} />} label="拒绝" danger />
            <ActionButton disabled={busy} onClick={() => onAskGemini(action)} icon={<HelpCircle size={12} />} label="追问 Gemini" />
          </div>
        </div>
      ))}

      {plan.nextPrompt.trim() && (
        <div className="rounded-lg border border-border/60 bg-background/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-bold">行动单底部提示词</div>
            <button
              onClick={() => void navigator.clipboard.writeText(plan.nextPrompt)}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 py-1 text-xs font-bold hover:bg-secondary"
            >
              <Clipboard size={12} />
              复制
            </button>
          </div>
          <p className="line-clamp-6 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{plan.nextPrompt}</p>
        </div>
      )}

      <button
        onClick={onArchive}
        disabled={busy || plan.status === "archived"}
        className="w-full rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs font-bold hover:bg-secondary disabled:opacity-40"
      >
        本轮完成
      </button>
    </div>
  );
}

function ActionPayloadView({ action }: { readonly action: WorkbenchActionItem }) {
  if (action.type === "decision") {
    return (
      <div className="mt-3 space-y-2">
        <PayloadBox label="当前共识" value={stringPayload(action, "currentConsensus") || "未记录"} />
        <PayloadBox label="Gemini 新内容" value={stringPayload(action, "newContent") || "未记录"} />
        <PayloadBox label="为什么要拍板" value={stringPayload(action, "reason") || "未记录"} />
      </div>
    );
  }
  const content = stringPayload(action, "content") || stringPayload(action, "generatedPrompt");
  return (
    <div className="mt-3 rounded-md bg-background/50 p-2">
      {action.type === "setting" && (
        <div className="mb-1 text-[10px] font-bold text-muted-foreground">
          写入目标：{stringPayload(action, "targetFile") || "story/current_state.md"}
        </div>
      )}
      <p className="line-clamp-8 whitespace-pre-wrap text-xs leading-5 text-foreground/85">
        {content || "暂无内容。"}
      </p>
    </div>
  );
}

function PayloadBox({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md bg-background/50 p-2">
      <div className="text-[10px] font-bold text-muted-foreground">{label}</div>
      <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-foreground/85">{value}</p>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  disabled,
  danger,
  onClick,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold disabled:opacity-40 ${
        danger
          ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
          : "border-border bg-background/60 hover:bg-secondary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function RoundButton({
  entry,
  active,
  muted,
  onClick,
}: {
  readonly entry: WorkbenchEntrySummary;
  readonly active: boolean;
  readonly muted?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${
        active
          ? "border-primary/40 bg-primary/10"
          : muted
            ? "border-border/50 bg-secondary/10 text-muted-foreground hover:bg-secondary/30"
            : "border-border/60 bg-secondary/20 hover:bg-secondary/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-bold">{entry.sourceName}</span>
        <StatusBadge status={entry.status} />
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {formatDateTime(entry.createdAt)} · {entry.rawCharCount.toLocaleString()} 字符
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{entry.preview || "暂无行动单"}</p>
    </button>
  );
}

function RawBlocks({ entry }: { readonly entry: WorkbenchEntry }) {
  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-background/50 p-3">
      <div className="mb-2 text-xs font-bold text-muted-foreground">
        原始拆解：{entry.blocks.length} 块，主界面已隐藏 {entry.actionPlan.hiddenBlockCount} 块
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {entry.blocks.map((block) => (
          <div key={block.id} className="rounded-md border border-border/60 bg-secondary/20 p-2">
            <div className="truncate text-xs font-bold">{block.title}</div>
            <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-muted-foreground">{block.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RawTextDrawer({ entry, onClose }: { readonly entry: WorkbenchEntry; readonly onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-4xl border-l border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-sm font-bold">Gemini 原文</div>
            <div className="mt-1 text-xs text-muted-foreground">{entry.rawPath}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-secondary/50 p-2 hover:bg-secondary"
          >
            <X size={16} />
          </button>
        </div>
        <div className="h-[calc(100%-73px)] overflow-y-auto whitespace-pre-wrap px-8 py-6 font-mono text-sm leading-7">
          {entry.rawText}
        </div>
      </div>
    </div>
  );
}

function updateActionInPlan(
  plan: WorkbenchActionPlan,
  actionId: string,
  patch: {
    readonly status?: WorkbenchActionStatus;
    readonly payload?: Record<string, unknown>;
    readonly nextPrompt?: string;
    readonly statusOverride?: WorkbenchStatus;
  },
): WorkbenchActionPlan {
  return {
    ...plan,
    status: patch.statusOverride ?? plan.status,
    nextPrompt: patch.nextPrompt ?? plan.nextPrompt,
    items: plan.items.map((item) =>
      item.id === actionId
        ? {
            ...item,
            status: patch.status ?? item.status,
            payload: patch.payload ?? item.payload,
          }
        : item,
    ),
  };
}

function isActionPlanHandled(plan: WorkbenchActionPlan): boolean {
  return plan.items.every((item) => item.status !== "pending");
}

function editableTextForAction(action: WorkbenchActionItem): string {
  if (action.type === "decision") {
    return stringPayload(action, "manualContent") || stringPayload(action, "newContent") || "";
  }
  return stringPayload(action, "content") || stringPayload(action, "generatedPrompt") || "";
}

function buildActionPrompt(action: WorkbenchActionItem): string {
  if (action.type === "decision") {
    return [
      "我需要你重做下面这个冲突点，不要直接扩写正文，先帮我把选择讲清楚。",
      "",
      `冲突主题：${stringPayload(action, "subject") || action.title}`,
      "",
      "当前共识：",
      stringPayload(action, "currentConsensus") || "暂无明确记录。",
      "",
      "你刚才的新内容：",
      stringPayload(action, "newContent") || "暂无明确记录。",
      "",
      "请输出：1. 两种方案的利弊；2. 哪个更适合长篇网文第一卷；3. 如果采用新内容，如何不破坏当前共识。",
    ].join("\n");
  }
  return [
    "请基于下面这条行动项继续帮我处理，但不要把不确定内容写成既定事实。",
    "",
    `行动项：${action.title}`,
    "",
    "当前内容：",
    editableTextForAction(action) || action.sourceEvidence || "暂无。",
    "",
    "请输出：可直接采用的修改稿、需要我拍板的点、下一步最小行动。",
  ].join("\n");
}

function statusForAppliedAction(
  action: WorkbenchActionItem,
  operation: "accept" | "reject" | "defer" | "keep_current" | "adopt_new" | "manual",
): string {
  if (action.type === "setting" && operation === "accept") return "已确认写入设定文件。";
  if (operation === "keep_current") return "已保留当前共识，新内容不会写入权威文件。";
  if (operation === "adopt_new") return "已采用新内容并写入设定文件。";
  if (operation === "manual") return "已按手动修改写入设定文件。";
  if (operation === "defer") return "已暂时搁置，不会写入权威文件。";
  return "行动项已更新。";
}

function stringPayload(action: WorkbenchActionItem, key: string): string {
  const value = action.payload[key];
  return typeof value === "string" ? value : "";
}

function MoreAction({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="block w-full rounded-md px-3 py-2 text-left text-xs font-bold hover:bg-secondary"
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { readonly status: WorkbenchStatus }) {
  const className = status === "raw_saved"
    ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    : status === "organized"
      ? "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"
      : status === "applied"
        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "border-border bg-secondary/60 text-muted-foreground";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${className}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function PanelTitle({ icon, title }: { readonly icon: React.ReactNode; readonly title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 px-1 text-sm font-bold">
      <span className="text-primary">{icon}</span>
      {title}
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card px-3 py-2 text-center">
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
