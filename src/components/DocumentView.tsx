import type { DocumentModel } from "@/data/types";
import { buildOutline, renderMarkdown } from "@/lib/markdown";
import { spring, tween } from "@/lib/motion";
import { Archive, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { ActionGroup } from "./ActionItem";
import { Outline } from "./Outline";
import { Segmented } from "./Segmented";

/* ============================================================
   统一文档视图。
   笔记 / 今日TODO / GOAL / 日历某天 / 归档项 —— 全部由它渲染。
   新增内容类型只需要在 adapter 里多映射一个 DocumentModel，
   不需要写新的视图组件。
   ============================================================ */

export function DocumentView({
  doc,
  onToggleTask,
  onSegmentChange,
  onDelete,
}: {
  doc: DocumentModel;
  onToggleTask: (id: string) => void;
  onSegmentChange?: (v: string) => void;
  onDelete?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const outline = useMemo(
    () =>
      buildOutline(
        doc.bodyMd,
        doc.actionGroup?.hideHeader ? undefined : doc.actionGroup?.title,
        doc.bodyAfterMd,
      ),
    [doc.bodyMd, doc.actionGroup?.title, doc.actionGroup?.hideHeader, doc.bodyAfterMd],
  );

  const body = useMemo(() => renderMarkdown(doc.bodyMd), [doc.bodyMd]);
  const bodyAfter = useMemo(
    () => (doc.bodyAfterMd ? renderMarkdown(doc.bodyAfterMd, "after") : null),
    [doc.bodyAfterMd],
  );

  // 切换文档时滚回顶部。用 instant 而不是 smooth ——
  // 换了一篇文档还看到旧位置平滑滚动，是错误的心智模型。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只应在 doc.key 变化时触发
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [doc.key]);

  return (
    <div className="flex h-full min-w-0 flex-1 bg-canvas">
      <div ref={scrollRef} className="scroll-thin min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[860px] flex-col px-14 pb-6 pt-[52px]">
          {/* ---------- 归档横幅 ---------- */}
          <AnimatePresence mode="popLayout" initial={false}>
            {doc.banner && (
              <motion.div
                key={doc.banner.text}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={tween.base}
                className="mb-7 flex items-center gap-2 rounded-lg bg-rail px-3.5 py-2.5"
              >
                <Archive size={12.5} strokeWidth={1.9} className="shrink-0 text-muted" />
                <span className="text-[12px] text-muted">{doc.banner.text}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---------- 标题行 ---------- */}
          <header
            className="flex items-start justify-between gap-8"
            id="doc-top"
            data-outline-id="doc-top"
          >
            <div className="min-w-0 flex-1 overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.h1
                  key={doc.key}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -14 }}
                  transition={spring.smooth}
                  className="selectable text-[38px] font-bold leading-[1.25] tracking-[-0.02em]
                             text-ink"
                >
                  {doc.title}
                </motion.h1>
              </AnimatePresence>
            </div>

            {doc.segments && onSegmentChange && (
              <div className="pt-2">
                <Segmented
                  group={doc.segments.group}
                  options={doc.segments.options.map((o) => ({ value: o, label: o }))}
                  value={doc.segments.active}
                  onChange={onSegmentChange}
                  size={doc.segments.options.length > 3 ? "sm" : "md"}
                />
              </div>
            )}
          </header>

          {/* 标题下的细分隔线：宽度从 0 展开，是「文档打开了」的一个小信号 */}
          <motion.div
            key={`${doc.key}-rule`}
            className="mt-6 h-px origin-left bg-line"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
          />

          {/* ---------- 正文 ---------- */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={doc.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ ...tween.base, delay: 0.04 }}
              className="flex-1"
            >
              <article className="prose-doc selectable mt-7">{body}</article>

              {doc.actionGroup && doc.actionGroup.tasks.length > 0 && (
                <ActionGroup
                  title={doc.actionGroup.title}
                  tasks={doc.actionGroup.tasks}
                  counterMode={doc.actionGroup.title === "本周重点" ? "count" : "progress"}
                  hideHeader={doc.actionGroup.hideHeader}
                  onToggle={onToggleTask}
                />
              )}

              {bodyAfter && <article className="prose-doc selectable mt-9">{bodyAfter}</article>}
            </motion.div>
          </AnimatePresence>

          {/* ---------- 底部状态栏 ---------- */}
          <StatusBar parts={doc.statusParts} onDelete={doc.deletable ? onDelete : undefined} />
        </div>
      </div>

      <Outline items={outline} scrollRef={scrollRef} resetKey={doc.key} />
    </div>
  );
}

function StatusBar({ parts, onDelete }: { parts: string[]; onDelete?: () => void }) {
  return (
    <footer className="mt-16 flex items-center gap-3 border-t border-line pt-3.5">
      <motion.div
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...tween.base, delay: 0.18 }}
      >
        {parts.map((p, i) => (
          <span key={p} className="flex items-center gap-2.5">
            {i > 0 && <span className="text-faint/50">·</span>}
            <span className="font-mono text-[10.5px] leading-none text-faint">{p}</span>
          </span>
        ))}
      </motion.div>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="删除"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint
                     transition-colors duration-[140ms] hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={13.5} strokeWidth={1.8} />
        </button>
      )}
    </footer>
  );
}
