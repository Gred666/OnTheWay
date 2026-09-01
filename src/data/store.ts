import { countWords } from "@/lib/markdown";
import { create } from "zustand";
import {
  seedArchived,
  seedDayDocs,
  seedGoals,
  seedMarkedDates,
  seedNotes,
  seedTasks,
  seedTodayDoc,
} from "./seed";
import type { DayDoc, Goal, Note, Task } from "./types";

/* ============================================================
   数据层。
   ★ P5 接 Rust 后端时，只有这个文件被替换 ——
   把每个 action 换成 commands.xxx() 调用 + TanStack Query 缓存，
   对外暴露的选择器签名保持不变，视图层零改动。

   现在用内存态 + localStorage 顶着，够把交互跑通。
   ============================================================ */

interface DataState {
  notes: Note[];
  archived: Note[];
  tasks: Record<string, Task>;
  goals: Goal[];
  dayDocs: DayDoc[];
  todayDoc: typeof seedTodayDoc;
  markedDates: Set<string>;

  toggleTask: (id: string) => void;
  togglePin: (id: string) => void;
  archiveNote: (id: string) => void;
  restoreNote: (id: string) => void;
  deleteNote: (id: string) => void;
}

/* ============================================================
   持久化。
   数据量很小（9 篇笔记 + 13 个任务，约 10KB），整份存下来即可 ——
   跟种子数据做 diff 那套在「归档一篇笔记」这类操作上会算错，
   而且 P5 上 SQLite 后这一整段都会删掉，不值得做精细。
   改了 seed.ts 想丢掉旧状态，把 LS_KEY 的版本号 +1。
   ============================================================ */

const LS_KEY = "otw.data.v2";

interface Persisted {
  tasks: Record<string, Task>;
  notes: Note[];
  archived: Note[];
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Persisted>;
    if (!p.tasks || !Array.isArray(p.notes) || !Array.isArray(p.archived)) return null;
    return { tasks: p.tasks, notes: p.notes, archived: p.archived };
  } catch {
    // 隐私模式 / 数据损坏：回到种子数据，不要让应用打不开
    return null;
  }
}

function persist(state: DataState) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ tasks: state.tasks, notes: state.notes, archived: state.archived }),
    );
  } catch {
    /* 忽略：持久化失败不影响本次会话 */
  }
}

/* ---------------- 初始化 ---------------- */

const saved = loadPersisted();

const initialTasks: Record<string, Task> =
  saved?.tasks ?? Object.fromEntries(seedTasks.map((t) => [t.id, { ...t }]));

const initialNotes: Note[] = saved?.notes ?? seedNotes.map((n) => ({ ...n }));
const initialArchived: Note[] = saved?.archived ?? seedArchived.map((n) => ({ ...n }));

export const useData = create<DataState>((set, get) => ({
  notes: initialNotes,
  archived: initialArchived,
  tasks: initialTasks,
  goals: seedGoals,
  dayDocs: seedDayDocs,
  todayDoc: seedTodayDoc,
  markedDates: seedMarkedDates,

  toggleTask: (id) => {
    const cur = get().tasks[id];
    if (!cur) return;
    const done = cur.status === "done";
    const next: Task = {
      ...cur,
      status: done ? "todo" : "done",
      completedAt: done ? undefined : Date.now(),
      updatedAt: Date.now(),
    };
    set((s) => ({ tasks: { ...s.tasks, [id]: next } }));
    persist(get());
  },

  togglePin: (id) => {
    set((s) => ({
      notes: s.notes.map((n) =>
        n.id === id ? { ...n, isPinned: !n.isPinned, updatedAt: Date.now() } : n,
      ),
    }));
    persist(get());
  },

  archiveNote: (id) => {
    const note = get().notes.find((n) => n.id === id);
    if (!note) return;
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      archived: [
        {
          ...note,
          isArchived: true,
          isPinned: false,
          archivedAt: Date.now(),
          archiveCategory: note.archiveCategory ?? "笔记",
        },
        ...s.archived,
      ],
    }));
    persist(get());
  },

  restoreNote: (id) => {
    const note = get().archived.find((n) => n.id === id);
    if (!note) return;
    set((s) => ({
      archived: s.archived.filter((n) => n.id !== id),
      notes: [{ ...note, isArchived: false }, ...s.notes],
    }));
    persist(get());
  },

  deleteNote: (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    persist(get());
  },
}));

/* ---------------- 派生选择器 ---------------- */

/**
 * 侧栏 badge 的数字 —— 今日 TODO 的**总条目数**。
 * 原型里 badge 是 3、检查项是 1/3，说明它计的是总数而不是剩余数。
 * 若日后想改成「剩余」，把下面换成 filter(status !== 'done').length 即可。
 */
export function useTodoCount(): number {
  return useData((s) => s.todayDoc.actionGroup.taskIds.length);
}

export function tasksByIds(tasks: Record<string, Task>, ids: string[]): Task[] {
  return ids.map((id) => tasks[id]).filter((t): t is Task => !!t);
}

export { countWords };
