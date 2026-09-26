import type { ISODate } from "@/lib/date";

/* ============================================================
   领域类型
   文档都是仓库文件夹里的 Markdown 文件（技术方案 §5）。
   Rust IPC 的宽类型由 tauri-specta 生成到 lib/bindings.ts；这里保留
   视图层需要的窄联合类型，由 data/backend.ts 在边界统一转换。
   命名保持 camelCase（Rust 侧用 #[serde(rename_all = "camelCase")]）。
   ============================================================ */

/** 五个导航区。「一切皆文档」——每个区最终都渲染成 DocumentView。 */
export type WorkspaceId = "notes" | "today" | "goal" | "calendar" | "archive" | "extensions";

/* ---------------- 笔记 ---------------- */

/** 完整笔记（含正文）。对应 Rust 的 domain::model::Note。 */
export interface Note {
  id: string;
  title: string;
  /** 正文，Markdown 源码 */
  contentMd: string;
  excerpt: string;
  wordCount: number;
  isPinned: boolean;
  isArchived: boolean;
  archiveCategory: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NoteInput {
  /** null 是新建 */
  id: string | null;
  title: string;
  contentMd: string;
}

/* ---------------- 任务 ----------------
   日历「当日安排」里的一条。它就是某篇文档正文里带日期的 `- [ ]`：
   `- [ ] 力量训练 @2026-08-29 18:30 #健康`（见 src-tauri/src/vault/tasks.rs）。
   在日历里勾选，改的是原文件里的那一行。
*/

export type TaskStatus = "todo" | "done";

export interface Task {
  /** 所在文档的 id # 行号。只在勾选的那一下用 */
  id: string;
  title: string;
  status: TaskStatus;
  /** 任务下方的灰色小字：「健康 · 18:30 · 本周目标」（分类 · 时间 · 出处） */
  meta: string | null;
  dueDate: ISODate | null;
  /** 「上午」「16:00」「18:30」这类展示用时间 */
  timeLabel: string | null;
  /** 分类：任务里的第一个 #标签 */
  category: string | null;
}

/* ---------------- 目标 ---------------- */

export type GoalHorizon = "week" | "month" | "year";

/**
 * 某个周期（某一周 / 某个月 / 某一年）的目标，一个周期一篇。
 * 键是 horizon + periodStart；还没写过的周期是一篇空文档（id 为空、updatedAt 为 0），
 * 第一次保存时才落库。
 */
export interface Goal {
  /** 还没落库时为空串 */
  id: string;
  horizon: GoalHorizon;
  /** 库里的原始标题；界面展示用 goalTitle() 按周期算，不用它 */
  title: string;
  /** 该周期的起点：周一 / 1 号 / 1 月 1 日 */
  periodStart: ISODate;
  contentMd: string;
  createdAt: number;
  updatedAt: number;
}

/** goals 缓存的键 */
export const goalKey = (horizon: GoalHorizon, periodStart: ISODate) => `${horizon}:${periodStart}`;

/* ---------------- 日历 ---------------- */

/**
 * 某一天的文档：「今日TODO」就是今天这一篇，日历里点到哪天就是哪一篇。
 * 和笔记一样有可编辑的标题。
 */
export interface DayDoc {
  date: ISODate;
  /** 空串表示还没起标题，界面上显示占位「无标题笔记」 */
  title: string;
  /** 当天的待办 / 事件 */
  tasks: Task[];
  noteMd: string;
  updatedAt: number;
  /**
   * 这一天还没写过、内容是从之前最近一天延续来的：那一天的日期。
   * 只有「今天」会延续；用户一编辑就以这一天自己的身份落库。
   */
  carriedFrom: ISODate | null;
}

/* ---------------- 搜索 ---------------- */

export interface SearchHit {
  id: string;
  title: string;
  excerpt: string;
  isArchived: boolean;
  updatedAt: number;
  /** bm25 分数，越小越相关 */
  score: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /**
   * 分词后的查询词。前端拿它在原始正文上做高亮 ——
   * 不能用 SQLite 的 snippet()，那是在分词串上取的，中文会显示成
   * 「今天 开会 讨论 季度 目标」。
   */
  tokens: string[];
}

/* ---------------- 仓库文件夹 ---------------- */

/**
 * 仓库里别处发生的变化：文件被外部程序改了，或者一次操作连带改了别的文档。
 * 由 Rust 的 vault-changed 事件送来，store 据此刷新缓存（applyVaultChange）。
 */
export interface VaultChange {
  /** 变了（或没了）的笔记 id */
  notes: string[];
  /** 变了的某一天 */
  days: ISODate[];
  /** 变了的目标，`week:2026-09-21`（同 goalKey） */
  goals: string[];
  /** 带日期的任务有变化：当日安排和日历上的小圆点要刷新 */
  tasks: boolean;
  /** 这次产生的冲突副本的标题 */
  conflicts: string[];
}

export interface VaultInfo {
  /** 仓库文件夹的绝对路径 */
  root: string;
  notes: number;
  archived: number;
  days: number;
  goals: number;
  tasks: number;
}

/* ---------------- 目录树 ---------------- */

export interface OutlineItem {
  id: string;
  text: string;
  level: 1 | 2;
  /** Markdown 源文中的一基行号，用于编辑器精确跳转。 */
  line: number;
}

/* ============================================================
   统一文档模型
   ★ 整个应用最重要的抽象。
   笔记 / 今日TODO / GOAL / 日历某天 / 归档项 —— 全部归一到这里，
   由同一个 DocumentView 渲染。新增一种内容类型 = 多一个 adapter 映射，
   不需要写新的视图组件。
   ============================================================ */

export interface DocumentModel {
  /** 用于 React key 和滚动位置记忆 */
  key: string;
  title: string;
  /** 标题上方的横幅，如归档视图的「已归档 · 2026年8月18日」 */
  banner?: { icon: "archive"; text: string };
  /** 标题右侧的分段控件 */
  segments?: { group: string; options: string[]; active: string };
  /** 统一的 Markdown 正文 */
  bodyMd: string;
  /** 日历某一天的「当日安排」：别的文档里写着这一天的任务，列在正文后面 */
  dayTasks?: Task[];
  /** 标题上方的一行小字，如日历某天的「9月15日 · 周二」 */
  eyebrow?: string;
  /** 底部状态栏的分段文字 */
  statusParts: string[];
  /** 是否显示删除按钮（原型里笔记视图右下角有个红色垃圾桶） */
  deletable?: boolean;
  /** 所有持久化文档都由同一个 Markdown 编辑器编辑。 */
  editor?: {
    target: DocumentSaveTarget;
    /** 标题也能直接改（笔记、某一天）。GOAL 的标题由周期决定，不能改。 */
    titleEditable?: boolean;
  };
}

export type DocumentSaveTarget =
  | { kind: "note"; id: string }
  | { kind: "goal"; horizon: GoalHorizon; periodStart: ISODate }
  | { kind: "day"; id: ISODate };
