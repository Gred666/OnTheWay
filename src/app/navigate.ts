import { useData } from "@/data/store";
import { type DocumentSaveTarget, goalKey } from "@/data/types";
import { useApp } from "./store";

/**
 * 打开一篇文档：切到它所在的区、选中它，可选地记下要滚到的小节或行
 * （DocumentView 在那一篇的编辑器挂上后滚过去）。
 *
 * docKey 要和 data/adapter.ts 给每篇文档起的 key 一模一样，否则锚点永远等不到它那一篇：
 * 笔记 `note-` / 归档 `archive-` / 某一天 `day-` / 目标 `goal-周期键`。
 */
export function openDocument(
  target: DocumentSaveTarget,
  anchor?: { heading?: string; line?: number },
): void {
  const app = useApp.getState();
  let docKey: string;
  if (target.kind === "note") {
    if (useData.getState().archived.some((note) => note.id === target.id)) {
      app.selectArchive(target.id);
      app.setWorkspace("archive");
      docKey = `archive-${target.id}`;
    } else {
      app.selectNote(target.id);
      app.setWorkspace("notes");
      docKey = `note-${target.id}`;
    }
  } else if (target.kind === "day") {
    if (target.id === app.todayDate) {
      app.setWorkspace("today");
    } else {
      app.setCalendarScope("day");
      app.selectDate(target.id);
      app.setWorkspace("calendar");
    }
    docKey = `day-${target.id}`;
  } else {
    app.setCalendarScope(target.horizon);
    app.selectDate(target.periodStart);
    app.setWorkspace("calendar");
    docKey = `goal-${goalKey(target.horizon, target.periodStart)}`;
  }
  const wanted = anchor && (anchor.heading || anchor.line !== undefined);
  app.setPendingAnchor(wanted ? { docKey, ...anchor } : null);
}
