import { hasListColumn, useApp } from "@/app/store";
import { CommandPalette } from "@/components/CommandPalette";
import { DocumentView } from "@/components/DocumentView";
import { ReminderCard } from "@/components/ReminderCard";
import { Sidebar } from "@/components/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import { labelToHorizon, labelToScope, useCurrentDocument } from "@/data/adapter";
import { useData, useTodoCount } from "@/data/store";
import { spring, tween } from "@/lib/motion";
import { ArchiveList } from "@/views/ArchiveView";
import { CalendarPanel } from "@/views/CalendarView";
import { NotesList } from "@/views/NotesView";
import { AnimatePresence, MotionConfig, motion } from "motion/react";

export function Shell() {
  const workspace = useApp((s) => s.workspace);
  const navDirection = useApp((s) => s.navDirection);
  const setCalendarScope = useApp((s) => s.setCalendarScope);
  const setGoalHorizon = useApp((s) => s.setGoalHorizon);
  const reduceMotion = useApp((s) => s.reduceMotion);

  const notes = useData((s) => s.notes);
  const archived = useData((s) => s.archived);
  const markedDates = useData((s) => s.markedDates);
  const toggleTask = useData((s) => s.toggleTask);
  const restoreNote = useData((s) => s.restoreNote);
  const deleteNote = useData((s) => s.deleteNote);
  const todoCount = useTodoCount();

  const { doc, reminder } = useCurrentDocument();
  const showList = hasListColumn(workspace);

  const handleSegment = (v: string) => {
    if (workspace === "goal") setGoalHorizon(labelToHorizon(v));
    else if (workspace === "calendar") setCalendarScope(labelToScope(v));
  };

  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
      <div className="relative flex h-full w-full overflow-hidden bg-rail">
        <TitleBar />
        <Sidebar todoCount={todoCount} />

        {/* ---------- 中列表栏 ----------
            两栏 ↔ 三栏切换：用 width 动画会每帧重排，
            改成 marginLeft 负值 + x 位移，全程走合成器。 */}
        <AnimatePresence initial={false} mode="popLayout">
          {showList && (
            // key 只跟「有没有列表栏」走，不跟具体工作区走 ——
            // 否则「笔记 → 日历」会让整条栏先收起再展开，实际只需要换内容。
            <motion.div
              key="list-column"
              initial={{ x: -28, opacity: 0, marginLeft: -300 }}
              animate={{ x: 0, opacity: 1, marginLeft: 0 }}
              exit={{ x: -28, opacity: 0, marginLeft: -300 }}
              transition={{ ...spring.gentle, opacity: tween.fast }}
              className="z-10 h-full shrink-0 overflow-hidden"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={workspace}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={tween.base}
                  className="h-full"
                >
                  {workspace === "notes" && <NotesList notes={notes} />}
                  {workspace === "calendar" && <CalendarPanel marked={markedDates} />}
                  {workspace === "archive" && (
                    <ArchiveList items={archived} onRestore={restoreNote} />
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---------- 主内容 ----------
            按导航方向做轻微横向位移，让「往下走 / 往回走」有方位感。 */}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false} custom={navDirection}>
            <motion.main
              key={workspace}
              custom={navDirection}
              initial={{ opacity: 0, x: navDirection * 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: navDirection * -10 }}
              transition={{ ...tween.base, x: spring.smooth }}
              className="h-full"
            >
              <DocumentView
                doc={doc}
                onToggleTask={toggleTask}
                onSegmentChange={handleSegment}
                onDelete={() => deleteNote(doc.key.replace("note-", ""))}
              />
            </motion.main>
          </AnimatePresence>

          <ReminderCard reminder={reminder} />
        </div>

        <CommandPalette />
      </div>
    </MotionConfig>
  );
}
