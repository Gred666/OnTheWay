import { useApp } from "@/app/store";
import type { WorkspaceId } from "@/data/types";
import { cn } from "@/lib/cn";
import { spring, stagger, tween, usePrefersReducedMotion } from "@/lib/motion";
import { shortcut } from "@/lib/platform";
import { Archive, Bell, CalendarDays, Copy, Puzzle, Search, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, useAnimationControls } from "motion/react";
import type { TargetAndTransition } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

interface NavItem {
  id: WorkspaceId;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { id: "notes", label: "笔记", icon: Copy },
  { id: "today", label: "今日TODO", icon: Bell },
  { id: "goal", label: "/GOAL", icon: Target },
  { id: "calendar", label: "日历", icon: CalendarDays },
  { id: "archive", label: "归档", icon: Archive },
  { id: "extensions", label: "扩展", icon: Puzzle },
];

export function Sidebar() {
  const workspace = useApp((s) => s.workspace);
  const setWorkspace = useApp((s) => s.setWorkspace);

  return (
    // z-20：中列表栏（z-10）进出场时要从这条导航栏底下滑出来 / 滑回去
    <nav className="relative z-20 flex h-full w-[240px] shrink-0 flex-col bg-rail" aria-label="主导航">
      {/* 顶部：Logo。pt 留出无边框窗口的拖拽区高度 */}
      <div className="flex h-[76px] shrink-0 items-end px-[22px] pb-4">
        <Logo />
      </div>

      <ul className="flex flex-col gap-[2px] px-3 pt-1">
        {NAV.map((item, i) => (
          <NavRow
            key={item.id}
            item={item}
            index={i}
            active={workspace === item.id}
            onSelect={() => setWorkspace(item.id)}
          />
        ))}
      </ul>

      <div className="flex-1" />

      <div className="flex items-center gap-1 px-3 pb-4">
        <ThemeToggle />
        <PaletteHint />
      </div>
    </nav>
  );
}

/**
 * 命令面板入口。
 *
 * 原来这里只有一个孤零零的 `⌘K`：Windows 上既是错的（实际绑的是 Ctrl+K），
 * 又没人认得那个 Mac 符号，等于白占一块地方。现在补上图标和文字标签，
 * 组合键按平台渲染，而且它本身就是个能点的按钮 —— 不认识快捷键的用户
 * 直接点也能打开。
 */
function PaletteHint() {
  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  const combo = shortcut("K");

  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      title={`打开命令面板（${combo}）`}
      className="group flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-muted
                 transition-colors duration-[140ms] hover:bg-raised hover:text-ink"
    >
      <Search size={13.5} strokeWidth={1.9} className="shrink-0" />
      <span className="truncate text-[12px]">命令面板</span>
      {/* 颜色继承按钮，不再单独压成 text-faint —— 那个灰度在 rail 底上对比度
          只有 2 出头，正是「看不清这是啥」的一半原因 */}
      <kbd
        className="ml-auto shrink-0 rounded border border-line-strong px-1 py-0.5 font-mono
                   text-[10px] leading-none"
      >
        {combo}
      </kbd>
    </button>
  );
}

/**
 * 每个图标的「签名动作」—— 切到这一页时播一次。
 *
 * 关键是动作得跟图标画的那个物件对得上：铃铛就摇、靶心就收拢、盖子就压下去。
 * 六个图标共用一套缩放的话，动是动了，但读不出「这是哪一页」——
 * Telegram 那套底栏之所以有记忆点，就在于每个图标动得不一样。
 *
 * 全部只动 transform（rotate / scale / y），走合成器，不触发排版。
 * 摆动类的支点要挪：铃铛在钟顶、归档盒在底边，用 origin 单独给。
 */
