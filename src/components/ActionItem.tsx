import type { Task } from "@/data/types";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/lib/motion";
import { motion, useReducedMotion } from "motion/react";

/* ============================================================
   日历「当日安排」里的一条任务 —— 别的文档里写着这一天的 `- [ ] … @日期`。
   勾选改的是原文件里的那一行（技术方案 §5.4）。

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

/* ---------------- 当日安排 ---------------- */

/** 列在某一天正文后面，没有小标题 */
export function DayTasks({ tasks, onToggle }: { tasks: Task[]; onToggle: (id: string) => void }) {
  return (
    <section className="mt-7">
      <ul className="border-t border-line">
        {tasks.map((t, i) => (
          <ActionItem key={t.id} task={t} index={i} onToggle={onToggle} />
        ))}
      </ul>
    </section>
  );
}
