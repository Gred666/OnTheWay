import { type Result as IpcResult, commands } from "@/lib/bindings";
import { isTauri } from "@/lib/tauri";
import type { DayDoc, Goal, Note, NoteInput, NoteSummary, SearchResult, Task } from "./types";

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
  noteGet(id: string): Promise<Note>;
  noteUpsert(input: NoteInput): Promise<string>;
  noteSetPinned(id: string, pinned: boolean): Promise<void>;
  noteArchive(id: string, category?: string): Promise<void>;
  noteRestore(id: string): Promise<void>;
  noteDelete(id: string): Promise<void>;
  searchNotes(query: string, limit: number): Promise<SearchResult>;
  taskToggle(id: string): Promise<Task>;
  goalLatest(horizon: "week" | "month" | "year"): Promise<Goal>;
  goalSave(id: string, contentMd: string): Promise<Goal>;
  calendarDay(date: string): Promise<DayDoc>;
  calendarDaySave(date: string, noteMd: string): Promise<DayDoc>;
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
  searchNotes: (query, limit) =>
    unwrap(commands.searchNotes(query, limit)) as Promise<SearchResult>,
  taskToggle: (id) => unwrap(commands.taskToggle(id)) as Promise<Task>,
  goalLatest: (horizon) => unwrap(commands.goalLatest(horizon)) as Promise<Goal>,
  goalSave: (id, contentMd) => unwrap(commands.goalSave(id, contentMd)) as Promise<Goal>,
  calendarDay: (date) => unwrap(commands.calendarDay(date)) as Promise<DayDoc>,
  calendarDaySave: (date, noteMd) =>
    unwrap(commands.calendarDaySave(date, noteMd)) as Promise<DayDoc>,
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
