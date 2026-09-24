import type { ISODate } from "@/lib/date";
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
  error: string | null;
  /** 正在保存的文档，键为 `kind:id`。界面据此显示「保存中」。 */
  savingDocs: Set<string>;
  /** 最近一次保存失败的原因。null 表示一切正常。 */
  saveError: string | null;
  clearSaveError: () => void;

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
   */
  forgetCarriedDays: () => void;
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

function taskMapFrom(notes: Note[], goals: Goal[], days: DayDoc[]): Record<string, Task> {
  const all = [
    ...notes.flatMap((note) => note.actionGroup?.tasks ?? []),
    ...goals.flatMap((goal) => goal.actionGroup?.tasks ?? []),
    ...days.flatMap((day) => day.tasks),
  ];
  return Object.fromEntries(all.map((task) => [task.id, task]));
}

const withGoal = (goals: Record<string, Goal>, goal: Goal): Record<string, Goal> => ({
  ...goals,
  [goalKey(goal.horizon, goal.periodStart)]: goal,
});

const withDay = (days: DayDoc[], day: DayDoc): DayDoc[] => [
  ...days.filter((item) => item.date !== day.date),
  day,
];

function patchTask(state: DataState, id: string, task: Task): Partial<DataState> {
  const inGroup = (group: Note["actionGroup"]): Note["actionGroup"] =>
    group ? { ...group, tasks: group.tasks.map((item) => (item.id === id ? task : item)) } : null;
  return {
    tasks: { ...state.tasks, [id]: task },
    notes: state.notes.map((note) => ({ ...note, actionGroup: inGroup(note.actionGroup) })),
    goals: Object.fromEntries(
      Object.entries(state.goals).map(([key, goal]) => [
        key,
        {
          ...goal,
          actionGroup: goal.actionGroup
            ? {
                ...goal.actionGroup,
                tasks: goal.actionGroup.tasks.map((item) => (item.id === id ? task : item)),
              }
            : null,
        },
      ]),
    ),
    dayDocs: state.dayDocs.map((day) => ({
      ...day,
      tasks: day.tasks.map((item) => (item.id === id ? task : item)),
    })),
  };
}

let initializePromise: Promise<void> | null = null;

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
  savingDocs: new Set(),
  saveError: null,
  clearSaveError: () => set({ saveError: null }),

  initialize: async () => {
    if (get().initialized) return;
    if (initializePromise) return initializePromise;

    set({ loading: true, error: null });
    initializePromise = (async () => {
      try {
        const api = await backend();
        const [activeSummaries, archivedSummaries, marked] = await Promise.all([
          api.noteList(false),
          api.noteList(true),
          api.calendarMarked("2000-01-01", "2100-12-31"),
        ]);

        const [notes, archived] = await Promise.all([
          Promise.all(activeSummaries.map((note) => api.noteGet(note.id))),
          Promise.all(archivedSummaries.map((note) => api.noteGet(note.id))),
        ]);

        // 目标和某天的文档都按需取：切到哪个周期 / 哪一天再 loadGoal / loadDay
        set({
          notes: notes.sort(noteOrder),
          archived,
          tasks: taskMapFrom(notes, [], []),
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
      set((state) => ({
        goals: withGoal(state.goals, goal),
        tasks: {
          ...state.tasks,
          ...Object.fromEntries((goal.actionGroup?.tasks ?? []).map((task) => [task.id, task])),
        },
      }));
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  forgetCarriedDays: () =>
    set((state) =>
      state.dayDocs.some((day) => day.carriedFrom)
        ? { dayDocs: state.dayDocs.filter((day) => !day.carriedFrom) }
        : {},
    ),

  searchNotes: async (query) => (await backend()).searchNotes(query, 200),

  saveDocument: async (target, contentMd) => {
    const key = saveKeyOf(target);

    /** 真正写库的部分。三种目标各自判重后再落盘。 */
    const write = async (): Promise<boolean> => {
      if (target.kind === "goal") {
        const { horizon, periodStart } = target;
        const source = get().goals[goalKey(horizon, periodStart)];
        // 这个周期还没取回来就别写：编辑器是空的，一输入会把已有的目标整篇覆盖
        if (!source || source.contentMd === contentMd) return false;
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
        if (!source || source.noteMd === contentMd) return false;
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
      if (!source || source.contentMd === contentMd) return false;

      const api = await backend();
      await api.noteUpsert({ id, title: source.title, contentMd, icon: source.icon });
      const updated = await api.noteGet(id);
      set((state) => ({
        // 刻意不重排：自动保存每 400ms 刷新一次 updatedAt，
        // 按它排序会让正在编辑的这篇笔记在侧栏里当着用户的面往上跳。
        // 顺序在下次加载 / 置顶 / 归档时自然会更新。
        notes: state.notes.map((note) => (note.id === id ? updated : note)),
        archived: state.archived.map((note) => (note.id === id ? updated : note)),
        tasks: {
          ...state.tasks,
          ...Object.fromEntries((updated.actionGroup?.tasks ?? []).map((task) => [task.id, task])),
        },
      }));
      return true;
    };

    set((state) => ({ savingDocs: new Set(state.savingDocs).add(key) }));
    try {
      await write();
      set({ saveError: null, error: null });
    } catch (error) {
      // 保存失败必须能被界面看见 —— 光写进 store 没人读等于没说。
      set({ saveError: messageOf(error), error: messageOf(error) });
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
        icon: null,
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

    try {
      const api = await backend();

      if (target.kind === "day") {
        const source = get().dayDocs.find((day) => day.date === target.id);
        if (!source || source.title === cleanTitle) return;
        // 延续来的今天在这里第一次落库：正文照延续的存，标题换成新的
        const updated = await api.calendarDaySave(target.id, cleanTitle, source.noteMd);
        set((state) => ({
          dayDocs: withDay(state.dayDocs, updated),
          markedDates: new Set(state.markedDates).add(target.id),
          error: null,
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
        icon: source.icon,
      });
      const updated = await api.noteGet(id);
      set((state) => ({
        // 同样不重排：改标题时列表在脚下跳一下同样很吓人。
        notes: state.notes.map((note) => (note.id === id ? updated : note)),
        archived: state.archived.map((note) => (note.id === id ? updated : note)),
        error: null,
      }));
    } catch (error) {
      set({ error: messageOf(error) });
      throw error;
    }
  },

  toggleTask: async (id) => {
    const current = get().tasks[id];
    if (!current) return;
    const done = current.status === "done";
    const optimistic: Task = {
      ...current,
      status: done ? "todo" : "done",
      completedAt: done ? null : Date.now(),
      updatedAt: Date.now(),
    };
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
    const previous = get().notes.find((note) => note.id === id);
    if (!previous) return;
    set((state) => ({ notes: state.notes.filter((note) => note.id !== id) }));
    try {
      await (await backend()).noteDelete(id);
    } catch (error) {
      set((state) => ({
        notes: [previous, ...state.notes].sort(noteOrder),
        error: messageOf(error),
      }));
    }
  },
}));

/** 保存中状态的键：和 DocumentView 里 savingDocs.has(saveKey(doc)) 用同一个算法 */
export function saveKeyOf(target: DocumentSaveTarget): string {
  if (target.kind === "goal") return `goal:${goalKey(target.horizon, target.periodStart)}`;
  return `${target.kind}:${target.id}`;
}
