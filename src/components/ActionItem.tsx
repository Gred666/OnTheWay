import type { Task } from "@/data/types";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/lib/motion";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/* ============================================================
   行动项 —— 原型里的「下阶段行动」「检查项」「本周重点」「日TODO」
   都是这个组件。

   勾选动画分三层同时发生（总时长 ~380ms）：
   1. 圆环：一圈 stroke 快速收拢（scale 脉冲）
   2. 对勾：SVG pathLength 0→1 描边画出
   3. 文字：颜色过渡到 muted
   全部只动 transform / opacity / stroke-dashoffset，不触发重排。
   ============================================================ */

export function ActionItem({
  task,
  index,
  onToggle,
}: {
  task: Task;
  index: number;
  onToggle: (id: string) => void;
}) {
  const done = task.status === "done";
  const reduce = useReducedMotion();

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...tween.base, delay: Math.min(index, 8) * 0.03 }}
      className="group border-b border-line last:border-b-0"
    >
      <button
        type="button"
        onClick={() => onToggle(task.id)}
        aria-pressed={done}
        className="flex w-full items-start gap-3 py-[11px] pr-2 text-left"
      >
        <Checkbox done={done} reduce={!!reduce} />

        <span className="min-w-0 flex-1 pt-[1px]">
          <motion.span
            className={cn(
              "block truncate text-[14.5px] leading-[1.5]",
              done ? "text-faint" : "text-ink",
            )}
            animate={{ x: done ? 1.5 : 0 }}
            transition={spring.snappy}
          >
            {task.title}
          </motion.span>

          {task.meta && (
            <span
              className={cn(
                "mt-[3px] block truncate text-[11.5px] leading-[1.4] transition-colors duration-200",
                done ? "text-faint/70" : "text-muted",
              )}
            >
              {task.meta}
            </span>
          )}
        </span>
      </button>
    </motion.li>
  );
}

function Checkbox({ done, reduce }: { done: boolean; reduce: boolean }) {
  return (
    <span className="relative mt-[2px] grid h-[17px] w-[17px] shrink-0 place-items-center">
      <svg viewBox="0 0 20 20" className="h-[17px] w-[17px] overflow-visible" aria-hidden="true">
        {/* 外圈 */}
        <motion.circle
          cx="10"
          cy="10"
          r="8.25"
          fill="none"
          strokeWidth="1.4"
          className={done ? "stroke-faint" : "stroke-line-strong group-hover:stroke-muted"}
          animate={{ scale: done ? 1 : 1 }}
          style={{ transformOrigin: "10px 10px" }}
          transition={spring.snappy}
        />
        {/* 勾选时圆环做一次极轻的脉冲，给「咔哒」一下的手感 */}
        {done && !reduce && (
          <motion.circle
            cx="10"
            cy="10"
            r="8.25"
            fill="none"
            strokeWidth="1.4"
            className="stroke-accent"
            style={{ transformOrigin: "10px 10px" }}
            initial={{ scale: 1, opacity: 0.65 }}
            animate={{ scale: 1.55, opacity: 0 }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        {/* 对勾：pathLength 描边 */}
        <motion.path
          d="M6.2 10.3 L8.9 12.9 L14 7.4"
          fill="none"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={done ? "stroke-muted" : "stroke-transparent"}
          initial={false}
          animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }}
          transition={
            done
              ? {
                  pathLength: { duration: 0.26, ease: [0.3, 0.9, 0.4, 1] },
                  opacity: { duration: 0.06 },
                }
              : { pathLength: { duration: 0.14 }, opacity: { duration: 0.1 } }
          }
        />
      </svg>
    </span>
  );
}

/* ---------------- 分组容器 ---------------- */

export function ActionGroup({
  title,
  tasks,
  counterMode = "progress",
  hideHeader = false,
  onToggle,
}: {
  title: string;
  tasks: Task[];
  /** progress → 「2 / 3」；count → 「4 项」 */
  counterMode?: "progress" | "count";
  /** 隐藏标题行，任务直接列出（日历的当日安排） */
  hideHeader?: boolean;
  onToggle: (id: string) => void;
}) {
  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <section
      className={hideHeader ? "mt-7" : "mt-9"}
      id="action-group"
      data-outline-id="action-group"
    >
      {!hideHeader && (
        <header className="mb-1 flex items-baseline justify-between gap-4">
          <h2 className="text-[21px] font-[650] leading-[1.45] tracking-[-0.005em] text-ink">
            {title}
          </h2>
          <Counter
            value={counterMode === "progress" ? doneCount : tasks.length}
            suffix={counterMode === "progress" ? ` / ${tasks.length}` : " 项"}
          />
        </header>
      )}

      <ul className="border-t border-line">
        {tasks.map((t, i) => (
          <ActionItem key={t.id} task={t} index={i} onToggle={onToggle} />
        ))}
      </ul>
    </section>
  );
}

/** 数字变化时向上滚动替换，而不是直接跳变 */
function Counter({ value, suffix }: { value: number; suffix: string }) {
  return (
    <span
      className="flex shrink-0 items-center gap-px font-mono text-[11.5px] leading-none
                 text-faint tabular-nums"
    >
      {/* 用 ch 单位定宽，位数变化（9→10）时不会挤到后面的文字 */}
      <span
        className="relative inline-block h-[13px] overflow-hidden text-right"
        style={{ width: `${String(value).length}ch` }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={value}
            className="absolute inset-0 block leading-[13px]"
            initial={{ y: 13, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -13, opacity: 0 }}
            transition={spring.snappy}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="whitespace-pre">{suffix}</span>
    </span>
  );
}
