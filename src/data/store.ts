import { type ISODate, today } from "@/lib/date";
import { create } from "zustand";
import { backend } from "./backend";
import {
  type DayDoc,
  type DocumentSaveTarget,
  type Goal,
  type GoalHorizon,
  type Note,
  type SearchResult,
  type Task,
  type VaultChange,
  goalKey,
} from "./types";

interface DataState {
  notes: Note[];
  archived: Note[];
  tasks: Record<string, Task>;
  /** 按 `horizon:periodStart` 缓存的目标（见 goalKey）。没写过的周期也会缓存一篇空文档。 */
  goals: Record<string, Goal>;
  /**
   * 按日期缓存的某天文档。「今日TODO」就是今天这一篇 ——
   * 今天还没写过时后端会把之前最近一天延续过来（carriedFrom），用户一编辑才落库。
   */
  dayDocs: DayDoc[];
  markedDates: Set<string>;
  initialized: boolean;
  loading: boolean;
  /** 保存以外的操作（加载、置顶、归档、勾选…）失败的原因，由 ErrorToast 显示。 */
  error: string | null;
  clearError: () => void;
  /** 不是失败、但得让人知道的事（外部改动撞上没存的修改，另存了一份冲突副本）。 */
  notice: string | null;
  clearNotice: () => void;
  /**
   * 每篇文档被外部改动刷新过几次，键同 saveKeyOf。编辑器据此分辨「store 里的正文变了」
   * 是自己的保存回来了，还是别的程序改了文件（见 MarkdownEditor 的 externalRevision）。
   */
  externalRevisions: Record<string, number>;
  /**
   * 外部改动到的时候编辑器里正有没存的修改：这几篇下一次保存前，先让后端把磁盘上
   * 那一版另存成冲突副本 —— 编辑器里的照常存，两边都不丢。键同 saveKeyOf。
   */
  conflicts: Set<string>;
  markConflict: (target: DocumentSaveTarget) => void;
  /** 仓库里别处发生的变化（文件监听、勾任务改了别的文档）：刷新受影响的缓存 */
  applyVaultChange: (change: VaultChange) => Promise<void>;
  /** 在系统的文件管理器里定位这篇文档的文件 */
  revealDocument: (target: DocumentSaveTarget) => Promise<void>;
  openVaultFolder: () => Promise<void>;
  /** 换一个文件夹当仓库。先把编辑器里的都存掉；换成功就整页重载 */
  changeVaultRoot: () => Promise<void>;
  /** 正在保存的文档，键为 `kind:id`。界面据此显示「保存中」。 */
  savingDocs: Set<string>;
  /**
   * 最近一次保存失败：哪篇文档（saveKeyOf 的键）、为什么。只在那篇文档的状态栏里
   * 显示 —— 以前是一个全局字符串，A 篇存失败了，切到 B 篇也挂着「保存失败」。
   * key 为 null 的是不属于某一篇的（关窗时的保存），每篇都显示。
   */
  saveError: { key: string | null; message: string } | null;
  clearSaveError: () => void;
  /**
   * 保存失败、还没落盘的正文，键同 saveKeyOf。编辑器一卸载（切到别的文档），它自己
   * 的保存队列就跟着没了 —— 失败的那一版以前就这样丢了，再打开还是旧内容。现在留在
   * 这里：再打开这篇显示的是它（adapter），下一次保存成功就清掉，关窗时也会再试一次。
   */
  drafts: Record<string, { target: DocumentSaveTarget; contentMd: string }>;
  /** 把所有草稿再存一遍。关窗时在编辑器 flush 之后调用。 */
  flushDrafts: () => Promise<void>;

