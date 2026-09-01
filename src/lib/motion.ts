import type { Transition, Variants } from "motion/react";

/* ============================================================
   动效 token
   规则（技术方案 §10）：
   1. 只动 transform / opacity
   2. 不动画化 backdrop-filter / box-shadow
   3. 时长 80–320ms，spring 必须可打断
   ============================================================ */

export const spring = {
  /** 按钮、勾选、开关 —— 快，几乎不回弹 */
  snappy: { type: "spring", stiffness: 520, damping: 34, mass: 0.7 },
  /** 列表重排、卡片位移、指示器滑动 —— 默认选择 */
  smooth: { type: "spring", stiffness: 320, damping: 30 },
  /** 面板滑入、大块内容 */
  gentle: { type: "spring", stiffness: 190, damping: 26 },
  /** 强调：完成、达成 —— 少用 */
  bouncy: { type: "spring", stiffness: 420, damping: 17 },
  /** 布局重排专用：比 smooth 稍软，避免多项同时动时显得躁 */
  layout: { type: "spring", stiffness: 380, damping: 34, mass: 0.9 },
} satisfies Record<string, Transition>;

export const tween = {
  instant: { duration: 0.08, ease: [0.22, 1, 0.36, 1] },
  fast: { duration: 0.14, ease: [0.22, 1, 0.36, 1] },
  base: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
  slow: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
} satisfies Record<string, Transition>;

/**
 * 列表入场错峰。
 * 上限 10 项 —— 否则第 30 项要等 600ms 才出现，感觉是「卡住了」而不是「有动画」。
 */
export function stagger(index: number, step = 0.022, cap = 10): Transition {
  return { delay: Math.min(index, cap) * step };
}

/* ---------- 常用 variants ---------- */

/** 从下方淡入。列表项、卡片的默认入场。 */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

/** 纯淡入。用于数量多、不适合位移的场景（如日历事件块）。 */
export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
  exit: { opacity: 0 },
};

/** 浮层：弹窗、命令面板、下拉。 */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 6 },
  show: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 2 },
};

/** 侧向滑入。方向感知的视图切换用。 */
export function slideX(dir: 1 | -1): Variants {
  return {
    hidden: { opacity: 0, x: dir * 18 },
    show: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: dir * -18 },
  };
}

/* ---------- layoutId 命名空间 ----------
   同一个 layoutId 在同一时刻只能存在一个元素，否则 Motion 会警告并乱飞。
   集中在这里定义，避免散落各处写错字符串。
*/
export const layoutIds = {
  navIndicator: "nav-indicator",
  listSelection: "list-selection",
  outlineIndicator: "outline-indicator",
  segmentThumb: (group: string) => `segment-thumb-${group}`,
  calendarDay: "calendar-day-badge",
} as const;
