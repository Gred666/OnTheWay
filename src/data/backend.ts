import { isTauri } from "@/lib/tauri";
import type { DayDoc, Goal, Note, NoteSummary, SearchResult, Task } from "./types";

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
  noteSetPinned(id: string, pinned: boolean): Promise<void>;
  noteArchive(id: string, category?: string): Promise<void>;
  noteRestore(id: string): Promise<void>;
  noteDelete(id: string): Promise<void>;
  searchNotes(query: string, limit: number): Promise<SearchResult>;
  taskToggle(id: string): Promise<Task>;
  goalLatest(horizon: "week" | "month" | "year"): Promise<Goal>;
  calendarDay(date: string): Promise<DayDoc>;
  calendarMarked(from: string, to: string): Promise<string[]>;
}

/* ---------------- Tauri IPC ---------------- */

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let invokeImpl: InvokeFn | null = null;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!invokeImpl) {
    const mod = await import("@tauri-apps/api/core");
    invokeImpl = mod.invoke as InvokeFn;
  }
  return invokeImpl<T>(cmd, args);
}

const tauriBackend: Backend = {
  noteList: (archived) => invoke("note_list", { archived }),
  noteGet: (id) => invoke("note_get", { id }),
  noteSetPinned: (id, pinned) => invoke("note_set_pinned", { id, pinned }),
  noteArchive: (id, category) => invoke("note_archive", { id, category: category ?? null }),
  noteRestore: (id) => invoke("note_restore", { id }),
  noteDelete: (id) => invoke("note_delete", { id }),
  searchNotes: (query, limit) => invoke("search_notes", { query, limit }),
  taskToggle: (id) => invoke("task_toggle", { id }),
  goalLatest: (horizon) => invoke("goal_latest", { horizon }),
  calendarDay: (date) => invoke("calendar_day", { date }),
  calendarMarked: (from, to) => invoke("calendar_marked", { from, to }),
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
