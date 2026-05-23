import { describe, expect, it, vi } from "vitest";
import {
  buildBookCreateAgentRequest,
  buildBookCreatePayload,
  buildCreationDraftSummary,
  canCreateFromDraft,
  defaultBookCreateForm,
  defaultChapterWordsForLanguage,
  ensureBookCreateSessionId,
  isBookCreateFormReady,
  platformOptionsForLanguage,
  pickValidValue,
  resolveDraftInstruction,
  waitForBookReady,
} from "./BookCreate";
import { buildCandidateRedoPrompt, buildCurrentSituationGeminiPrompt, defaultStartup } from "./CreativeBookCreate";
import { pickWorkbenchTargetChapter, splitChapterMarkdown } from "./CreativeWorkbench";

describe("pickValidValue", () => {
  it("keeps the current value when it is still available", () => {
    expect(pickValidValue("mystery", ["mystery", "romance"])).toBe("mystery");
  });

  it("falls back to the first available value when current is blank or invalid", () => {
    expect(pickValidValue("", ["mystery", "romance"])).toBe("mystery");
    expect(pickValidValue("invalid", ["mystery", "romance"])).toBe("mystery");
    expect(pickValidValue("", [])).toBe("");
  });
});

describe("defaultChapterWordsForLanguage", () => {
  it("uses 3000 for chinese projects and 2000 for english projects", () => {
    expect(defaultChapterWordsForLanguage("zh")).toBe("3000");
    expect(defaultChapterWordsForLanguage("en")).toBe("2000");
  });
});

describe("platformOptionsForLanguage", () => {
  it("uses stable, unique values for english platform choices", () => {
    const values = platformOptionsForLanguage("en").map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(["royal-road", "kindle-unlimited", "scribble-hub", "other"]);
  });
});

describe("book create form", () => {
  it("starts with sensible defaults for chinese projects", () => {
    expect(defaultBookCreateForm("zh")).toEqual({
      title: "",
      genre: "",
      platform: "tomato",
      targetChapters: "200",
      chapterWordCount: "3000",
      brief: "",
    });
  });

  it("requires title, genre, brief, and positive numeric targets before creating", () => {
    const ready = {
      ...defaultBookCreateForm("zh"),
      title: "夜港账本",
      genre: "都市悬疑",
      brief: "近未来港口城，主角查账洗白。",
    };

    expect(isBookCreateFormReady(ready)).toBe(true);
    expect(isBookCreateFormReady({ ...ready, title: "" })).toBe(false);
    expect(isBookCreateFormReady({ ...ready, brief: " " })).toBe(false);
    expect(isBookCreateFormReady({ ...ready, targetChapters: "0" })).toBe(false);
  });

  it("builds a direct create payload without dropping the story brief", () => {
    expect(buildBookCreatePayload({
      title: " 夜港账本 ",
      genre: " 都市悬疑 ",
      platform: "qidian",
      targetChapters: "120",
      chapterWordCount: "2600",
      brief: " 主角查账洗白，旧案回潮。 ",
    }, "zh")).toEqual({
      title: "夜港账本",
      genre: "都市悬疑",
      platform: "qidian",
      language: "zh",
      targetChapters: 120,
      chapterWordCount: 2600,
      blurb: "主角查账洗白，旧案回潮。",
    });
  });
});

describe("waitForBookReady", () => {
  it("retries until the created book becomes readable", async () => {
    let attempts = 0;

    await expect(waitForBookReady("fresh-book", {
      fetchBook: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Book not found");
        }
      },
      fetchStatus: async () => ({ status: "creating" }),
      delayMs: 0,
      waitImpl: async () => undefined,
    })).resolves.toBeUndefined();

    expect(attempts).toBe(3);
  });

  it("keeps polling while the server still reports the book as creating", async () => {
    let attempts = 0;

    await expect(waitForBookReady("slow-book", {
      fetchBook: async () => {
        attempts += 1;
        if (attempts < 25) {
          throw new Error("Book not found");
        }
      },
      fetchStatus: async () => ({ status: "creating" }),
      delayMs: 0,
      waitImpl: async () => undefined,
    })).resolves.toBeUndefined();

    expect(attempts).toBe(25);
  });

  it("surfaces a clear timeout when the book is still being created", async () => {
    await expect(waitForBookReady("missing-book", {
      fetchBook: async () => {
        throw new Error("Book not found");
      },
      fetchStatus: async () => ({ status: "creating" }),
      maxAttempts: 2,
      delayMs: 0,
      waitImpl: async () => undefined,
    })).rejects.toThrow('Book "missing-book" is still being created. Wait a moment and refresh.');
  });

  it("prefers the server-reported create failure over a polling timeout", async () => {
    await expect(waitForBookReady("broken-book", {
      fetchBook: async () => {
        throw new Error("Book not found");
      },
      fetchStatus: async () => ({ status: "error", error: "INKOS_LLM_API_KEY not set" }),
      delayMs: 0,
      waitImpl: async () => undefined,
    })).rejects.toThrow("INKOS_LLM_API_KEY not set");
  });
});

