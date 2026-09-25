import { type Result as IpcResult, commands } from "@/lib/bindings";
import { isTauri } from "@/lib/tauri";
import type {
  DayDoc,
  Goal,
  GoalHorizon,
  Note,
  NoteInput,
  NoteSummary,
  SearchResult,
  Task,
} from "./types";

/* ============================================================
   后端访问层。
   ★ 视图和 store 只认这里的接口，不关心数据从哪来。

   在 Tauri 里 → 走 IPC 打 Rust + SQLite
   在浏览器里 → 走 mock（`pnpm dev` 直开 1420 端口时调 UI 用）

   Rust 侧的类型由 tauri-specta 生成到 lib/bindings.ts，
   这里的签名与之对齐；两边不一致时 tsc 会报错。
   ============================================================ */

export interface Backend {
  noteList(archived: boolean): Promise<NoteSummary[]>;
  /** 一个列表的全部笔记（含正文），一次取回。启动时用它，免得逐篇 noteGet。 */
  noteListFull(archived: boolean): Promise<Note[]>;
  noteGet(id: string): Promise<Note>;
  noteUpsert(input: NoteInput): Promise<string>;
  noteSetPinned(id: string, pinned: boolean): Promise<void>;
  noteArchive(id: string, category?: string): Promise<void>;
  noteRestore(id: string): Promise<void>;
  noteDelete(id: string): Promise<void>;
  /** 撤销删除（删除是软删除） */
  noteUndelete(id: string): Promise<void>;
  searchNotes(query: string, limit: number): Promise<SearchResult>;
  taskToggle(id: string): Promise<Task>;
  /** 某个周期的目标；没写过的周期返回空文档（id 为空） */
  goalGet(horizon: GoalHorizon, periodStart: string): Promise<Goal>;
  goalSave(horizon: GoalHorizon, periodStart: string, contentMd: string): Promise<Goal>;
  /** carryOver 只在请求「今天」时传 true：今天还没写过就延续之前最近的一天 */
  calendarDay(date: string, carryOver: boolean): Promise<DayDoc>;
  calendarDaySave(date: string, title: string, noteMd: string): Promise<DayDoc>;
  calendarMarked(from: string, to: string): Promise<string[]>;
}

/* ---------------- Tauri IPC ---------------- */

async function unwrap<T>(request: Promise<IpcResult<T, unknown>>): Promise<T> {
  const result = await request;
  if (result.status === "error") throw result.error;
  return result.data;
}

const tauriBackend: Backend = {
  noteList: (archived) => unwrap(commands.noteList(archived)) as Promise<NoteSummary[]>,
  noteListFull: (archived) => unwrap(commands.noteListFull(archived)) as Promise<Note[]>,
  noteGet: (id) => unwrap(commands.noteGet(id)) as Promise<Note>,
  noteUpsert: (input) => unwrap(commands.noteUpsert(input)),
  noteSetPinned: async (id, pinned) => {
    await unwrap(commands.noteSetPinned(id, pinned));
  },
  noteArchive: async (id, category) => {
    await unwrap(commands.noteArchive(id, category ?? null));
  },
  noteRestore: async (id) => {
    await unwrap(commands.noteRestore(id));
  },
  noteDelete: async (id) => {
    await unwrap(commands.noteDelete(id));
  },
  noteUndelete: async (id) => {
    await unwrap(commands.noteUndelete(id));
  },
  searchNotes: (query, limit) =>
    unwrap(commands.searchNotes(query, limit)) as Promise<SearchResult>,
  taskToggle: (id) => unwrap(commands.taskToggle(id)) as Promise<Task>,
  goalGet: (horizon, periodStart) =>
    unwrap(commands.goalGet(horizon, periodStart)) as Promise<Goal>,
  goalSave: (horizon, periodStart, contentMd) =>
    unwrap(commands.goalSave(horizon, periodStart, contentMd)) as Promise<Goal>,
  calendarDay: (date, carryOver) =>
    unwrap(commands.calendarDay(date, carryOver)) as Promise<DayDoc>,
  calendarDaySave: (date, title, noteMd) =>
    unwrap(commands.calendarDaySave(date, title, noteMd)) as Promise<DayDoc>,
  calendarMarked: (from, to) => unwrap(commands.calendarMarked(from, to)),
};

/* ---------------- 浏览器 mock ---------------- */

// 动态引入：打包进桌面版时这段会被 tree-shake 掉
async function mock(): Promise<Backend> {
  const { mockBackend } = await import("./mock");
  return mockBackend;
}

let resolved: Backend | null = null;

export async function backend(): Promise<Backend> {
  if (resolved) return resolved;
  resolved = isTauri ? tauriBackend : await mock();
  return resolved;
}

/** 同步取用。调用方需保证 `initBackend()` 已经 await 过。 */
export function backendSync(): Backend {
  if (!resolved) throw new Error("backend 未初始化，先 await initBackend()");
  return resolved;
}

export async function initBackend(): Promise<Backend> {
  return backend();
}
