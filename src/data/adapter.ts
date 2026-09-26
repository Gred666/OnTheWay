import { useApp } from "@/app/store";
import {
  type ISODate,
  formatDayEyebrowCN,
  formatFullCN,
  formatMonthDayCN,
  formatPeriodCN,
  formatRelativeTime,
  formatTimestampFull,
  goalTitle,
  periodStartOf,
  toISODate,
} from "@/lib/date";
import { NEW_NOTE_TITLE, saveKeyOf, useData } from "./store";
import {
  type DayDoc,
  type DocumentModel,
  type DocumentSaveTarget,
  type Goal,
  type GoalHorizon,
  goalKey,
} from "./types";

/* ============================================================
   把「当前工作区 + 选中项」映射成统一的 DocumentModel。
   ★ 这是「一切皆文档」抽象的落点 ——
   五个视图的差异全部收敛在这一个函数里，
   DocumentView 完全不知道自己在渲染笔记还是日历。

   日历和今日TODO、GOAL 的关系：
   - 今日TODO = 今天这一天的文档；日历里点到今天看到的就是同一篇。
   - 今天还没写过时延续之前最近的一天（carriedFrom），一编辑就以今天落库；
     翻到昨天、前天，看到的是那一天自己的内容。
   - GOAL 一个周期一篇：/GOAL 页看今天所在的周 / 月 / 年，日历的
     周·月·年 看选中日期所在的周期；没写过就是空白。
   ============================================================ */

export function useCurrentDocument(): DocumentModel {
  const workspace = useApp((s) => s.workspace);
  const selectedNoteId = useApp((s) => s.selectedNoteId);
  const selectedArchiveId = useApp((s) => s.selectedArchiveId);
  const selectedDate = useApp((s) => s.selectedDate);
  const todayDate = useApp((s) => s.todayDate);
  const calendarScope = useApp((s) => s.calendarScope);
  const goalHorizon = useApp((s) => s.goalHorizon);

  const notes = useData((s) => s.notes);
  const archived = useData((s) => s.archived);
  const goals = useData((s) => s.goals);
  const dayDocs = useData((s) => s.dayDocs);
  // 保存失败、还没落盘的正文优先于库里的版本：切走再切回来，用户写的东西还在
  const drafts = useData((s) => s.drafts);
  const draftOr = (target: DocumentSaveTarget, stored: string) =>
    drafts[saveKeyOf(target)]?.contentMd ?? stored;

  switch (workspace) {
    /* ---------------- 笔记 ---------------- */
    case "notes": {
      const note = notes.find((n) => n.id === selectedNoteId) ?? notes[0];
      if (!note) return emptyDoc("还没有笔记", "从左侧新建一篇。");

      return {
        key: `note-${note.id}`,
        title: note.title,
        bodyMd: draftOr({ kind: "note", id: note.id }, note.contentMd),
        statusParts: [
          `${note.wordCount} 字`,
          `创建时间 ${formatTimestampFull(note.createdAt)}`,
          `上次更新 ${formatRelativeTime(note.updatedAt)}`,
        ],
        deletable: true,
        editor: { target: { kind: "note", id: note.id }, titleEditable: true },
      };
    }

    /* ---------------- 今日 TODO：就是今天这一天 ---------------- */
    case "today": {
      const day = dayDocs.find((d) => d.date === todayDate);
      return dayDocument(todayDate, day, todayDate, undefined, draftOr);
    }

    /* ---------------- /GOAL：今天所在的周期 ---------------- */
    case "goal": {
      const periodStart = periodStartOf(goalHorizon, todayDate);
      const goal = goals[goalKey(goalHorizon, periodStart)];
      return goalDocument(
        goalHorizon,
        periodStart,
        goal,
        {
          group: "goal",
          options: ["周", "月", "年"],
          active: horizonLabel(goalHorizon),
        },
        draftOr,
      );
    }

    /* ---------------- 日历 ---------------- */
    case "calendar": {
      const segments = {
        group: "calendar",
        options: ["日TODO", "周/GOAL", "月/GOAL", "年/GOAL"],
        active: scopeLabel(calendarScope),
      };

      // 分段切到周/月/年：选中日期所在周期的 GOAL
      if (calendarScope !== "day") {
        const periodStart = periodStartOf(calendarScope, selectedDate);
        const goal = goals[goalKey(calendarScope, periodStart)];
        return goalDocument(calendarScope, periodStart, goal, segments, draftOr);
      }

      const day = dayDocs.find((d) => d.date === selectedDate);
      return dayDocument(selectedDate, day, todayDate, segments, draftOr);
    }

    /* ---------------- 归档 ---------------- */
    case "archive": {
      const note = archived.find((n) => n.id === selectedArchiveId) ?? archived[0];
      if (!note) {
        return emptyDoc("归档是空的", "归档的内容会保留在这里，不出现在日常列表中。");
      }
      return {
        key: `archive-${note.id}`,
        title: note.title,
        banner: {
          icon: "archive",
          text: `已归档 · ${formatFullCN(toISODate(new Date(note.archivedAt ?? note.updatedAt)))}`,
        },
        bodyMd: draftOr({ kind: "note", id: note.id }, note.contentMd),
        statusParts: [
          `${note.wordCount} 字`,
          `创建时间 ${formatTimestampFull(note.createdAt)}`,
          `最后编辑于 ${formatRelativeTime(note.updatedAt)}`,
        ],
        editor: { target: { kind: "note", id: note.id }, titleEditable: true },
      };
    }

    case "extensions":
      return emptyDoc("扩展", "");
  }
}

