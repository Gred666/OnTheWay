// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "./backend";
import type { DayDoc, Note, VaultChange } from "./types";

const api = {
  calendarDay: vi.fn(),
  calendarDaySave: vi.fn(),
  calendarMarked: vi.fn(),
  goalGet: vi.fn(),
  goalSave: vi.fn(),
  noteUpsert: vi.fn(),
  noteGet: vi.fn(),
  noteListFull: vi.fn(),
  noteDelete: vi.fn(),
  noteUndelete: vi.fn(),
  onVaultChanged: vi.fn(),
  vaultKeepConflictCopy: vi.fn(),
  vaultReveal: vi.fn(),
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
  wordCount: 1,
  isPinned: false,
  isArchived: false,
  archiveCategory: null,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
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
    notice: null,
    drafts: {},
    externalRevisions: {},
    conflicts: new Set(),
    markedDates: new Set(),
  });
});

const change = (extra: Partial<VaultChange>): VaultChange => ({
  notes: [],
  days: [],
  goals: [],
  tasks: false,
  conflicts: [],
  ...extra,
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
    expect(useData.getState().saveError).toEqual({ key: "note:n-1", message: "磁盘只读" });
    // 失败也要把「保存中」清掉，否则状态栏会一直卡在保存中。
    expect(useData.getState().savingDocs.size).toBe(0);
  });

  it("clears a stale error after the next successful save", async () => {
    useData.setState({
      notes: [note("原文")],
      saveError: { key: "note:n-1", message: "磁盘只读" },
    });
    api.noteUpsert.mockResolvedValue("n-1");
    api.noteGet.mockResolvedValue(note("新文"));

    await useData.getState().saveDocument({ kind: "note", id: "n-1" }, "新文");
    expect(useData.getState().saveError).toBeNull();
  });
});

describe("saveDocument / saveTitle 排队", () => {
  /** 可以手动放行的 promise */
  const gate = <T>() => {
    let open: (value: T) => void = () => {};
    const promise = new Promise<T>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  };

  it("does not let a body save overwrite a title saved just before it", async () => {
    // 标题改完失焦就存，正文 400ms 后自动保存；两次都写整篇。以前两次同时在路上时，
    // 正文那次带的是旧标题，后落库就把新标题覆盖回去了。
    const saved = { title: "旧标题", contentMd: "旧正文" };
    useData.setState({ notes: [{ ...note("旧正文"), title: "旧标题" }] });
    const firstUpsert = gate<string>();
    api.noteUpsert
      .mockImplementationOnce(async (input: { title: string; contentMd: string }) => {
        await firstUpsert.promise;
        Object.assign(saved, input);
        return "n-1";
      })
      .mockImplementation(async (input: { title: string; contentMd: string }) => {
        Object.assign(saved, input);
        return "n-1";
      });
    api.noteGet.mockImplementation(async () => ({ ...note(saved.contentMd), title: saved.title }));

    const title = useData.getState().saveTitle({ kind: "note", id: "n-1" }, "新标题");
    const body = useData.getState().saveDocument({ kind: "note", id: "n-1" }, "新正文");
    firstUpsert.open("n-1");
    await Promise.all([title, body]);

    expect(saved).toMatchObject({ title: "新标题", contentMd: "新正文" });
    expect(api.noteUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "新标题", contentMd: "新正文" }),
    );
    expect(useData.getState().notes[0]).toMatchObject({ title: "新标题", contentMd: "新正文" });
  });

  it("keeps a day's new title when its body is saved right after", async () => {
    const saved = { title: "旧", noteMd: "旧正文" };
    useData.setState({ dayDocs: [day("旧正文", { title: "旧" })] });
    const firstSave = gate<void>();
    api.calendarDaySave
      .mockImplementationOnce(async (_date: string, title: string, noteMd: string) => {
        await firstSave.promise;
        Object.assign(saved, { title, noteMd });
        return day(noteMd, { title });
      })
      .mockImplementation(async (_date: string, title: string, noteMd: string) => {
        Object.assign(saved, { title, noteMd });
        return day(noteMd, { title });
      });

    const title = useData.getState().saveTitle({ kind: "day", id: "2026-08-29" }, "新");
    const body = useData.getState().saveDocument({ kind: "day", id: "2026-08-29" }, "新正文");
    firstSave.open();
    await Promise.all([title, body]);
    expect(saved).toEqual({ title: "新", noteMd: "新正文" });
  });

  it("keeps going after a failed write", async () => {
    useData.setState({ notes: [note("原文")] });
    api.noteUpsert.mockRejectedValueOnce(new Error("磁盘只读")).mockResolvedValue("n-1");
    api.noteGet.mockResolvedValue(note("第二版"));

    const first = useData.getState().saveDocument({ kind: "note", id: "n-1" }, "第一版");
    const second = useData.getState().saveDocument({ kind: "note", id: "n-1" }, "第二版");
    await expect(first).rejects.toThrow("磁盘只读");
    await second;
    expect(useData.getState().notes[0]?.contentMd).toBe("第二版");
    expect(useData.getState().saveError).toBeNull();
  });
});

