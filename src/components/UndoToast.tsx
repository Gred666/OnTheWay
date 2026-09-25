import { useApp } from "@/app/store";
import { NEW_NOTE_TITLE, useData } from "@/data/store";
import { spring, tween } from "@/lib/motion";
import { Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** 提示条停留多久。指针停在上面时暂停计时。 */
const UNDO_WINDOW_MS = 6000;

/**
 * 删除笔记后底部的「已删除 · 撤销」提示条。
 *
 * 删除本身立刻生效（库里是软删除），这里只是给一个反悔的窗口：以前删除
 * 既不确认也不能撤销，界面上又没有回收站，手一滑就等于永久删除。
 * 用撤销而不是确认框 —— 删除是有意为之的时候居多，每次都拦一道只是多一次点击。
 */
export function UndoToast() {
  const deleted = useData((s) => s.lastDeleted);
  const undoDelete = useData((s) => s.undoDelete);
  const dismissUndo = useData((s) => s.dismissUndo);
  const [hovered, setHovered] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noteId = deleted?.note.id;
  useEffect(() => {
    if (!noteId || hovered) return;
    timer.current = setTimeout(dismissUndo, UNDO_WINDOW_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [noteId, hovered, dismissUndo]);

  const undo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await undoDelete();
      if (id) useApp.getState().selectNote(id);
    } finally {
      setBusy(false);
      setHovered(false);
    }
  };

  const title = deleted?.note.title.trim() || NEW_NOTE_TITLE;

  // 定位交给 Shell 里的 ToastStack，和错误提示叠在一起
  return (
    <AnimatePresence>
      {deleted && (
        <motion.div
          key={deleted.note.id}
          role="status"
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, transition: tween.fast }}
          transition={spring.gentle}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="pointer-events-auto flex max-w-[420px] items-center gap-3 rounded-xl
                       bg-ink py-2 pl-3.5 pr-2 text-[12.5px] text-canvas shadow-float"
        >
          <Trash2 size={13} strokeWidth={1.9} className="shrink-0 opacity-70" />
          <span className="min-w-0 truncate">已删除「{title}」</span>
          <button
            type="button"
            onClick={() => void undo()}
            disabled={busy}
            className="shrink-0 rounded-md px-2 py-1 font-semibold text-canvas
                         transition-colors duration-[140ms] hover:bg-canvas/15 disabled:opacity-60"
          >
            撤销
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
