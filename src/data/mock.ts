import { formatMonthDayCN, goalTitle, periodStartOf } from "@/lib/date";
import { countWords, makeExcerpt } from "@/lib/plainText";
import { contextLine, findWikiLinks, sameTitle } from "@/lib/wikilinks";
import type { Backend } from "./backend";
import { seedArchivedRaw, seedDayNotes, seedGoalsRaw, seedNotesRaw, seedTasksRaw } from "./seed";
import {
  type Backlink,
  type DayDoc,
  type Goal,
  type GoalHorizon,
  type Note,
  type NoteInput,
  type SearchResult,
  type Task,
  type VaultInfo,
  goalKey,
} from "./types";

/* ============================================================
   浏览器 mock 后端。

   只在 `pnpm dev` 直开 1420 端口调 UI 时用；桌面版走 Rust（仓库文件夹里的 .md 文件）。
   语义尽量贴近 Rust 实现（删除可撤销、归档清置顶、置顶排前），
   这样在浏览器里看到的行为和真机一致。跟文件打交道的操作（在文件夹中显示…）只在桌面版里有。
   带日期的任务在这里是一份独立的列表，不从正文里解析。

   状态存在 localStorage，改了 seed 想清空就升版本号。
   ============================================================ */

// v3：「今日TODO」从笔记 n-today 变成带标题的 day_doc，GOAL 改成一个周期一篇
// v4：笔记带上 relPath / conflictOf，多一篇冲突副本的演示
const LS_KEY = "otw.mock.v4";

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
    notes: [...seedNotesRaw, ...seedArchivedRaw, demoConflictCopy()].map((n) => ({ ...n })),
    tasks: Object.fromEntries(seedTasksRaw.map((t) => [t.id, { ...t }])),
    days: Object.fromEntries(Object.entries(seedDayNotes).map(([d, v]) => [d, { ...v }])),
    goals: Object.fromEntries(
      seedGoalsRaw.map((g) => [goalKey(g.horizon, g.periodStart), { ...g }]),
    ),
  };
}

/**
 * 浏览器预览里演示「网盘的冲突副本」：另一台机器上也改了「8月阅读摘录」，同步时
 * 撞车，网盘把那一版另存成了这一篇。（桌面版里由 Rust 按文件名和属性块 id 认出来）
 */
function demoConflictCopy(): Note {
  const original = seedNotesRaw.find((note) => note.id === "n-reading")!;
  const contentMd = original.contentMd.replace(
    "## 待读",
    "## 另一台电脑上补的\n\n地铁上读完了城市步行那本：好的街道让人愿意多走一个路口。\n\n## 待读",
  );
  return {
    ...original,
    id: "n-reading-conflict",
    title: "8月阅读摘录 (冲突 2026-08-28 2210)",
    contentMd,
    excerpt: makeExcerpt(contentMd, 60),
    wordCount: countWords(contentMd),
    relPath: "笔记/8月阅读摘录 (冲突 2026-08-28 2210).md",
    updatedAt: original.updatedAt - 60_000,
    conflictOf: null,
  };
}

