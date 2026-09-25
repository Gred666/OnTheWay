// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "./backend";
import type { DayDoc, Note } from "./types";

const api = {
  calendarDay: vi.fn(),
  calendarDaySave: vi.fn(),
  goalGet: vi.fn(),
  goalSave: vi.fn(),
  noteUpsert: vi.fn(),
  noteGet: vi.fn(),
};

vi.mock("./backend", () => ({
  backend: async () => api as unknown as Backend,
}));

const { useData } = await import("./store");

const day = (noteMd: string, extra: Partial<DayDoc> = {}): DayDoc => ({
  date: "2026-08-29",
  title: "",
  tasks: [],
  noteMd,
  updatedAt: 1,
  carriedFrom: null,
  ...extra,
});

const note = (contentMd: string): Note => ({
  id: "n-1",
  title: "笔记",
  contentMd,
  excerpt: "",
  icon: "file",
  wordCount: 1,
  isPinned: false,
  isArchived: false,
  archiveCategory: null,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
  actionGroup: null,
});

const initial = useData.getState();

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  useData.setState({
    ...initial,
    notes: [],
    archived: [],
    dayDocs: [],
    goals: {},
    savingDocs: new Set(),
    saveError: null,
    error: null,
  });
});

describe("saveDocument", () => {
  it("refuses to write a calendar day that has not loaded yet", async () => {
    // 这一天还没取回来时编辑器是空的。以前守卫写成 `source?.noteMd === contentMd`，
    // source 为 undefined 就直接放行，一输入就把当天原有的备注整篇覆盖。
    await useData.getState().saveDocument({ kind: "day", id: "2026-08-29" }, "随手写一句");
    expect(api.calendarDaySave).not.toHaveBeenCalled();
  });

  it("writes a calendar day once it is loaded", async () => {
    useData.setState({ dayDocs: [day("原有备注")] });
    api.calendarDaySave.mockResolvedValue(day("新的备注"));

    await useData.getState().saveDocument({ kind: "day", id: "2026-08-29" }, "新的备注");
    expect(api.calendarDaySave).toHaveBeenCalledWith("2026-08-29", "", "新的备注");
    expect(useData.getState().dayDocs[0]?.noteMd).toBe("新的备注");
  });

  it("saves a carried-over today under its own date, keeping the carried title", async () => {
    // 今天还没写过，内容是从 8/27 延续来的；第一次编辑就以今天的身份落库，
    // 标题跟着一起带过去，昨天那篇不动。
    useData.setState({
      dayDocs: [day("- [ ] 跑步", { title: "周四的 TODO", carriedFrom: "2026-08-27" })],
    });
    api.calendarDaySave.mockResolvedValue(day("- [x] 跑步", { title: "周四的 TODO" }));

    await useData.getState().saveDocument({ kind: "day", id: "2026-08-29" }, "- [x] 跑步");
    expect(api.calendarDaySave).toHaveBeenCalledWith("2026-08-29", "周四的 TODO", "- [x] 跑步");
    expect(useData.getState().dayDocs[0]?.carriedFrom).toBeNull();
    expect(useData.getState().markedDates.has("2026-08-29")).toBe(true);
  });

  it("refuses to write a goal period that has not loaded yet", async () => {
    await useData
      .getState()
      .saveDocument({ kind: "goal", horizon: "week", periodStart: "2026-08-24" }, "本周");
    expect(api.goalSave).not.toHaveBeenCalled();
  });

  it("writes a goal by its period and caches it under that key", async () => {
    const empty = {
      id: "",
      horizon: "week" as const,
      title: "",
      periodStart: "2026-08-24",
      contentMd: "",
      actionGroup: null,
      createdAt: 0,
      updatedAt: 0,
    };
    useData.setState({ goals: { "week:2026-08-24": empty } });
    api.goalSave.mockResolvedValue({ ...empty, id: "g1", contentMd: "本周", updatedAt: 5 });

    await useData
      .getState()
      .saveDocument({ kind: "goal", horizon: "week", periodStart: "2026-08-24" }, "本周");
    expect(api.goalSave).toHaveBeenCalledWith("week", "2026-08-24", "本周");
    expect(useData.getState().goals["week:2026-08-24"]?.id).toBe("g1");
  });

  it("keeps the note list order stable while typing", async () => {
    // 自动保存每 400ms 刷新一次 updatedAt；按它重排会让正在编辑的笔记
    // 在侧栏里当着用户的面往上跳。
    const older = { ...note("甲"), id: "n-old", updatedAt: 1 };
    const newer = { ...note("乙"), id: "n-new", updatedAt: 9 };
    useData.setState({ notes: [newer, older] });
    api.noteUpsert.mockResolvedValue("n-old");
    api.noteGet.mockResolvedValue({ ...older, contentMd: "甲甲", updatedAt: 99 });

    await useData.getState().saveDocument({ kind: "note", id: "n-old" }, "甲甲");
    expect(useData.getState().notes.map((item) => item.id)).toEqual(["n-new", "n-old"]);
  });

  it("surfaces a failed save instead of swallowing it", async () => {
    useData.setState({ notes: [note("原文")] });
    api.noteUpsert.mockRejectedValue(new Error("磁盘只读"));

    await expect(
      useData.getState().saveDocument({ kind: "note", id: "n-1" }, "新文"),
    ).rejects.toThrow("磁盘只读");
    expect(useData.getState().saveError).toBe("磁盘只读");
    // 失败也要把「保存中」清掉，否则状态栏会一直卡在保存中。
    expect(useData.getState().savingDocs.size).toBe(0);
  });

  it("clears a stale error after the next successful save", async () => {
    useData.setState({ notes: [note("原文")], saveError: "磁盘只读" });
    api.noteUpsert.mockResolvedValue("n-1");
    api.noteGet.mockResolvedValue(note("新文"));

    await useData.getState().saveDocument({ kind: "note", id: "n-1" }, "新文");
    expect(useData.getState().saveError).toBeNull();
  });
});

