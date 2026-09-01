import type { ISODate } from "@/lib/date";

/* ============================================================
   领域类型
   与技术方案 §5.3 的表结构一一对应。
   P5 接 Rust 后端后，这个文件由 tauri-specta 自动生成替换。
   命名保持 camelCase（Rust 侧用 #[serde(rename_all = "camelCase")]）。
   ============================================================ */

export type EntityType = "note" | "task" | "goal" | "event" | "review";

/** 五个导航区。「一切皆文档」——每个区最终都渲染成 DocumentView。 */
export type WorkspaceId = "notes" | "today" | "goal" | "calendar" | "archive";

/* ---------------- 笔记 ---------------- */

/** 完整笔记（含正文）。对应 Rust 的 domain::model::Note。 */
export interface Note {
  id: string;
  title: string;
  /** 正文，Markdown 源码 */
  contentMd: string;
  excerpt: string;
  /** 原型里笔记卡片左侧的小图标 */
  icon: NoteIcon;
  wordCount: number;
  isPinned: boolean;
  isArchived: boolean;
  archiveCategory: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** 挂在这篇笔记下的行动项分组。纯笔记没有。 */
  actionGroup: ActionGroup | null;
}

/**
 * 列表用的轻量结构，不含正文。
 * 一个 300px 宽的列表没必要把每篇全文都传过来。
 */
export interface NoteSummary {
  id: string;
  title: string;
  excerpt: string;
  icon: NoteIcon;
  isPinned: boolean;
  archiveCategory: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type NoteIcon =
  | "pin-place"
  | "circle-check"
  | "sparkle"
  | "bookmark"
  | "file"
  | "target"
  | "calendar";

/* ---------------- 行动项 ----------------
   原型里的「下阶段行动」「检查项」「本周重点」都是这个。
   注意：它不是 markdown 的 `- [ ]`，而是独立 task 实体嵌在文档里，
   有负责人、时间、截止日等元数据。
*/

export interface ActionGroup {
  title: string;
  tasks: Task[];
}

export type TaskStatus = "todo" | "doing" | "done" | "cancelled";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  /** 行动项下方的灰色小字：「负责人 · 以安」「周一 10:00」「截止 9月4日」 */
  meta: string | null;
  priority: number;
  dueDate: ISODate | null;
  /** 「上午」「16:00」「18:30」这类展示用时间 */
  timeLabel: string | null;
  /** 日历视图里事件所属的分类：「产品」「/GOAL」「健康」 */
  category: string | null;
  goalId: string | null;
  sortKey: string;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/* ---------------- 目标 ---------------- */

export type GoalHorizon = "week" | "month" | "year";

export interface Goal {
  id: string;
  horizon: GoalHorizon;
  /** 「本周目标」「八月目标」「2026 年目标」 */
  title: string;
  /** 该周期的起点 */
  periodStart: ISODate;
  contentMd: string;
  /** 行动项之后的正文，如 GOAL 页的「记录」段 */
  afterMd: string;
  actionGroup: ActionGroup | null;
  createdAt: number;
  updatedAt: number;
}

/* ---------------- 日历 ---------------- */

/** 日历某一天的文档。原型里点日期后右侧显示的就是它。 */
export interface DayDoc {
  date: ISODate;
  /** 当天的待办 / 事件 */
  tasks: Task[];
  /** 「备注」段落 */
  noteMd: string;
  updatedAt: number;
}

/* ---------------- 搜索 ---------------- */

export interface SearchHit {
  id: string;
  title: string;
  excerpt: string;
  icon: NoteIcon;
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

/* ---------------- 提醒 ---------------- */

export interface Reminder {
  /** 卡片左上角标签：「提醒」「回顾提醒」 */
  label: string;
  /** 主行：「今天 16:30」「周日 20:00」 */
  when: string;
  /** 副行：「回看行动项」「更新下一周目标」 */
  what: string;
}

/* ---------------- 目录树 ---------------- */

export interface OutlineItem {
  id: string;
  text: string;
  level: 1 | 2;
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
  /** 正文 Markdown（行动项分组之前的部分） */
  bodyMd: string;
  /** 行动项分组 */
  actionGroup?: {
    title: string;
    tasks: Task[];
    /** 隐藏分组标题。日历的当日安排直接列在标题下，没有小标题。 */
    hideHeader?: boolean;
  };
  /**
   * 行动项分组**之后**的正文。
   * 原型的 GOAL 页顺序是「正文 → 本周重点 → 记录」，
   * 行动项夹在中间，所以正文要能分成前后两段。
   */
  bodyAfterMd?: string;
  /** 底部状态栏的分段文字 */
  statusParts: string[];
  /** 是否显示删除按钮（原型里笔记视图右下角有个红色垃圾桶） */
  deletable?: boolean;
}