/** 冲突副本的名字（和 Rust 侧 layout::conflict_originals 的常见几种一样），原文的标题 */
function conflictOriginalTitle(title: string): string | null {
  const patterns = [
    /^(.*?)\s*[(（][^()（）]*(?:冲突|conflict)[^()（）]*[)）](?: \d+)?$/i,
    /^(.*?)\.sync-conflict-\d{8}-\d{6}(?:-[A-Z0-9]+)?$/,
    /^(.*?)\s*[(（]\d+[)）]$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(title);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

/** 给前端的那一份：算上它是不是谁的冲突副本 */
function present(note: Note): Note {
  const originalTitle = conflictOriginalTitle(note.title);
  const original = originalTitle
    ? state.notes.find((other) => other.id !== note.id && other.title === originalTitle)
    : undefined;
  return {
    ...note,
    relPath: note.relPath ?? `${note.isArchived ? "归档" : "笔记"}/${note.title}.md`,
    conflictOf: original?.id ?? null,
  };
}

const dayRelPath = (date: string) => `日记/${date.slice(0, 4)}/${date}.md`;
const goalRelPath = (periodStart: string) => `目标/${periodStart.slice(0, 4)}/${periodStart}.md`;

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

function notFound(what: string): never {
  throw { kind: "NotFound", message: what };
}

/** 浏览器预览里没有仓库文件夹：跟文件打交道的操作只在桌面版里有 */
function desktopOnly(): never {
  throw { kind: "Invalid", message: "浏览器预览里没有本地文件，桌面版里才能打开笔记文件夹" };
}

const emptyGoal = (horizon: GoalHorizon, periodStart: string): Goal => ({
  id: "",
  horizon,
  title: "",
  periodStart,
  contentMd: "",
  createdAt: 0,
  updatedAt: 0,
  relPath: goalRelPath(periodStart),
});

export const mockBackend: Backend = {
  async noteListFull(archived) {
    await tick();
    return listed(archived).map(present);
  },

  async noteGet(id) {
    await tick();
    const n = state.notes.find((x) => x.id === id);
    if (!n) notFound(`note ${id}`);
    return present(n);
  },

  async noteUpsert(input: NoteInput) {
    await tick();
    const now = Date.now();
    const id = input.id ?? crypto.randomUUID();
    const current = state.notes.find((x) => x.id === id);
    const contentMd = input.contentMd;
    const excerpt = makeExcerpt(contentMd, 60);

    if (current) {
      if (current.title !== input.title) {
        current.relPath = `${current.isArchived ? "归档" : "笔记"}/${input.title}.md`;
      }
      current.title = input.title;
      current.contentMd = contentMd;
      current.excerpt = excerpt;
      current.wordCount = countWords(contentMd);
      current.updatedAt = now;
    } else {
      state.notes.unshift({
        id,
        title: input.title,
        contentMd,
        excerpt,
        wordCount: countWords(contentMd),
        isPinned: false,
        isArchived: false,
        archiveCategory: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        relPath: `笔记/${input.title}.md`,
        conflictOf: null,
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

  async noteBacklinks(id): Promise<Backlink[]> {
    await tick();
    const note = state.notes.find((x) => x.id === id);
    if (!note) notFound(`note ${id}`);
    const sources: Omit<Backlink, "lines" | "count">[] = [];
    const bodies: string[] = [];
    for (const other of state.notes) {
      if (other.id === id) continue;
      sources.push({
        target: { kind: "note", id: other.id },
        kind: "note",
        title: other.title,
        archived: other.isArchived,
        updatedAt: other.updatedAt,
      });
      bodies.push(other.contentMd);
    }
    for (const [date, day] of Object.entries(state.days)) {
      sources.push({
        target: { kind: "day", id: date },
        kind: "day",
        title: day.title ? `${formatMonthDayCN(date)} · ${day.title}` : formatMonthDayCN(date),
        archived: false,
        updatedAt: day.updatedAt,
      });
      bodies.push(day.noteMd);
    }
    for (const goal of Object.values(state.goals)) {
      sources.push({
        target: { kind: "goal", horizon: goal.horizon, periodStart: goal.periodStart },
        kind: "goal",
        title: goalTitle(goal.horizon, goal.periodStart),
        archived: false,
        updatedAt: goal.updatedAt,
      });
      bodies.push(goal.contentMd);
    }
    const out: Backlink[] = [];
    sources.forEach((source, index) => {
      const body = bodies[index]!;
      const hits = findWikiLinks(body).filter((hit) => sameTitle(hit.title, note.title));
      if (!hits.length) return;
      const rows = body.split("\n");
      const lines = [...new Set(hits.map((hit) => hit.line))]
        .slice(0, 3)
        .map((line) => ({ line, text: contextLine(rows[line] ?? "") }));
      out.push({ ...source, lines, count: hits.length });
    });
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
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
    return g ? { ...g, relPath: goalRelPath(periodStart) } : emptyGoal(horizon, periodStart);
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
    const relPath = dayRelPath(date);
    if (own) return { date, tasks, ...own, carriedFrom: null, relPath };

    const previous = carryOver
      ? Object.keys(state.days)
          .filter((d) => d < date && (state.days[d]!.noteMd || state.days[d]!.title))
          .sort()
          .pop()
      : undefined;
    if (previous) {
      return { date, tasks, ...state.days[previous]!, carriedFrom: previous, relPath };
    }

    return {
      date,
      title: "",
      tasks,
      noteMd: "",
      updatedAt: Date.now(),
      carriedFrom: null,
      relPath,
    };
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

  async vaultInfo(): Promise<VaultInfo> {
    await tick();
    return {
      root: "浏览器预览（localStorage）",
      notes: state.notes.filter((n) => !n.isArchived).length,
      archived: state.notes.filter((n) => n.isArchived).length,
      days: Object.keys(state.days).length,
      goals: Object.keys(state.goals).length,
      tasks: Object.values(state.tasks).filter((t) => t.dueDate).length,
    };
  },

  async vaultReveal() {
    await tick();
    desktopOnly();
  },

  async vaultOpenFolder() {
    await tick();
    desktopOnly();
  },

  async vaultKeepConflictCopy() {
    await tick();
    return null;
  },

  async vaultChangeRoot() {
    await tick();
    desktopOnly();
  },

  // 浏览器里没有仓库文件夹：粘贴的图片直接写成 data: 地址插进正文
  async vaultAttach(_target, name, dataBase64) {
    await tick();
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const mime: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
    };
    const type = mime[ext];
    return {
      link: `data:${type ?? "application/octet-stream"};base64,${dataBase64}`,
      name,
      isImage: !!type,
    };
  },

  async vaultAttachPath() {
    await tick();
    desktopOnly();
  },

  // 浏览器里没有别的程序会改这些数据
  async onVaultChanged() {
    return () => {};
  },
};
