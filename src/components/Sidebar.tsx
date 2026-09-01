import { useApp } from "@/app/store";
import type { WorkspaceId } from "@/data/types";
import { cn } from "@/lib/cn";
import { spring, stagger, tween } from "@/lib/motion";
import { Archive, Bell, CalendarDays, Copy, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
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
];

export function Sidebar({ todoCount }: { todoCount: number }) {
  const workspace = useApp((s) => s.workspace);
  const setWorkspace = useApp((s) => s.setWorkspace);

  return (
    <nav className="flex h-full w-[240px] shrink-0 flex-col bg-rail" aria-label="主导航">
      {/* 顶部：Logo。pt 留出无边框窗口的拖拽区高度 */}
      <div className="flex h-[76px] shrink-0 items-end px-[22px] pb-4">
        <Logo />
      </div>

      <motion.p
        className="px-[22px] pb-2 text-[11px] font-medium tracking-[0.08em] text-faint"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...tween.base, delay: 0.28 }}
      >
        工作区
      </motion.p>

      <ul className="flex flex-col gap-[2px] px-3">
        {NAV.map((item, i) => (
          <NavRow
            key={item.id}
            item={item}
            index={i}
            active={workspace === item.id}
            badge={item.id === "today" ? todoCount : 0}
            onSelect={() => setWorkspace(item.id)}
          />
        ))}
      </ul>

      <div className="flex-1" />

      <div className="flex items-center justify-between px-4 pb-4">
        <ThemeToggle />
        <kbd
          className="rounded-sm border border-line-strong px-1.5 py-0.5 font-mono text-[10px]
                     leading-none text-faint"
          title="打开命令面板"
        >
          ⌘K
        </kbd>
      </div>
    </nav>
  );
}

function NavRow({
  item,
  index,
  active,
  badge,
  onSelect,
}: {
  item: NavItem;
  index: number;
  active: boolean;
  badge: number;
  onSelect: () => void;
}) {
  const Icon = item.icon;

  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...tween.base, ...stagger(index, 0.04), delay: 0.3 + index * 0.04 }}
    >
      <button
        type="button"
        onClick={onSelect}
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

        <Icon
          size={15}
          strokeWidth={1.9}
          className={cn(
            "relative z-10 shrink-0 transition-colors duration-[140ms]",
            active ? "text-ink" : "text-muted group-hover:text-body",
          )}
        />
        <span
          className={cn(
            "relative z-10 flex-1 truncate text-[13.5px] transition-[font-weight] duration-[140ms]",
            active ? "font-semibold" : "font-normal",
          )}
        >
          {item.label}
        </span>

        {badge > 0 && (
          <motion.span
            key={badge}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring.bouncy}
            className="relative z-10 flex h-[18px] min-w-[18px] items-center justify-center
                       rounded-full bg-accent-wash px-1 font-mono text-[10.5px] font-semibold
                       leading-none text-accent tabular-nums"
          >
            {badge}
          </motion.span>
        )}
      </button>
    </motion.li>
  );
}
