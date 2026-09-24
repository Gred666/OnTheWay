import { cn } from "@/lib/cn";
import { tween } from "@/lib/motion";
import { motion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";

/**
 * 中列表栏的统一外壳。
 * 笔记 / 日历 / 归档 三个视图共用，保证标题排版、内边距、滚动行为一致。
 */
export function ListColumn({
  title,
  action,
  children,
  belowTitle,
}: {
  title: string;
  /** 标题右侧的按钮（排序、今天…） */
  action?: ReactNode;
  /** 标题下方、滚动区之上的固定内容（搜索框、月份选择器…） */
  belowTitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-r border-line-strong/60 bg-panel">
      <div className="shrink-0 px-6 pt-[42px]">
        <div className="flex items-center justify-between gap-3">
          <motion.h2
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={tween.base}
            className="truncate text-[25px] font-bold leading-tight tracking-[-0.02em] text-ink"
          >
            {title}
          </motion.h2>
          {action && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...tween.base, delay: 0.06 }}
              className="shrink-0"
            >
              {action}
            </motion.div>
          )}
        </div>

        {belowTitle && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...tween.base, delay: 0.05 }}
            className="mt-4"
          >
            {belowTitle}
          </motion.div>
        )}
      </div>

      <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-6">{children}</div>
    </div>
  );
}

/**
 * 列表栏顶部的小图标按钮（排序、今天）。
 * 其余 props（含 ref）原样透传，这样它能直接当 Radix 菜单的触发元素：
 * Slot 会把 ref、data-state、键盘/指针事件合并进来。
 *
 * 按下的反馈只用颜色，**不缩放**。原来是 whileTap scale 0.94：当它是菜单的
 * 触发器时，菜单在 pointerdown 那一刻按缩小了的按钮定位，松手后按钮用 100ms
 * 弹回原大，floating-ui 的位移监听（IntersectionObserver 盯着触发器的包围盒）
 * 每一帧都跟着重新定位 —— 整个菜单跟着按钮的回弹抖一小段。
 */
export function ColumnButton({
  children,
  label,
  wide,
  className,
  ...rest
}: ComponentProps<"button"> & {
  children: ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "flex h-[30px] items-center justify-center gap-1.5 rounded-lg border border-line-strong",
        "bg-canvas text-muted transition-colors duration-[140ms] hover:border-faint/40",
        "hover:text-ink active:bg-raised/60",
        "data-[state=open]:border-faint/40 data-[state=open]:bg-raised/60 data-[state=open]:text-ink",
        wide ? "px-2.5 text-[11.5px]" : "w-[30px]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 分组标签，如「置顶」 */
export function GroupLabel({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-2">
      {icon && <span className="text-faint">{icon}</span>}
      <span className="text-[11px] font-medium tracking-[0.04em] text-faint">{text}</span>
    </div>
  );
}