const ICON_MOTION: Record<WorkspaceId, { to: TargetAndTransition; origin: string }> = {
  // 两张纸错开一下再叠回去
  notes: {
    to: { rotate: [0, -8, 4, 0], scale: [1, 1.14, 1], transition: { duration: 0.4 } },
    origin: "50% 50%",
  },
  // 摇铃：支点在钟顶，来回幅度递减
  today: {
    to: { rotate: [0, -18, 14, -9, 5, 0], transition: { duration: 0.62 } },
    origin: "50% 16%",
  },
  // 命中靶心：先收后放
  goal: {
    to: { scale: [1, 0.78, 1.18, 1], transition: { duration: 0.44 } },
    origin: "50% 50%",
  },
  // 翻一页，轻轻跳一下
  calendar: {
    to: { y: [0, -3.5, 0], scale: [1, 1.09, 1], transition: { duration: 0.4 } },
    origin: "50% 50%",
  },
  // 盖子压下去再回弹，支点在盒底
  archive: {
    to: { scaleY: [1, 0.74, 1.08, 1], y: [0, 2, 0], transition: { duration: 0.46 } },
    origin: "50% 82%",
  },
  // 拼图咔一下扣进去
  extensions: {
    to: { rotate: [0, 18, -8, 0], scale: [1, 1.1, 1], transition: { duration: 0.5 } },
    origin: "50% 50%",
  },
};

function NavRow({
  item,
  index,
  active,
  onSelect,
}: {
  item: NavItem;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  const motionSpec = ICON_MOTION[item.id];
  const icon = useAnimationControls();

  // Shell 上那层 MotionConfig 管不到这里：reducedMotion="always" 不会拦
  // useAnimationControls().start() 派下去的 transform（实测开了「减少动效」
  // 铃铛照样摇 ±18°）。所以按 Shell 同样的口径自己判一次：
  // 应用内开关 or 系统偏好。
  const appReduce = useApp((s) => s.reduceMotion);
  const systemReduce = usePrefersReducedMotion();
  const skipMotion = appReduce || systemReduce;

  // 点已经选中的那一项也要有反馈，所以不能只看 active 翻没翻 —— 补一个计数器。
  // 点未选中项时两者在同一次提交里一起变，effect 仍然只跑一次。
  const [tapCount, setTapCount] = useState(0);
  const mounted = useRef(false);

  // tapCount 在函数体里没被读到，但它就是「再播一次」的信号：少了它，
  // 点击已经选中的那一项不会有任何反馈。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 计数器用作重放触发器
  useEffect(() => {
    // 首屏那一次不播：导航项本来就在做错峰入场，再叠一层就太吵了
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!active || skipMotion) return;
    void icon.start(motionSpec.to);
  }, [active, tapCount, icon, motionSpec, skipMotion]);

  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...tween.base, ...stagger(index, 0.04), delay: 0.3 + index * 0.04 }}
    >
      <motion.button
        type="button"
        onClick={() => {
          onSelect();
          setTapCount((n) => n + 1);
        }}
        // 按下去整条压一下：手指离开之前就有回应，不用等页面切完
        whileTap={skipMotion ? undefined : { scale: 0.965 }}
        transition={spring.snappy}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left",
          "transition-colors duration-[140ms]",
          active ? "text-ink" : "text-body hover:text-ink",
        )}
      >
        {/* 活动指示：同一个 layoutId 在导航项之间滑动 */}
        {active && (
          <motion.span
            layoutId="nav-indicator"
            className="absolute inset-0 rounded-lg bg-raised"
            transition={spring.smooth}
          />
        )}
        {/* 非活动项的 hover 底：独立一层，避免和指示器抢同一个背景 */}
        {!active && (
          <span
            className="absolute inset-0 rounded-lg bg-raised opacity-0 transition-opacity
                       duration-[140ms] group-hover:opacity-45"
          />
        )}

        <motion.span
          animate={icon}
          style={{ transformOrigin: motionSpec.origin }}
          className="relative z-10 flex shrink-0"
        >
          <Icon
            size={15}
            strokeWidth={1.9}
            className={cn(
              "transition-colors duration-[140ms]",
              active ? "text-ink" : "text-muted group-hover:text-body",
            )}
          />
        </motion.span>
        {/* 字重直接切，不过渡。font-weight 一过渡，每一帧都是一个新的小数字重，
            中文走系统字体回退（YaHei 没有可变轴），每个新字重都要重新做一次
            字体匹配 —— 实测一个标签一帧 11ms，切换时新旧两个标签一起变就是
            22ms 一帧，整整 140ms 都在掉帧；纯拉丁文字只要 0.5ms。 */}
        <span
          className={cn(
            "relative z-10 flex-1 truncate text-[13.5px]",
            active ? "font-semibold" : "font-normal",
          )}
        >
          {item.label}
        </span>
      </motion.button>
    </motion.li>
  );
}