/* ---------------- 两种按周期 / 按天的文档 ---------------- */

/** 有草稿就用草稿，没有就用库里的正文 */
type DraftOr = (target: DocumentSaveTarget, stored: string) => string;

/**
 * 某一天的文档。`day` 还没取回来之前不给编辑器 —— 否则它会以空文档挂载，
 * 用户在空白页上一输入就把当天原有的内容覆盖掉。
 */
function dayDocument(
  date: ISODate,
  day: DayDoc | undefined,
  todayDate: ISODate,
  segments: DocumentModel["segments"],
  draftOr: DraftOr,
): DocumentModel {
  const tasks = day?.tasks ?? [];
  const isToday = date === todayDate;

  const statusParts: string[] = [];
  if (!day) statusParts.push("载入中…");
  else {
    if (tasks.length) statusParts.push(`${tasks.length} 项安排`);
    if (day.carriedFrom) {
      statusParts.push(`延续自 ${formatMonthDayCN(day.carriedFrom)}，还没有今天自己的记录`);
    } else if (!day.title && !day.noteMd) {
      statusParts.push("这一天还没有记录");
    } else {
      statusParts.push(`上次更新 ${formatRelativeTime(day.updatedAt)}`);
    }
    if (isToday && !day.carriedFrom) statusParts.push("今天的内容会延续到明天，直到你改动它");
  }

  return {
    key: `day-${date}`,
    // 空标题显示占位；标题栏是可编辑的，和笔记一样
    title: day?.title || NEW_NOTE_TITLE,
    eyebrow: isToday ? `今天 · ${formatDayEyebrowCN(date)}` : formatDayEyebrowCN(date),
    segments,
    bodyMd: day ? draftOr({ kind: "day", id: date }, day.noteMd) : "",
    dayTasks: tasks.length ? tasks : undefined,
    statusParts,
    editor: day ? { target: { kind: "day", id: date }, titleEditable: true } : undefined,
  };
}

/** 某个周期的目标。标题由周期算出来，不可编辑；没写过就是空白编辑器。 */
function goalDocument(
  horizon: GoalHorizon,
  periodStart: ISODate,
  goal: Goal | undefined,
  segments: DocumentModel["segments"],
  draftOr: DraftOr,
): DocumentModel {
  const statusParts: string[] = [formatPeriodCN(horizon, periodStart)];
  if (!goal) statusParts.push("载入中…");
  else if (goal.updatedAt === 0) statusParts.push("这个周期还没写过目标");
  else
    statusParts.push(
      `${countGoalWords(goal.contentMd)} 字`,
      `上次更新 ${formatRelativeTime(goal.updatedAt)}`,
    );

  return {
    key: `goal-${goalKey(horizon, periodStart)}`,
    title: goalTitle(horizon, periodStart),
    segments,
    bodyMd: goal ? draftOr({ kind: "goal", horizon, periodStart }, goal.contentMd) : "",
    statusParts,
    editor: goal ? { target: { kind: "goal", horizon, periodStart } } : undefined,
  };
}

/* ---------------- 辅助 ---------------- */

function emptyDoc(title: string, body: string): DocumentModel {
  return { key: `empty-${title}`, title, bodyMd: body, statusParts: [] };
}

function horizonLabel(h: GoalHorizon): string {
  return h === "week" ? "周" : h === "month" ? "月" : "年";
}

export function labelToHorizon(l: string): GoalHorizon {
  return l === "月" ? "month" : l === "年" ? "year" : "week";
}

function scopeLabel(s: "day" | "week" | "month" | "year"): string {
  return s === "day" ? "日TODO" : s === "week" ? "周/GOAL" : s === "month" ? "月/GOAL" : "年/GOAL";
}

export function labelToScope(l: string): "day" | "week" | "month" | "year" {
  return l === "周/GOAL" ? "week" : l === "月/GOAL" ? "month" : l === "年/GOAL" ? "year" : "day";
}

/** GOAL 文档没有预存字数，实时算一下 */
function countGoalWords(md: string): number {
  const cjk = (md.match(/[一-龥]/g) ?? []).length;
  const en = (md.match(/[a-zA-Z0-9]+/g) ?? []).length;
  return cjk + en;
}
