import { cn } from "@/lib/cn";
import { tween } from "@/lib/motion";
import { motion } from "motion/react";
import type { ReactNode } from "react";

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

/** 列表栏顶部的小图标按钮（排序、今天） */
export function ColumnButton({
  children,
  onClick,
  label,
  wide,
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  wide?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.1 }}
      className={cn(
        "flex h-[30px] items-center justify-center gap-1.5 rounded-lg border border-line-strong",
        "bg-canvas text-muted transition-colors duration-[140ms] hover:border-faint/40",
        "hover:text-ink",
        wide ? "px-2.5 text-[11.5px]" : "w-[30px]",
      )}
    >
      {children}
    </motion.button>
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