describe("resolveDraftInstruction", () => {
  it("forces the first ideation turn through /new so an active book does not hijack the flow", () => {
    expect(resolveDraftInstruction("我想写个港风商战悬疑", false)).toBe("/new 我想写个港风商战悬疑");
    expect(resolveDraftInstruction("把世界观改成近未来港口城", true)).toBe("把世界观改成近未来港口城");
  });
});

describe("book create agent session", () => {
  it("includes the orphan session id in agent requests", () => {
    expect(buildBookCreateAgentRequest("/create", "123456-abcdef")).toEqual({
      instruction: "/create",
      sessionId: "123456-abcdef",
    });
  });

  it("rejects agent requests before a session is ready", () => {
    expect(() => buildBookCreateAgentRequest("/create", " ")).toThrow("Book create session is not ready.");
  });

  it("reuses a stored orphan session", async () => {
    const createSession = vi.fn();
    const setStoredSessionId = vi.fn();

    await expect(ensureBookCreateSessionId({
      getStoredSessionId: () => "123456-abcdef",
      fetchSession: async () => ({ session: { sessionId: "123456-abcdef", bookId: null } }),
      createSession,
      setStoredSessionId,
    })).resolves.toBe("123456-abcdef");

    expect(createSession).not.toHaveBeenCalled();
    expect(setStoredSessionId).not.toHaveBeenCalled();
  });

  it("replaces a stale stored session before sending agent requests", async () => {
    const clearStoredSessionId = vi.fn();
    const setStoredSessionId = vi.fn();

    await expect(ensureBookCreateSessionId({
      getStoredSessionId: () => "old-session",
      fetchSession: async () => {
        throw new Error("Session not found");
      },
      createSession: async () => ({ session: { sessionId: "123456-newone", bookId: null } }),
      clearStoredSessionId,
      setStoredSessionId,
    })).resolves.toBe("123456-newone");

    expect(clearStoredSessionId).toHaveBeenCalledOnce();
    expect(setStoredSessionId).toHaveBeenCalledWith("123456-newone");
  });
});

describe("canCreateFromDraft", () => {
  it("accepts drafts explicitly marked ready", () => {
    expect(canCreateFromDraft({
      concept: "港风商战悬疑",
      readyToCreate: true,
      missingFields: [],
    })).toBe(true);
  });

  it("accepts drafts that already have the minimum creation fields", () => {
    expect(canCreateFromDraft({
      concept: "港风商战悬疑",
      title: "夜港账本",
      genre: "urban",
      targetChapters: 120,
      chapterWordCount: 2800,
      readyToCreate: false,
      missingFields: [],
    })).toBe(true);
  });

  it("rejects incomplete drafts", () => {
    expect(canCreateFromDraft({
      concept: "港风商战悬疑",
      title: "夜港账本",
      readyToCreate: false,
      missingFields: ["genre", "targetChapters"],
    })).toBe(false);
  });
});

describe("buildCreationDraftSummary", () => {
  it("surfaces the shared foundation draft in a user-facing order", () => {
    expect(buildCreationDraftSummary({
      concept: "港风商战悬疑，主角从灰产洗白。",
      title: "夜港账本",
      worldPremise: "近未来港口城，账本牵出多方势力。",
      protagonist: "林砚，水货账房出身，擅长记账和看人。",
      conflictCore: "洗白与旧债回潮的对撞。",
      volumeOutline: "卷一先查账，再暴露港口旧案。",
      blurb: "一个做灰产生意的人，准备在夜港洗白，却先被旧账拖回去。",
      nextQuestion: "卷一先查账还是先砸场？",
      missingFields: ["targetChapters"],
      readyToCreate: false,
    }, "zh")).toEqual([
      { key: "title", label: "书名", value: "夜港账本" },
      { key: "worldPremise", label: "世界观", value: "近未来港口城，账本牵出多方势力。" },
      { key: "protagonist", label: "主角", value: "林砚，水货账房出身，擅长记账和看人。" },
      { key: "conflictCore", label: "核心冲突", value: "洗白与旧债回潮的对撞。" },
      { key: "volumeOutline", label: "卷纲方向", value: "卷一先查账，再暴露港口旧案。" },
      { key: "blurb", label: "简介", value: "一个做灰产生意的人，准备在夜港洗白，却先被旧账拖回去。" },
      { key: "nextQuestion", label: "下一步", value: "卷一先查账还是先砸场？" },
    ]);
  });
});