  initialize: () => Promise<void>;
  /**
   * 取某一天的文档。`asToday` 为 true 时（这一天就是今天）允许延续之前最近的一天。
   * 已缓存的日期不重复取；今天的缓存如果还是延续来的、且又过了一天，会由 loadDay
   * 的调用方通过 todayDate 变化自然刷新。
   */
  loadDay: (date: ISODate, asToday?: boolean) => Promise<void>;
  /** 取某个周期的目标（没写过就是空文档）。已缓存的不重复取。 */
  loadGoal: (horizon: GoalHorizon, periodStart: ISODate) => Promise<void>;
  /**
   * 丢掉缓存里所有「延续来的」某天文档。跨过零点时调：昨天那份延续来的内容
   * 从来不是昨天自己的记录，留着的话翻回昨天会把它当成昨天写的。
   *
   * 新的今天如果缓存着一篇空白文档也一并丢掉：它是还没成为「今天」时取的
   * （比如前一晚在日历里点开过明天），当时没有尝试延续；留着的话 loadDay
   * 命中缓存，今日TODO 就一直是空白，不会延续前一天。
   */
  forgetCarriedDays: (today: ISODate) => void;
  searchNotes: (query: string) => Promise<SearchResult>;
  saveDocument: (target: DocumentSaveTarget, contentMd: string) => Promise<void>;
  /** 新建一篇空笔记，返回后端分配的 id；失败返回 null。 */
  createNote: () => Promise<string | null>;
  /** 改标题：笔记和某一天都行；GOAL 的标题由周期决定，改不了。 */
  saveTitle: (target: DocumentSaveTarget, title: string) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  archiveNote: (id: string) => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  /**
   * 刚删掉、还能撤销的那篇笔记，以及它原来在列表里的位置。撤销提示条据此显示；
   * 只保留最近一篇，提示条消失（dismissUndo）后就不能撤销了。
   */
  lastDeleted: { note: Note; index: number } | null;
  /** 撤销最近一次删除。成功返回恢复的笔记 id，失败或没有可撤销的返回 null。 */
  undoDelete: () => Promise<string | null>;
  dismissUndo: () => void;
}

/**
 * 取一条能给用户看的错误信息。
 * Rust 侧的错误是 `{ kind, message }`，直接 JSON.stringify 会在状态栏里
 * 甩出一坨大括号，得把 message 拆出来。
 */
const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message: unknown };
    if (typeof message === "string" && message) return message;
  }
  return JSON.stringify(error);
};

/** 新笔记 / 还没起标题的某一天的占位标题。空标题存不进去 —— saveTitle 会拒绝空串。 */
export const NEW_NOTE_TITLE = "无标题笔记";

const noteOrder = (a: Note, b: Note) =>
  a.isPinned === b.isPinned ? b.updatedAt - a.updatedAt : a.isPinned ? -1 : 1;

const withGoal = (goals: Record<string, Goal>, goal: Goal): Record<string, Goal> => ({
  ...goals,
  [goalKey(goal.horizon, goal.periodStart)]: goal,
});

/** 放回原来的位置，而不是按排序规则重排 —— 撤销后它应该出现在删掉之前那一行。 */
const insertAt = (notes: Note[], index: number, note: Note): Note[] => [
  ...notes.slice(0, index),
  note,
  ...notes.slice(index),
];

const withDay = (days: DayDoc[], day: DayDoc): DayDoc[] => [
  ...days.filter((item) => item.date !== day.date),
  day,
];

/** 任务只出现在某一天的「当日安排」里 */
function patchTask(state: DataState, id: string, task: Task): Partial<DataState> {
  return {
    tasks: { ...state.tasks, [id]: task },
    dayDocs: state.dayDocs.map((day) => ({
      ...day,
      tasks: day.tasks.map((item) => (item.id === id ? task : item)),
    })),
  };
}

let initializePromise: Promise<void> | null = null;
/** 仓库变化的订阅只装一次（initialize 失败重试时不重复装） */
let vaultSubscription: Promise<() => void> | null = null;

const isNotFound = (error: unknown) =>
  !!error && typeof error === "object" && (error as { kind?: unknown }).kind === "NotFound";

const bumped = (revisions: Record<string, number>, key: string) => ({
  ...revisions,
  [key]: (revisions[key] ?? 0) + 1,
});

/**
 * 同一篇文档的写入排队。标题和正文是两条路保存的，但写的都是整篇
 * （笔记 upsert 带 title + contentMd，某一天带 title + noteMd），各自带着另一半的
 * 旧值：两次写同时在路上时，后落库的会把先落库那次改的另一半覆盖回去。
 * 排队之后，每次写都在上一次把 store 更新完之后才去读 source，带的就是最新的另一半。
 */
const writeQueues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, write: () => Promise<T>): Promise<T> {
  const next = (writeQueues.get(key) ?? Promise.resolve()).then(write);
  const tail = next.catch(() => undefined);
  writeQueues.set(key, tail);
  void tail.then(() => {
    if (writeQueues.get(key) === tail) writeQueues.delete(key);
  });
  return next;
}
/** 正在进行的删除。撤销要排在它后面：删除还没落库就恢复，恢复会扑空，随后删除又生效。 */
let pendingDelete: Promise<unknown> = Promise.resolve();

