import { periodStartOf } from "@/lib/date";
import { countWords, makeExcerpt } from "@/lib/plainText";
import type { Backend } from "./backend";
import { seedArchivedRaw, seedDayNotes, seedGoalsRaw, seedNotesRaw, seedTasksRaw } from "./seed";
import {
  type DayDoc,
  type Goal,
  type GoalHorizon,
  type Note,
  type NoteInput,
  type NoteSummary,
  type SearchResult,
  type Task,
  goalKey,
} from "./types";

/* ============================================================
   浏览器 mock 后端。

   只在 `pnpm dev` 直开 1420 端口调 UI 时用；桌面版走 Rust + SQLite。
   语义尽量贴近 Rust 实现（软删除、归档清置顶、置顶排前），
   这样在浏览器里看到的行为和真机一致。

   状态存在 localStorage，改了 seed 想清空就升版本号。
   ============================================================ */

// v3：「今日TODO」从笔记 n-today 变成带标题的 day_doc，GOAL 改成一个周期一篇
const LS_KEY = "otw.mock.v3";

interface MockState {
  notes: Note[];
  tasks: Record<string, Task>;
  /** 按日期索引的某天文档（不含任务） */
  days: Record<string, { title: string; noteMd: string; updatedAt: number }>;
  /** 按 `horizon:periodStart` 索引的目标 */
  goals: Record<string, Goal>;
  /** 删掉的笔记。和 Rust 侧的软删除一样可以撤销；旧版存档里没有这一项 */
  trash?: Note[];
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as MockState;
      if (Array.isArray(p.notes) && p.tasks && p.days && p.goals) return p;
    }
  } catch {
    /* 隐私模式 / 数据损坏：回到种子 */
  }
  return {
    notes: [...seedNotesRaw, ...seedArchivedRaw].map((n) => ({ ...n })),
    tasks: Object.fromEntries(seedTasksRaw.map((t) => [t.id, { ...t }])),
    days: Object.fromEntries(Object.entries(seedDayNotes).map(([d, v]) => [d, { ...v }])),
    goals: Object.fromEntries(
      seedGoalsRaw.map((g) => [goalKey(g.horizon, g.periodStart), { ...g }]),
    ),
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

/** 某个列表（笔记 / 归档）的笔记，顺序和 Rust 侧一样：置顶在前，再按更新 / 归档时间倒序 */
function listed(archived: boolean): Note[] {
  const key = archived ? "archivedAt" : "updatedAt";
  return state.notes
    .filter((n) => n.isArchived === archived)
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return (b[key] ?? 0) - (a[key] ?? 0);
    });
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

const emptyGoal = (horizon: GoalHorizon, periodStart: string): Goal => ({
  id: "",
  horizon,
  title: "",
  periodStart,
  contentMd: "",
  actionGroup: null,
  createdAt: 0,
  updatedAt: 0,
});

export const mockBackend: Backend = {
  async noteList(archived) {
    await tick();
    return listed(archived).map(summary);
  },

  async noteListFull(archived) {
    await tick();
    return listed(archived).map(hydrate);
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
    const excerpt = makeExcerpt(contentMd, 60);

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
    const [removed] = state.notes.splice(i, 1);
    state.trash = [...(state.trash ?? []), { ...removed!, updatedAt: Date.now() }];
    save(state);
  },

  async noteUndelete(id) {
    await tick();
    const trash = state.trash ?? [];
    const i = trash.findIndex((x) => x.id === id);
    if (i < 0) notFound(`deleted note ${id}`);
    const [restored] = trash.splice(i, 1);
    state.notes.push(restored!);
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

  /** 某个周期的目标；没写过就是一篇空文档，和 Rust 侧一样不落库 */
  async goalGet(horizon, periodStart): Promise<Goal> {
    await tick();
    if (periodStartOf(horizon, periodStart) !== periodStart) {
      throw { kind: "Invalid", message: `${periodStart} 不是 ${horizon} 周期的起点` };
    }
    const g = state.goals[goalKey(horizon, periodStart)];
    if (!g) return emptyGoal(horizon, periodStart);
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

  async goalSave(horizon, periodStart, contentMd): Promise<Goal> {
    await tick();
    const key = goalKey(horizon, periodStart);
    const now = Date.now();
    const current = state.goals[key];
    state.goals[key] = current
      ? { ...current, contentMd, updatedAt: now }
      : {
          ...emptyGoal(horizon, periodStart),
          id: crypto.randomUUID(),
          contentMd,
          createdAt: now,
          updatedAt: now,
        };
    save(state);
    return this.goalGet(horizon, periodStart);
  },

  /** carryOver：这一天没写过时延续之前最近写过的一天，不落库（和 Rust 侧一致） */
  async calendarDay(date, carryOver): Promise<DayDoc> {
    await tick();
    const tasks = Object.values(state.tasks).filter((t) => t.dueDate === date);
    const own = state.days[date];
    if (own) return { date, tasks, ...own, carriedFrom: null };

    const previous = carryOver
      ? Object.keys(state.days)
          .filter((d) => d < date && (state.days[d]!.noteMd || state.days[d]!.title))
          .sort()
          .pop()
      : undefined;
    if (previous) return { date, tasks, ...state.days[previous]!, carriedFrom: previous };

    return { date, title: "", tasks, noteMd: "", updatedAt: Date.now(), carriedFrom: null };
  },

  async calendarDaySave(date, title, noteMd): Promise<DayDoc> {
    await tick();
    state.days[date] = { title, noteMd, updatedAt: Date.now() };
    save(state);
    return this.calendarDay(date, false);
  },

  async calendarMarked(from, to) {
    await tick();
    const set = new Set<string>();
    for (const t of Object.values(state.tasks)) if (t.dueDate) set.add(t.dueDate);
    for (const [d, v] of Object.entries(state.days)) if (v.noteMd || v.title) set.add(d);
    return [...set].filter((d) => d >= from && d <= to).sort();
  },
};