describe("pickWorkbenchTargetChapter", () => {
  it("prefers the latest non-approved chapter and otherwise uses the next chapter", () => {
    expect(pickWorkbenchTargetChapter({
      nextChapter: 4,
      chapters: [
        { number: 1, title: "一", status: "approved", wordCount: 3000 },
        { number: 2, title: "二", status: "needs-revision", wordCount: 2600 },
        { number: 3, title: "三", status: "drafted", wordCount: 2400 },
      ],
    })).toBe(3);

    expect(pickWorkbenchTargetChapter({
      nextChapter: 4,
      chapters: [
        { number: 1, title: "一", status: "approved", wordCount: 3000 },
        { number: 2, title: "二", status: "approved", wordCount: 2600 },
      ],
    })).toBe(4);
  });
});

describe("splitChapterMarkdown", () => {
  it("loads an existing chapter into title and editable body", () => {
    expect(splitChapterMarkdown("# 第3章 雨夜账本\n\n正文第一段。\n\n正文第二段。", 3)).toEqual({
      title: "雨夜账本",
      content: "正文第一段。\n\n正文第二段。",
    });
  });
});

describe("buildCandidateRedoPrompt", () => {
  it("turns an unsatisfying candidate into a concrete Gemini redo prompt", () => {
    const startup = {
      ...defaultStartup(new Date("2026-05-21T09:00:00.000Z")),
      volume1: {
        ...defaultStartup(new Date("2026-05-21T09:00:00.000Z")).volume1,
        goal: "主角要查清第一卷契约失效的原因。",
        opposition: "当前只有一串反派名单。",
        opening: "从守阵失败切入。",
      },
    };

    const prompt = buildCandidateRedoPrompt({
      id: "c1",
      kind: "explicit",
      targetPath: "volume1.opposition",
      label: "对立势力/人物",
      value: "天道、守阵执事秦庚、陆昭真人、宋玉。",
      evidence: "Gemini 输出的名单。",
      status: "rejected",
    }, startup);

    expect(prompt).toContain("只围绕第一卷");
    expect(prompt).toContain("不要只列名单");
    expect(prompt).toContain("第一次冲突场景");
    expect(prompt).toContain("升级链条");
    expect(prompt).toContain("天道、守阵执事秦庚、陆昭真人、宋玉");
  });
});

describe("buildCurrentSituationGeminiPrompt", () => {
  it("summarizes the current reviewed state for Gemini", () => {
    const startup = {
      ...defaultStartup(new Date("2026-05-21T09:00:00.000Z")),
      book: {
        ...defaultStartup(new Date("2026-05-21T09:00:00.000Z")).book,
        title: "夜港账本",
        genre: "都市悬疑",
        blurb: "前审计员追查旧账。",
      },
      stable: {
        ...defaultStartup(new Date("2026-05-21T09:00:00.000Z")).stable,
        premise: "旧账牵出港城阴谋。",
        protagonist: "林昭，前审计员。",
      },
      volume1: {
        ...defaultStartup(new Date("2026-05-21T09:00:00.000Z")).volume1,
        coreHook: "第一卷围绕旧账源头。",
        goal: "找到第一本账本来源。",
        opposition: "港城利益链。",
        opening: "雨夜收到旧账本。",
        suspense: "账本主人是谁？",
      },
      chapters: defaultStartup(new Date("2026-05-21T09:00:00.000Z")).chapters.map((chapter, index) => (
        index === 0
          ? { ...chapter, title: "雨夜账本", problem: "账本出现。", hook: "缺页指向旧同事。" }
          : chapter
      )),
      followups: {
        questions: ["主角不查账本会失去什么？"],
        geminiPrompt: "请补第一卷反派动机。",
        suggestions: ["让反派与旧案绑定。"],
      },
    };

    const prompt = buildCurrentSituationGeminiPrompt(startup, [
      {
        id: "c1",
        kind: "explicit",
        targetPath: "stable.protagonist",
        label: "主角",
        value: "林昭，前审计员。",
        evidence: "原文明确。",
        status: "accepted",
      },
      {
        id: "c2",
        kind: "gap",
        targetPath: "volume1.stakes",
        label: "缺口",
        value: "还没想清楚主角不查账本会失去什么。",
        evidence: "原文缺失。",
        status: "pending",
      },
      {
        id: "c3",
        kind: "conflict",
        targetPath: "volume1.opposition",
        label: "对立势力",
        value: "名单太空泛。",
        evidence: "只列名单没有情节。",
        status: "rejected",
      },
    ]);

    expect(prompt).toContain("现阶段只处理第一卷");
    expect(prompt).toContain("已接受为当前事实的候选");
    expect(prompt).toContain("仍需处理的缺口/冲突/待定项");
    expect(prompt).toContain("已拒绝或不满意");
    expect(prompt).toContain("近 10 章问题链草稿");
    expect(prompt).toContain("夜港账本");
  });
});