describe("saveError 按文档区分", () => {
  it("a success on another document does not clear this one's error", async () => {
    const other = { ...note("乙"), id: "n-2" };
    useData.setState({
      notes: [note("甲"), other],
      saveError: { key: "note:n-1", message: "磁盘只读" },
    });
    api.noteUpsert.mockResolvedValue("n-2");
    api.noteGet.mockResolvedValue({ ...other, contentMd: "乙乙" });

    await useData.getState().saveDocument({ kind: "note", id: "n-2" }, "乙乙");
    expect(useData.getState().saveError).toEqual({ key: "note:n-1", message: "磁盘只读" });
  });

  it("a failed title save is reported on that document, not as a global error", async () => {
    useData.setState({ notes: [note("甲")] });
    api.noteUpsert.mockRejectedValue(new Error("磁盘只读"));

    await expect(
      useData.getState().saveTitle({ kind: "note", id: "n-1" }, "新标题"),
    ).rejects.toThrow("磁盘只读");
    expect(useData.getState().saveError).toEqual({ key: "note:n-1", message: "磁盘只读" });
    expect(useData.getState().error).toBeNull();
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

describe("initialize", () => {
  it("loads each list with one round trip instead of one per note", async () => {
    const notes = [1, 2, 3].map((n) => ({ ...note(`正文${n}`), id: `n-${n}` }));
    api.noteListFull.mockImplementation(async (archived: boolean) => (archived ? [] : notes));
    api.calendarMarked.mockResolvedValue([]);

    await useData.getState().initialize();
    expect(api.noteListFull).toHaveBeenCalledTimes(2);
    expect(api.noteGet).not.toHaveBeenCalled();
    expect(useData.getState().notes.map((item) => item.contentMd)).toEqual([
      "正文1",
      "正文2",
      "正文3",
    ]);
  });
});

describe("deleteNote / undoDelete", () => {
  const three = () => ["a", "b", "c"].map((id) => ({ ...note(id), id, title: id.toUpperCase() }));

  it("offers an undo that puts the note back where it was, with fresh content", async () => {
    useData.setState({ notes: three() });
    api.noteDelete.mockResolvedValue(undefined);
    api.noteUndelete.mockResolvedValue(undefined);
    // 删之前失焦触发的保存可能晚一步落库：撤销后用库里的版本
    api.noteGet.mockResolvedValue({ ...note("删之前刚存的"), id: "b", title: "B" });

    await useData.getState().deleteNote("b");
    expect(useData.getState().notes.map((item) => item.id)).toEqual(["a", "c"]);
    expect(useData.getState().lastDeleted?.note.id).toBe("b");

    expect(await useData.getState().undoDelete()).toBe("b");
    expect(api.noteUndelete).toHaveBeenCalledWith("b");
    expect(useData.getState().notes.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(useData.getState().notes[1]?.contentMd).toBe("删之前刚存的");
    expect(useData.getState().lastDeleted).toBeNull();
  });

  it("waits for an in-flight delete before undoing it", async () => {
    useData.setState({ notes: three() });
    let finishDelete = () => {};
    const order: string[] = [];
    api.noteDelete.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = () => {
            order.push("deleted");
            resolve();
          };
        }),
    );
    api.noteUndelete.mockImplementation(async () => {
      order.push("undeleted");
    });
    api.noteGet.mockResolvedValue({ ...note("b"), id: "b" });

    const deleting = useData.getState().deleteNote("b");
    const undoing = useData.getState().undoDelete();
    await Promise.resolve();
    finishDelete();
    await Promise.all([deleting, undoing]);
    expect(order).toEqual(["deleted", "undeleted"]);
    expect(useData.getState().notes.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("rolls a failed delete back into place and withdraws the undo", async () => {
    useData.setState({ notes: three() });
    api.noteDelete.mockRejectedValue(new Error("磁盘只读"));

    await useData.getState().deleteNote("b");
    expect(useData.getState().notes.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(useData.getState().lastDeleted).toBeNull();
    expect(useData.getState().error).toBe("磁盘只读");
  });

  it("does nothing once the undo was dismissed", async () => {
    useData.setState({ notes: three() });
    api.noteDelete.mockResolvedValue(undefined);
    await useData.getState().deleteNote("b");
    useData.getState().dismissUndo();

    expect(await useData.getState().undoDelete()).toBeNull();
    expect(api.noteUndelete).not.toHaveBeenCalled();
  });
});

describe("drafts（保存失败的正文）", () => {
  const target = { kind: "note", id: "n-1" } as const;

  it("keeps a failed version as a draft and clears it once a save succeeds", async () => {
    useData.setState({ notes: [note("原文")] });
    api.noteUpsert.mockRejectedValueOnce(new Error("database is locked"));
    await expect(useData.getState().saveDocument(target, "没存进去的字")).rejects.toThrow();
    // 编辑器卸载后它的保存队列就没了，这一版只剩 store 里这份
    expect(useData.getState().drafts["note:n-1"]?.contentMd).toBe("没存进去的字");

    api.noteUpsert.mockResolvedValue("n-1");
    api.noteGet.mockResolvedValue(note("没存进去的字，又写了一点"));
    await useData.getState().saveDocument(target, "没存进去的字，又写了一点");
    expect(useData.getState().drafts).toEqual({});
  });

  it("flushDrafts retries drafts left by editors that are gone", async () => {
    useData.setState({
      notes: [note("原文")],
      drafts: { "note:n-1": { target, contentMd: "草稿" } },
    });
    api.noteUpsert.mockResolvedValue("n-1");
    api.noteGet.mockResolvedValue(note("草稿"));

    await useData.getState().flushDrafts();
    expect(api.noteUpsert).toHaveBeenCalledWith(expect.objectContaining({ contentMd: "草稿" }));
    expect(useData.getState().drafts).toEqual({});
    expect(useData.getState().notes[0]?.contentMd).toBe("草稿");
  });

  it("flushDrafts rejects while the backend still fails, keeping the draft", async () => {
    useData.setState({
      notes: [note("原文")],
      drafts: { "note:n-1": { target, contentMd: "草稿" } },
    });
    api.noteUpsert.mockRejectedValue(new Error("database is locked"));
    await expect(useData.getState().flushDrafts()).rejects.toThrow("database is locked");
    expect(useData.getState().drafts["note:n-1"]?.contentMd).toBe("草稿");
  });
});

describe("applyVaultChange（别的程序改了仓库里的文件）", () => {
  it("refreshes a changed note and marks it as an external revision", async () => {
    useData.setState({ notes: [note("旧的")] });
    api.noteGet.mockResolvedValue(note("别处改的"));

    await useData.getState().applyVaultChange(change({ notes: ["n-1"] }));
    expect(useData.getState().notes[0]?.contentMd).toBe("别处改的");
    expect(useData.getState().externalRevisions["note:n-1"]).toBe(1);
  });

  it("does not count a refresh that changed nothing in the body", async () => {
    useData.setState({ notes: [note("一样")] });
    api.noteGet.mockResolvedValue({ ...note("一样"), isPinned: true });

    await useData.getState().applyVaultChange(change({ notes: ["n-1"] }));
    expect(useData.getState().notes[0]?.isPinned).toBe(true);
    expect(useData.getState().externalRevisions["note:n-1"]).toBeUndefined();
  });

  it("adds new files, moves archived ones and drops deleted ones", async () => {
    useData.setState({ notes: [note("x"), { ...note("y"), id: "n-2" }] });
    api.noteGet.mockImplementation(async (id: string) => {
      if (id === "n-new") return { ...note("新文件"), id: "n-new" };
      if (id === "n-2") return { ...note("y"), id: "n-2", isArchived: true };
      throw { kind: "NotFound", message: `note ${id}` };
    });

    await useData.getState().applyVaultChange(change({ notes: ["n-new", "n-2", "n-1"] }));
    const state = useData.getState();
    expect(state.notes.map((item) => item.id)).toEqual(["n-new"]);
    expect(state.archived.map((item) => item.id)).toEqual(["n-2"]);
    expect(state.error).toBeNull();
  });

  it("only refreshes the tasks of cached days when just the tasks changed", async () => {
    // 那一天的编辑器可能正有没存的修改：只是任务变了的话正文不能动
    useData.setState({ dayDocs: [day("编辑器里的正文")] });
    const task = {
      id: "n-1#2",
      title: "交稿",
      status: "todo" as const,
      meta: null,
      dueDate: "2026-08-29",
      timeLabel: null,
      category: null,
    };
    api.calendarDay.mockResolvedValue(day("磁盘上的正文", { tasks: [task] }));
    api.calendarMarked.mockResolvedValue(["2026-08-29", "2026-09-04"]);

    await useData.getState().applyVaultChange(change({ tasks: true }));
    const state = useData.getState();
    expect(state.dayDocs[0]?.noteMd).toBe("编辑器里的正文");
    expect(state.dayDocs[0]?.tasks).toEqual([task]);
    expect(state.tasks["n-1#2"]).toEqual(task);
    expect([...state.markedDates]).toEqual(["2026-08-29", "2026-09-04"]);
  });

  it("leaves days and goals that were never opened alone", async () => {
    await useData
      .getState()
      .applyVaultChange(change({ days: ["2026-08-29"], goals: ["week:2026-08-24"] }));
    expect(api.calendarDay).not.toHaveBeenCalled();
    expect(api.goalGet).not.toHaveBeenCalled();
  });

  it("tells the user where a conflicting external edit went", async () => {
    api.noteGet.mockResolvedValue({ ...note("磁盘上的"), id: "n-copy" });
    await useData
      .getState()
      .applyVaultChange(change({ notes: ["n-copy"], conflicts: ["周报 (冲突 2026-09-27 1030)"] }));
    expect(useData.getState().notice).toContain("周报 (冲突 2026-09-27 1030)");
    expect(useData.getState().notes[0]?.id).toBe("n-copy");
  });
});

describe("外部改动撞上没存的修改", () => {
  it("keeps the disk version as a conflict copy before saving the editor's", async () => {
    useData.setState({ notes: [note("别处改的")] });
    const order: string[] = [];
    api.vaultKeepConflictCopy.mockImplementation(async () => {
      order.push("copy");
      return "笔记 (冲突 2026-09-27 1030)";
    });
    api.noteUpsert.mockImplementation(async () => {
      order.push("save");
      return "n-1";
    });
    api.noteGet.mockResolvedValue(note("编辑器里的"));

    useData.getState().markConflict({ kind: "note", id: "n-1" });
    await useData.getState().saveDocument({ kind: "note", id: "n-1" }, "编辑器里的");
    expect(order).toEqual(["copy", "save"]);
    expect(api.vaultKeepConflictCopy).toHaveBeenCalledWith({ kind: "note", id: "n-1" });
    expect(useData.getState().conflicts.size).toBe(0);

    // 只另存一次：之后的保存照常
    await useData.getState().saveDocument({ kind: "note", id: "n-1" }, "编辑器里的，又改了");
    expect(api.vaultKeepConflictCopy).toHaveBeenCalledTimes(1);
  });
});

describe("revealDocument", () => {
  it("reports why the folder could not be opened", async () => {
    api.vaultReveal.mockRejectedValue({ kind: "Io", message: "打开文件夹失败: 没有这个文件" });
    await useData.getState().revealDocument({ kind: "note", id: "n-1" });
    expect(useData.getState().error).toBe("打开文件夹失败: 没有这个文件");
  });
});