describe("saveTitle", () => {
  it("first-saves a carried-over today when only the title changes", async () => {
    useData.setState({
      dayDocs: [day("延续来的正文", { title: "旧标题", carriedFrom: "2026-08-27" })],
    });
    api.calendarDaySave.mockResolvedValue(day("延续来的正文", { title: "新标题" }));

    await useData.getState().saveTitle({ kind: "day", id: "2026-08-29" }, "  新标题 ");
    expect(api.calendarDaySave).toHaveBeenCalledWith("2026-08-29", "新标题", "延续来的正文");
    expect(useData.getState().dayDocs[0]?.title).toBe("新标题");
  });

  it("ignores empty titles and goal targets", async () => {
    useData.setState({ dayDocs: [day("正文", { title: "标题" })] });
    await useData.getState().saveTitle({ kind: "day", id: "2026-08-29" }, "   ");
    await useData
      .getState()
      .saveTitle({ kind: "goal", horizon: "week", periodStart: "2026-08-24" }, "改不了");
    expect(api.calendarDaySave).not.toHaveBeenCalled();
    expect(api.goalSave).not.toHaveBeenCalled();
  });
});

describe("forgetCarriedDays", () => {
  it("drops carried-over docs but keeps real ones", () => {
    useData.setState({
      dayDocs: [
        day("真的", { date: "2026-08-27" }),
        day("延续的", { date: "2026-08-29", carriedFrom: "2026-08-27" }),
      ],
    });
    useData.getState().forgetCarriedDays("2026-08-29");
    expect(useData.getState().dayDocs.map((d) => d.date)).toEqual(["2026-08-27"]);
  });

  it("refetches the new today with carry-over when it was peeked at the day before", async () => {
    // 前一晚在日历里点开过明天：那时它不是今天，取回来的是一篇不延续的空白文档。
    // 过了零点它成了今天，得重新取一次才能延续前一天的内容。
    useData.setState({ dayDocs: [day("", { date: "2026-08-29" })] });
    api.calendarDay.mockResolvedValue(
      day("- [ ] 跑步", { date: "2026-08-29", carriedFrom: "2026-08-28" }),
    );

    useData.getState().forgetCarriedDays("2026-08-29");
    await useData.getState().loadDay("2026-08-29", true);
    expect(api.calendarDay).toHaveBeenCalledWith("2026-08-29", true);
    expect(useData.getState().dayDocs[0]?.carriedFrom).toBe("2026-08-28");
  });

  it("keeps the new today when it already has its own content", () => {
    useData.setState({ dayDocs: [day("自己写的", { date: "2026-08-29" })] });
    useData.getState().forgetCarriedDays("2026-08-29");
    expect(useData.getState().dayDocs).toHaveLength(1);
  });
});