export const useData = create<DataState>((set, get) => ({
  notes: [],
  archived: [],
  tasks: {},
  goals: {},
  dayDocs: [],
  markedDates: new Set(),
  initialized: false,
  loading: false,
  error: null,
  clearError: () => set({ error: null }),
  notice: null,
  clearNotice: () => set({ notice: null }),
  externalRevisions: {},
  conflicts: new Set(),
  markConflict: (target) =>
    set((state) => ({ conflicts: new Set(state.conflicts).add(saveKeyOf(target)) })),

  applyVaultChange: async (change) => {
    const api = await backend();
    if (change.conflicts.length > 0) {
      set({
        notice: `别处改动了正在编辑的文档，那一版另存为「${change.conflicts.join("」「")}」`,
      });
    }

    for (const id of change.notes) {
      try {
        const fresh = await api.noteGet(id);
        set((state) => {
          const previous =
            state.notes.find((note) => note.id === id) ??
            state.archived.find((note) => note.id === id);
          const place = (list: Note[], belongs: boolean) => {
            if (!belongs) return list.filter((note) => note.id !== id);
            return list.some((note) => note.id === id)
              ? list.map((note) => (note.id === id ? fresh : note))
              : [fresh, ...list];
          };
          return {
            notes: place(state.notes, !fresh.isArchived).sort(noteOrder),
            archived: place(state.archived, fresh.isArchived),
            externalRevisions:
              previous && previous.contentMd !== fresh.contentMd
                ? bumped(state.externalRevisions, `note:${id}`)
                : state.externalRevisions,
          };
        });
      } catch (error) {
        if (!isNotFound(error)) {
          set({ error: messageOf(error) });
          continue;
        }
        // 文件被删了 / 挪出了仓库
        set((state) => ({
          notes: state.notes.filter((note) => note.id !== id),
          archived: state.archived.filter((note) => note.id !== id),
        }));
      }
    }

    const todayDate = today();
    // 只刷新缓存里有的：没打开过的那一天 / 周期，下次切过去时自然会取
    const days = new Set(change.days.filter((date) => get().dayDocs.some((d) => d.date === date)));
    if (change.tasks) for (const day of get().dayDocs) days.add(day.date);
    for (const date of days) {
      try {
        const fresh = await api.calendarDay(date, date === todayDate);
        const contentChanged = change.days.includes(date);
        set((state) => {
          const previous = state.dayDocs.find((day) => day.date === date);
          if (!previous) return {};
          // 只是任务变了：正文不动（编辑器那边可能正有没存的修改）
          const next = contentChanged ? fresh : { ...previous, tasks: fresh.tasks };
          return {
            dayDocs: withDay(state.dayDocs, next),
            tasks: {
              ...state.tasks,
              ...Object.fromEntries(fresh.tasks.map((task) => [task.id, task])),
            },
            externalRevisions:
              contentChanged && previous.noteMd !== fresh.noteMd
                ? bumped(state.externalRevisions, `day:${date}`)
                : state.externalRevisions,
          };
        });
      } catch (error) {
        set({ error: messageOf(error) });
      }
    }

    for (const key of change.goals) {
      if (!get().goals[key]) continue;
      const [horizon, periodStart] = key.split(":") as [GoalHorizon, ISODate];
      try {
        const fresh = await api.goalGet(horizon, periodStart);
        set((state) => ({
          goals: withGoal(state.goals, fresh),
          externalRevisions:
            state.goals[key]?.contentMd !== fresh.contentMd
              ? bumped(state.externalRevisions, `goal:${key}`)
              : state.externalRevisions,
        }));
      } catch (error) {
        set({ error: messageOf(error) });
      }
    }

    if (change.tasks) {
      try {
        const marked = await api.calendarMarked("2000-01-01", "2100-12-31");
        set({ markedDates: new Set(marked) });
      } catch (error) {
        set({ error: messageOf(error) });
      }
    }
  },

  revealDocument: async (target) => {
    try {
      await (await backend()).vaultReveal(target);
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  openVaultFolder: async () => {
    try {
      await (await backend()).vaultOpenFolder();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  changeVaultRoot: async () => {
    try {
      // 先把编辑器里没存的都落进现在的仓库，换过去之后就回不来了。
      // 动态引入：saveBus 自己引用了这个 store，静态引入会成环
      const { flushAllEditors } = await import("@/editor/saveBus");
      await flushAllEditors();
      await get().flushDrafts();
      const info = await (await backend()).vaultChangeRoot();
      if (info) window.location.reload();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  savingDocs: new Set(),
  saveError: null,
  clearSaveError: () => set({ saveError: null }),
  drafts: {},
  flushDrafts: async () => {
    const pending = Object.values(get().drafts);
    await Promise.all(
      pending.map(({ target, contentMd }) => get().saveDocument(target, contentMd)),
    );
  },

  initialize: async () => {
    if (get().initialized) return;
    if (initializePromise) return initializePromise;

    set({ loading: true, error: null });
    initializePromise = (async () => {
      try {
        const api = await backend();
        // 两个列表各一次往返拿回全文。以前是先取摘要列表、再逐篇 noteGet，
        // N 篇笔记就是 N 次 IPC，笔记一多启动就慢。
        const [notes, archived, marked] = await Promise.all([
          api.noteListFull(false),
          api.noteListFull(true),
          api.calendarMarked("2000-01-01", "2100-12-31"),
        ]);

        // 别的程序改了仓库里的文件、或者一次操作连带改了别的文档：刷新受影响的缓存
        vaultSubscription ??= api.onVaultChanged((change) => {
          void get().applyVaultChange(change);
        });

        // 目标和某天的文档都按需取：切到哪个周期 / 哪一天再 loadGoal / loadDay
        set({
          notes: notes.sort(noteOrder),
          archived,
          markedDates: new Set(marked),
          initialized: true,
          loading: false,
        });
      } catch (error) {
        set({ error: messageOf(error), loading: false });
      } finally {
        initializePromise = null;
      }
    })();
    return initializePromise;
  },

  loadDay: async (date, asToday = false) => {
    if (get().dayDocs.some((day) => day.date === date)) return;
    try {
      const day = await (await backend()).calendarDay(date, asToday);
      set((state) => ({
        dayDocs: withDay(state.dayDocs, day),
        tasks: {
          ...state.tasks,
          ...Object.fromEntries(day.tasks.map((task) => [task.id, task])),
        },
      }));
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  loadGoal: async (horizon, periodStart) => {
    if (get().goals[goalKey(horizon, periodStart)]) return;
    try {
      const goal = await (await backend()).goalGet(horizon, periodStart);
      set((state) => ({ goals: withGoal(state.goals, goal) }));
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  forgetCarriedDays: (today) =>
    set((state) => {
      const stale = (day: DayDoc) =>
        !!day.carriedFrom || (day.date === today && !day.title && !day.noteMd);
      return state.dayDocs.some(stale)
        ? { dayDocs: state.dayDocs.filter((day) => !stale(day)) }
        : {};
    }),

  searchNotes: async (query) => (await backend()).searchNotes(query, 200),

  saveDocument: async (target, contentMd) => {
    const key = saveKeyOf(target);

    /**
     * 真正写库的部分。三种目标各自判重后再落盘。返回 false 表示文档还没加载、
     * 什么都没做；true 表示库里已经是这一版了（刚写的，或者本来就一样）。
     */
    const write = async (): Promise<boolean> => {
      if (target.kind === "goal") {
        const { horizon, periodStart } = target;
        const source = get().goals[goalKey(horizon, periodStart)];
        // 这个周期还没取回来就别写：编辑器是空的，一输入会把已有的目标整篇覆盖
        if (!source) return false;
        if (source.contentMd === contentMd) return true;
        const updated = await (await backend()).goalSave(horizon, periodStart, contentMd);
        set((state) => ({ goals: withGoal(state.goals, updated) }));
        return true;
      }

      if (target.kind === "day") {
        const id = target.id;
        const source = get().dayDocs.find((day) => day.date === id);
        // 这一天还没加载完就别写。以前 `source?.noteMd === contentMd` 在
        // source 为 undefined 时不拦截，编辑器又是空的，
        // 于是一输入就把当天原有的备注整篇覆盖掉了。
        if (!source) return false;
        if (source.noteMd === contentMd) return true;
        // 延续来的今天：第一次编辑就带着延续来的标题一起，以今天的身份落库
        const updated = await (await backend()).calendarDaySave(id, source.title, contentMd);
        set((state) => ({
          dayDocs: withDay(state.dayDocs, updated),
          markedDates:
            contentMd.trim() || updated.title || updated.tasks.length > 0
              ? new Set(state.markedDates).add(id)
              : new Set([...state.markedDates].filter((date) => date !== id)),
        }));
        return true;
      }

      const id = target.id;
      const source =
        get().notes.find((note) => note.id === id) ?? get().archived.find((note) => note.id === id);
      if (!source) return false;
      if (source.contentMd === contentMd) return true;

      const api = await backend();
      await api.noteUpsert({ id, title: source.title, contentMd });
      const updated = await api.noteGet(id);
      set((state) => ({
        // 刻意不重排：自动保存每 400ms 刷新一次 updatedAt，
        // 按它排序会让正在编辑的这篇笔记在侧栏里当着用户的面往上跳。
        // 顺序在下次加载 / 置顶 / 归档时自然会更新。
        notes: state.notes.map((note) => (note.id === id ? updated : note)),
        archived: state.archived.map((note) => (note.id === id ? updated : note)),
      }));
      return true;
    };

    set((state) => ({ savingDocs: new Set(state.savingDocs).add(key) }));
    try {
      const stored = await serialized(key, async () => {
        // 外部改动撞上了没存的修改：先把磁盘上那一版另存一份，再写编辑器里的
        if (get().conflicts.has(key)) {
          await (await backend()).vaultKeepConflictCopy(target);
          set((state) => {
            const conflicts = new Set(state.conflicts);
            conflicts.delete(key);
            return { conflicts };
          });
        }
        return write();
      });
      set((state) => ({
        ...(clearsSaveError(state, key) ? { saveError: null } : {}),
        // 编辑器发来的总是整篇的最新内容，存进去了，之前失败的那一版就作废了
        ...(stored && state.drafts[key] ? { drafts: withoutKey(state.drafts, key) } : {}),
      }));
    } catch (error) {
      // 保存失败必须能被界面看见 —— 光写进 store 没人读等于没说。
      set((state) => ({
        saveError: { key, message: messageOf(error) },
        drafts: { ...state.drafts, [key]: { target, contentMd } },
      }));
      throw error;
    } finally {
      set((state) => {
        const savingDocs = new Set(state.savingDocs);
        savingDocs.delete(key);
        return { savingDocs };
      });
    }
  },

  createNote: async () => {
    try {
      const api = await backend();
      // id 传 null 就是新建，真正的 id 由后端分配 —— 所以这里没法乐观更新，
      // 得等一个来回。新建是个一次性动作，不像输入那样每次按键都要响应。
      const id = await api.noteUpsert({
        id: null,
        title: NEW_NOTE_TITLE,
        contentMd: "",
      });
      const created = await api.noteGet(id);
      set((state) => ({ notes: [created, ...state.notes].sort(noteOrder), error: null }));
      return id;
    } catch (error) {
      set({ error: messageOf(error) });
      return null;
    }
  },

  saveTitle: async (target, title) => {
    const cleanTitle = title.trim();
    if (!cleanTitle || target.kind === "goal") return;
    const key = saveKeyOf(target);

    // 和正文的保存排在同一条队里，source 在轮到自己时才读（见 serialized）
    const write = async () => {
      const api = await backend();

      if (target.kind === "day") {
        const source = get().dayDocs.find((day) => day.date === target.id);
        if (!source || source.title === cleanTitle) return;
        // 延续来的今天在这里第一次落库：正文照延续的存，标题换成新的
        const updated = await api.calendarDaySave(target.id, cleanTitle, source.noteMd);
        set((state) => ({
          dayDocs: withDay(state.dayDocs, updated),
          markedDates: new Set(state.markedDates).add(target.id),
        }));
        return;
      }

      const id = target.id;
      const source =
        get().notes.find((note) => note.id === id) ?? get().archived.find((note) => note.id === id);
      if (!source || source.title === cleanTitle) return;

      await api.noteUpsert({
        id,
        title: cleanTitle,
        contentMd: source.contentMd,
      });
      const updated = await api.noteGet(id);
      set((state) => ({
        // 同样不重排：改标题时列表在脚下跳一下同样很吓人。
        notes: state.notes.map((note) => (note.id === id ? updated : note)),
        archived: state.archived.map((note) => (note.id === id ? updated : note)),
      }));
    };

    try {
      await serialized(key, write);
      set((state) => (clearsSaveError(state, key) ? { saveError: null } : {}));
    } catch (error) {
      set({ saveError: { key, message: messageOf(error) } });
      throw error;
    }
  },

  toggleTask: async (id) => {
    const current = get().tasks[id];
    if (!current) return;
    const done = current.status === "done";
    const optimistic: Task = { ...current, status: done ? "todo" : "done" };
    set((state) => patchTask(state, id, optimistic));
    try {
      const saved = await (await backend()).taskToggle(id);
      set((state) => patchTask(state, id, saved));
    } catch (error) {
      set((state) => ({ ...patchTask(state, id, current), error: messageOf(error) }));
    }
  },

  togglePin: async (id) => {
    const previous = get().notes.find((note) => note.id === id);
    if (!previous) return;
    const pinned = !previous.isPinned;
    set((state) => ({
      notes: state.notes
        .map((note) => (note.id === id ? { ...note, isPinned: pinned } : note))
        .sort(noteOrder),
    }));
    try {
      await (await backend()).noteSetPinned(id, pinned);
    } catch (error) {
      set((state) => ({
        notes: state.notes.map((note) => (note.id === id ? previous : note)).sort(noteOrder),
        error: messageOf(error),
      }));
    }
  },

  archiveNote: async (id) => {
    const previous = get().notes.find((note) => note.id === id);
    if (!previous) return;
    const optimistic: Note = {
      ...previous,
      isArchived: true,
      isPinned: false,
      archiveCategory: previous.archiveCategory ?? "笔记",
      archivedAt: Date.now(),
    };
    set((state) => ({
      notes: state.notes.filter((note) => note.id !== id),
      archived: [optimistic, ...state.archived],
    }));
    try {
      const api = await backend();
      await api.noteArchive(id);
      const saved = await api.noteGet(id);
      set((state) => ({
        archived: state.archived.map((note) => (note.id === id ? saved : note)),
      }));
    } catch (error) {
      set((state) => ({
        notes: [previous, ...state.notes].sort(noteOrder),
        archived: state.archived.filter((note) => note.id !== id),
        error: messageOf(error),
      }));
    }
  },

  restoreNote: async (id) => {
    const previous = get().archived.find((note) => note.id === id);
    if (!previous) return;
    const optimistic = { ...previous, isArchived: false, archivedAt: null };
    set((state) => ({
      archived: state.archived.filter((note) => note.id !== id),
      notes: [optimistic, ...state.notes].sort(noteOrder),
    }));
    try {
      const api = await backend();
      await api.noteRestore(id);
      const saved = await api.noteGet(id);
      set((state) => ({
        notes: state.notes.map((note) => (note.id === id ? saved : note)).sort(noteOrder),
      }));
    } catch (error) {
      set((state) => ({
        archived: [previous, ...state.archived],
        notes: state.notes.filter((note) => note.id !== id),
        error: messageOf(error),
      }));
    }
  },

  deleteNote: async (id) => {
    const index = get().notes.findIndex((note) => note.id === id);
    const previous = get().notes[index];
    if (!previous) return;
    set((state) => ({
      notes: state.notes.filter((note) => note.id !== id),
      lastDeleted: { note: previous, index },
    }));
    const request = (async () => (await backend()).noteDelete(id))();
    pendingDelete = request.catch(() => undefined);
    try {
      await request;
    } catch (error) {
      set((state) => ({
        notes: insertAt(state.notes, index, previous),
        lastDeleted: state.lastDeleted?.note.id === id ? null : state.lastDeleted,
        error: messageOf(error),
      }));
    }
  },

  lastDeleted: null,

  undoDelete: async () => {
    const deleted = get().lastDeleted;
    if (!deleted) return null;
    set({ lastDeleted: null });
    const { id } = deleted.note;
    try {
      await pendingDelete;
      // 删除失败的话已经回滚过了，笔记还在列表里，没什么可撤销的
      if (get().notes.some((note) => note.id === id)) return id;
      const api = await backend();
      await api.noteUndelete(id);
      // 重新取一次：删之前失焦触发的那次保存可能比删除晚一步落库，
      // 手里这份未必是最新的正文。
      const restored = await api.noteGet(id);
      set((state) => ({
        notes: state.notes.some((note) => note.id === id)
          ? state.notes
          : insertAt(state.notes, deleted.index, restored),
        error: null,
      }));
      return id;
    } catch (error) {
      set({ error: messageOf(error) });
      return null;
    }
  },

  dismissUndo: () => set({ lastDeleted: null }),
}));

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/** 这篇保存成功之后该不该清掉 saveError：是它自己的，或者是不属于某一篇的（关窗那种）。 */
function clearsSaveError(state: DataState, key: string): boolean {
  return !!state.saveError && (state.saveError.key === key || state.saveError.key === null);
}

/** 保存中状态的键：和 DocumentView 里 savingDocs.has(saveKey(doc)) 用同一个算法 */
export function saveKeyOf(target: DocumentSaveTarget): string {
  if (target.kind === "goal") return `goal:${goalKey(target.horizon, target.periodStart)}`;
  return `${target.kind}:${target.id}`;
}
