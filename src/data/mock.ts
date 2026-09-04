import { countWords } from "@/lib/markdown";
import type { Backend } from "./backend";
import { seedArchivedRaw, seedDayNotes, seedGoalsRaw, seedNotesRaw, seedTasksRaw } from "./seed";
import type { DayDoc, Goal, Note, NoteInput, NoteSummary, SearchResult, Task } from "./types";

/* ============================================================
   浏览器 mock 后端。

   只在 `pnpm dev` 直开 1420 端口调 UI 时用；桌面版走 Rust + SQLite。
   语义尽量贴近 Rust 实现（软删除、归档清置顶、置顶排前），
   这样在浏览器里看到的行为和真机一致。

   状态存在 localStorage，改了 seed 想清空就升版本号。
   ============================================================ */

const LS_KEY = "otw.mock.v1";

interface MockState {
  notes: Note[];
  tasks: Record<string, Task>;
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as MockState;
      if (Array.isArray(p.notes) && p.tasks) return p;
    }
  } catch {
    /* 隐私模式 / 数据损坏：回到种子 */
  }
  return {
    notes: [...seedNotesRaw, ...seedArchivedRaw].map((n) => ({ ...n })),
    tasks: Object.fromEntries(seedTasksRaw.map((t) => [t.id, { ...t }])),
  };
}

function save(s: MockState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* 忽略 */
  }
}

const state: MockState = load();

/** 模拟一点 IPC 往返延迟，免得开发时对真机性能有错觉 */
const tick = () => new Promise<void>((r) => setTimeout(r, 8));

function summary(n: Note): NoteSummary {
  return {
    id: n.id,
    title: n.title,
    excerpt: n.excerpt,
    icon: n.icon,
    isPinned: n.isPinned,
    archiveCategory: n.archiveCategory,
    archivedAt: n.archivedAt,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

function hydrate(n: Note): Note {
  const ids = seedNoteActions[n.id];
  if (!ids) return { ...n, actionGroup: null };
  return {
    ...n,
    actionGroup: {
      title: ids.title,
      tasks: ids.taskIds.map((id) => state.tasks[id]).filter((t): t is Task => !!t),
    },
  };
}

const seedNoteActions: Record<string, { title: string; taskIds: string[] }> = {};

const goalActions: Record<string, { title: string; taskIds: string[] }> = {};

function notFound(what: string): never {
  throw { kind: "NotFound", message: what };
}

export const mockBackend: Backend = {
  async noteList(archived) {
    await tick();
    return state.notes
      .filter((n) => n.isArchived === archived)
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        const key = archived ? "archivedAt" : "updatedAt";
        return (b[key] ?? 0) - (a[key] ?? 0);
      })
      .map(summary);
  },

  async noteGet(id) {
    await tick();
    const n = state.notes.find((x) => x.id === id);
    if (!n) notFound(`note ${id}`);
    return hydrate(n);
  },

  async noteUpsert(input: NoteInput) {
    await tick();
    const now = Date.now();
    const id = input.id ?? crypto.randomUUID();
    const current = state.notes.find((x) => x.id === id);
    const contentMd = input.contentMd;
    const excerpt = contentMd
      .replace(/^\s*(?:#{1,6}|>|[-*])\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);

    if (current) {
      current.title = input.title;
      current.contentMd = contentMd;
      current.icon = input.icon ?? current.icon;
      current.excerpt = excerpt;
      current.wordCount = countWords(contentMd);
      current.updatedAt = now;
    } else {
      state.notes.unshift({
        id,
        title: input.title,
        contentMd,
        excerpt,
        icon: input.icon ?? "file",
        wordCount: countWords(contentMd),
        isPinned: false,
        isArchived: false,
        archiveCategory: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        actionGroup: null,
      });
    }
    save(state);
    return id;
  },

  async noteSetPinned(id, pinned) {
    await tick();
    const n = state.notes.find((x) => x.id === id);
    if (!n) notFound(`note ${id}`);
    n.isPinned = pinned;
    n.updatedAt = Date.now();
    save(state);
  },

  async noteArchive(id, category) {
    await tick();
    const n = state.notes.find((x) => x.id === id);
    if (!n) notFound(`note ${id}`);
    n.isArchived = true;
    n.isPinned = false; // 归档清除置顶，和 Rust 侧一致
    n.archivedAt = Date.now();
    n.archiveCategory = category ?? n.archiveCategory ?? "笔记";
    n.updatedAt = n.archivedAt;
    save(state);
  },

  async noteRestore(id) {
    await tick();
    const n = state.notes.find((x) => x.id === id);
    if (!n) notFound(`note ${id}`);
    n.isArchived = false;
    n.archivedAt = null;
    n.updatedAt = Date.now();
    save(state);
  },

  async noteDelete(id) {
    await tick();
    const i = state.notes.findIndex((x) => x.id === id);
    if (i < 0) notFound(`note ${id}`);
    state.notes.splice(i, 1);
    save(state);
  },

  async searchNotes(query, limit): Promise<SearchResult> {
    await tick();
    const q = query.trim().toLowerCase();
    if (!q) return { hits: [], tokens: [] };
    const hits = state.notes
      .filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.contentMd.toLowerCase().includes(q) ||
          n.excerpt.toLowerCase().includes(q),
      )
      .slice(0, limit)
      .map((n) => ({
        id: n.id,
        title: n.title,
        excerpt: n.excerpt,
        icon: n.icon,
        isArchived: n.isArchived,
        updatedAt: n.updatedAt,
        score: 0,
      }));
    return { hits, tokens: [query.trim()] };
  },

  async taskToggle(id) {
    await tick();
    const t = state.tasks[id];
    if (!t) notFound(`task ${id}`);
    const done = t.status === "done";
    t.status = done ? "todo" : "done";
    t.completedAt = done ? null : Date.now();
    t.updatedAt = Date.now();
    save(state);
    return { ...t };
  },

  async goalLatest(horizon): Promise<Goal> {
    await tick();
    const g = seedGoalsRaw.find((x) => x.horizon === horizon);
    if (!g) notFound(`goal ${horizon}`);
    const a = goalActions[g.id];
    return {
      ...g,
      actionGroup: a
        ? {
            title: a.title,
            tasks: a.taskIds.map((id) => state.tasks[id]).filter((t): t is Task => !!t),
          }
        : null,
    };
  },

  async goalSave(id, contentMd): Promise<Goal> {
    await tick();
    const goal = seedGoalsRaw.find((item) => item.id === id);
    if (!goal) notFound(`goal ${id}`);
    goal.contentMd = contentMd;
    goal.updatedAt = Date.now();
    return this.goalLatest(goal.horizon);
  },

  async calendarDay(date): Promise<DayDoc> {
    await tick();
    return {
      date,
      tasks: Object.values(state.tasks).filter((t) => t.dueDate === date),
      noteMd: seedDayNotes[date] ?? "",
      updatedAt: Date.now(),
    };
  },

  async calendarDaySave(date, noteMd): Promise<DayDoc> {
    await tick();
    seedDayNotes[date] = noteMd;
    return this.calendarDay(date);
  },

  async calendarMarked(from, to) {
    await tick();
    const set = new Set<string>();
    for (const t of Object.values(state.tasks)) if (t.dueDate) set.add(t.dueDate);
    for (const d of Object.keys(seedDayNotes)) set.add(d);
    return [...set].filter((d) => d >= from && d <= to).sort();
  },
};
