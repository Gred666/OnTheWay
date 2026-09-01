import { useApp } from "@/app/store";
import { useData } from "@/data/store";
import type { WorkspaceId } from "@/data/types";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/lib/motion";
import {
  Archive,
  Bell,
  CalendarDays,
  Copy,
  CornerDownLeft,
  Monitor,
  Moon,
  Search,
  Sparkles,
  Sun,
  Target,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

interface Cmd {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  group: "跳转" | "笔记" | "外观";
  run: () => void;
}

/**
 * 命令面板（⌘K / Ctrl+K）。
 * 遮罩用静态 backdrop-blur、只动 opacity —— 动画化 backdrop-filter
 * 会让每帧重新采样模糊，是最贵的一类动画（技术方案 §10.1）。
 */
export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const selectNote = useApp((s) => s.selectNote);
  const setTheme = useApp((s) => s.setTheme);
  const reduceMotion = useApp((s) => s.reduceMotion);
  const setReduceMotion = useApp((s) => s.setReduceMotion);
  const notes = useData((s) => s.notes);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* ---- 全局快捷键 ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useApp.getState().paletteOpen);
      } else if (e.key === "Escape" && useApp.getState().paletteOpen) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // 等入场动画的第一帧过去再聚焦，避免 iOS/WebKit 上的滚动跳动
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Cmd[]>(() => {
    const nav = (id: WorkspaceId, label: string, icon: LucideIcon): Cmd => ({
      id: `nav-${id}`,
      label,
      hint: "跳转到工作区",
      icon,
      group: "跳转",
      run: () => setWorkspace(id),
    });

    return [
      nav("notes", "笔记", Copy),
      nav("today", "今日TODO", Bell),
      nav("goal", "/GOAL", Target),
      nav("calendar", "日历", CalendarDays),
      nav("archive", "归档", Archive),

      ...notes.map<Cmd>((n) => ({
        id: `note-${n.id}`,
        label: n.title,
        hint: n.excerpt,
        icon: Copy,
        group: "笔记",
        run: () => {
          setWorkspace("notes");
          selectNote(n.id);
        },
      })),

      {
        id: "theme-light",
        label: "切换到亮色",
        hint: "外观",
        icon: Sun,
        group: "外观",
        run: () => setTheme("light"),
      },
      {
        id: "theme-dark",
        label: "切换到暗色",
        hint: "外观",
        icon: Moon,
        group: "外观",
        run: () => setTheme("dark"),
      },
      {
        id: "theme-system",
        label: "主题跟随系统",
        hint: "外观",
        icon: Monitor,
        group: "外观",
        run: () => setTheme("system"),
      },
      {
        id: "reduce-motion",
        label: reduceMotion ? "开启动画效果" : "减少动画效果",
        hint: reduceMotion ? "当前：已减少" : "当前：完整动效",
        icon: Sparkles,
        group: "外观",
        run: () => setReduceMotion(!reduceMotion),
      },
    ];
  }, [notes, setWorkspace, selectNote, setTheme, reduceMotion, setReduceMotion]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 输入变化时复位高亮
  useEffect(() => setCursor(0), [query]);

  // 键盘移动时把高亮项滚进视野
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const execute = (c: Cmd | undefined) => {
    if (!c) return;
    c.run();
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[16vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={tween.fast}
        >
          {/* 遮罩：模糊是静态的，只有 opacity 在动 */}
          <button
            type="button"
            aria-label="关闭命令面板"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-ink/[0.14] backdrop-blur-[3px]"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="命令面板"
            initial={{ opacity: 0, scale: 0.97, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.985, y: -6 }}
            transition={spring.snappy}
            className="relative w-[520px] max-w-[calc(100vw-48px)] overflow-hidden rounded-2xl
                       bg-canvas shadow-modal ring-1 ring-line-strong"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => (c + 1) % Math.max(results.length, 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => (c - 1 + results.length) % Math.max(results.length, 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                execute(results[cursor]);
              }
            }}
          >
            <div className="flex h-[52px] items-center gap-3 border-b border-line px-4">
              <Search size={15} strokeWidth={2} className="shrink-0 text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索命令、笔记…"
                className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none
                           placeholder:text-faint"
              />
              <kbd
                className="shrink-0 rounded border border-line-strong px-1.5 py-0.5 font-mono
                           text-[10px] leading-none text-faint"
              >
                ESC
              </kbd>
            </div>

            <div ref={listRef} className="scroll-thin max-h-[336px] overflow-y-auto p-1.5">
              {results.length === 0 ? (
                <div className="px-3 py-9 text-center">
                  <Zap size={17} strokeWidth={1.7} className="mx-auto mb-2 text-faint/60" />
                  <p className="text-[12.5px] text-muted">没有匹配的命令</p>
                </div>
              ) : (
                results.map((c, i) => {
                  const active = i === cursor;
                  const showGroup = i === 0 || results[i - 1]!.group !== c.group;
                  const Icon = c.icon;
                  return (
                    <div key={c.id}>
                      {showGroup && (
                        <p className="px-2.5 pb-1 pt-2.5 text-[10.5px] font-medium tracking-[0.05em] text-faint">
                          {c.group}
                        </p>
                      )}
                      <button
                        type="button"
                        data-idx={i}
                        onMouseMove={() => setCursor(i)}
                        onClick={() => execute(c)}
                        className="relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
                      >
                        {active && (
                          <motion.span
                            layoutId="palette-cursor"
                            className="absolute inset-0 rounded-lg bg-accent-wash"
                            transition={spring.snappy}
                          />
                        )}
                        <Icon
                          size={14}
                          strokeWidth={1.9}
                          className={cn(
                            "relative z-10 shrink-0",
                            active ? "text-accent" : "text-muted",
                          )}
                        />
                        <span className="relative z-10 min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate text-[13px]",
                              active ? "font-medium text-ink" : "text-body",
                            )}
                          >
                            {c.label}
                          </span>
                        </span>
                        <span className="relative z-10 shrink-0 truncate text-[11px] text-faint">
                          {c.hint}
                        </span>
                        {active && (
                          <CornerDownLeft
                            size={11}
                            strokeWidth={2}
                            className="relative z-10 shrink-0 text-accent/60"
                          />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
