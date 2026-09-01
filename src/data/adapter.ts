import { useApp } from "@/app/store";
import {
  formatFullCN,
  formatMonthDayCN,
  formatRelativeTime,
  formatTimestampFull,
  toISODate,
} from "@/lib/date";
import { seedReminders } from "./seed";
import { tasksByIds, useData } from "./store";
import type { DocumentModel, Reminder } from "./types";

/* ============================================================
   把「当前工作区 + 选中项」映射成统一的 DocumentModel。
   ★ 这是「一切皆文档」抽象的落点 ——
   五个视图的差异全部收敛在这一个函数里，
   DocumentView 完全不知道自己在渲染笔记还是日历。
   ============================================================ */

export function useCurrentDocument(): { doc: DocumentModel; reminder: Reminder } {
  const workspace = useApp((s) => s.workspace);
  const selectedNoteId = useApp((s) => s.selectedNoteId);
  const selectedArchiveId = useApp((s) => s.selectedArchiveId);
  const selectedDate = useApp((s) => s.selectedDate);
  const calendarScope = useApp((s) => s.calendarScope);
  const goalHorizon = useApp((s) => s.goalHorizon);

  const notes = useData((s) => s.notes);
  const archived = useData((s) => s.archived);
  const tasks = useData((s) => s.tasks);
  const goals = useData((s) => s.goals);
  const dayDocs = useData((s) => s.dayDocs);
  const todayDoc = useData((s) => s.todayDoc);

  switch (workspace) {
    /* ---------------- 笔记 ---------------- */
    case "notes": {
      const note = notes.find((n) => n.id === selectedNoteId) ?? notes[0];
      if (!note)
        return {
          doc: emptyDoc("还没有笔记", "从左侧新建一篇。"),
          reminder: seedReminders.default!,
        };

      return {
        doc: {
          key: `note-${note.id}`,
          title: note.title,
          bodyMd: note.contentMd,
          actionGroup: note.actionGroup
            ? {
                title: note.actionGroup.title,
                tasks: tasksByIds(tasks, note.actionGroup.taskIds),
              }
            : undefined,
          statusParts: [
            `${note.wordCount} 字`,
            `创建时间 ${formatTimestampFull(note.createdAt)}`,
            `上次更新 ${formatRelativeTime(note.updatedAt)}`,
          ],
          deletable: true,
        },
        reminder: seedReminders.default!,
      };
    }

    /* ---------------- 今日 TODO ---------------- */
    case "today": {
      return {
        doc: {
          key: "today",
          title: todayDoc.title,
          bodyMd: todayDoc.contentMd,
          actionGroup: {
            title: todayDoc.actionGroup.title,
            tasks: tasksByIds(tasks, todayDoc.actionGroup.taskIds),
          },
          statusParts: [
            `${todayDoc.wordCount} 字`,
            `上次更新 ${new Date(todayDoc.updatedAt).toTimeString().slice(0, 5)}`,
          ],
        },
        reminder: seedReminders.default!,
      };
    }

    /* ---------------- /GOAL ---------------- */
    case "goal": {
      const goal = goals.find((g) => g.horizon === goalHorizon) ?? goals[0]!;
      return {
        doc: {
          key: `goal-${goal.id}`,
          title: goal.title,
          segments: {
            group: "goal",
            options: ["周", "月", "年"],
            active: horizonLabel(goalHorizon),
          },
          bodyMd: goal.contentMd,
          actionGroup: goal.actionGroup
            ? { title: goal.actionGroup.title, tasks: tasksByIds(tasks, goal.actionGroup.taskIds) }
            : undefined,
          bodyAfterMd: goal.afterMd,
          statusParts: [
            `${countGoalWords(goal.contentMd + (goal.afterMd ?? ""))} 字`,
            `上次更新 ${formatRelativeTime(goal.updatedAt)}`,
          ],
        },
        reminder: seedReminders.goal!,
      };
    }

    /* ---------------- 日历 ---------------- */
    case "calendar": {
      // 分段切到周/月/年时，右侧直接显示对应的 GOAL 文档
      if (calendarScope !== "day") {
        const goal = goals.find((g) => g.horizon === calendarScope) ?? goals[0]!;
        return {
          doc: {
            key: `cal-goal-${goal.id}`,
            title: goal.title,
            segments: {
              group: "calendar",
              options: ["日TODO", "周/GOAL", "月/GOAL", "年/GOAL"],
              active: scopeLabel(calendarScope),
            },
            bodyMd: goal.contentMd,
            actionGroup: goal.actionGroup
              ? {
                  title: goal.actionGroup.title,
                  tasks: tasksByIds(tasks, goal.actionGroup.taskIds),
                }
              : undefined,
            bodyAfterMd: goal.afterMd,
            statusParts: [`上次更新 ${formatRelativeTime(goal.updatedAt)}`],
          },
          reminder: seedReminders.goal!,
        };
      }

      const day = dayDocs.find((d) => d.date === selectedDate);
      const dayTasks = day ? tasksByIds(tasks, day.taskIds) : [];
      // 原型的顺序是「任务列表 → 备注」，所以正文整段放到行动项之后
      const noteMd = day?.noteMd
        ? `## 备注\n\n${day.noteMd}`
        : "## 备注\n\n这一天还没有安排。点击左侧其他日期，或在这里写下计划。";

      return {
        doc: {
          key: `cal-${selectedDate}`,
          title: formatMonthDayCN(selectedDate),
          segments: {
            group: "calendar",
            options: ["日TODO", "周/GOAL", "月/GOAL", "年/GOAL"],
            active: "日TODO",
          },
          bodyMd: "",
          actionGroup: dayTasks.length
            ? { title: "当日安排", tasks: dayTasks, hideHeader: true }
            : undefined,
          bodyAfterMd: noteMd,
          statusParts: [
            `${dayTasks.length} 项 TODO`,
            `上次更新 ${formatRelativeTime(day?.updatedAt ?? Date.now())}`,
            `内容将在 ${formatMonthDayCN(selectedDate)} 00:00 自动切换到“今日TODO”`,
          ],
        },
        reminder: seedReminders.goal!,
      };
    }

    /* ---------------- 归档 ---------------- */
    case "archive": {
      const note = archived.find((n) => n.id === selectedArchiveId) ?? archived[0];
      if (!note) {
        return {
          doc: emptyDoc("归档是空的", "归档的内容会保留在这里，不出现在日常列表中。"),
          reminder: seedReminders.default!,
        };
      }
      return {
        doc: {
          key: `archive-${note.id}`,
          title: note.title,
          banner: {
            icon: "archive",
            text: `已归档 · ${formatFullCN(toISODate(new Date(note.archivedAt ?? note.updatedAt)))}`,
          },
          bodyMd: note.contentMd,
          statusParts: [
            `${note.wordCount} 字`,
            `创建时间 ${formatTimestampFull(note.createdAt)}`,
            `最后编辑于 ${formatRelativeTime(note.updatedAt)}`,
          ],
        },
        reminder: seedReminders.default!,
      };
    }
  }
}

/* ---------------- 辅助 ---------------- */

function emptyDoc(title: string, body: string): DocumentModel {
  return { key: `empty-${title}`, title, bodyMd: body, statusParts: [] };
}

function horizonLabel(h: "week" | "month" | "year"): string {
  return h === "week" ? "周" : h === "month" ? "月" : "年";
}

export function labelToHorizon(l: string): "week" | "month" | "year" {
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
