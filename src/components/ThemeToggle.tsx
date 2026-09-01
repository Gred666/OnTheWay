import { type ThemePref, useApp } from "@/app/store";
import { spring } from "@/lib/motion";
import { Monitor, Moon, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

const ORDER: ThemePref[] = ["system", "light", "dark"];
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const LABEL = { system: "跟随系统", light: "亮色", dark: "暗色" } as const;

/**
 * 三态主题切换。
 * 图标切换用 AnimatePresence 做旋转交叉淡入 —— 一个 26px 的按钮也值得有手感。
 */
export function ThemeToggle() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const Icon = ICON[theme];

  return (
    <button
      type="button"
      title={`主题：${LABEL[theme]}`}
      aria-label={`主题：${LABEL[theme]}，点击切换`}
      onClick={() => setTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!)}
      className="relative grid h-7 w-7 place-items-center rounded-md text-muted
                 transition-colors duration-[140ms] hover:bg-raised hover:text-ink"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={theme}
          initial={{ opacity: 0, rotate: -75, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 75, scale: 0.6 }}
          transition={spring.snappy}
          className="absolute grid place-items-center"
        >
          <Icon size={14.5} strokeWidth={1.9} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
