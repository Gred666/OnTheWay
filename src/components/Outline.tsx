import type { OutlineItem } from "@/data/types";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/lib/motion";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * 右侧目录树。
 * 活动项跟随正文滚动联动，指示条用 layoutId 在条目间滑动。
 *
 * 用 IntersectionObserver 而不是 scroll 事件 —— 后者每帧都要 getBoundingClientRect，
 * 是典型的强制同步布局，正文一长就掉帧。
 */
export function Outline({
  items,
  scrollRef,
  resetKey,
}: {
  items: OutlineItem[];
  /** 正文滚动容器 */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** 切换文档时用它重置激活项 */
  resetKey: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const ratios = useRef(new Map<string, number>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: 换文档 / 换首个锚点时才重置
  useEffect(() => {
    setActiveId(items[0]?.id ?? null);
    ratios.current.clear();
  }, [resetKey, items[0]?.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey 用于强制重建 observer
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || items.length === 0) return;

    const targets = items
      .map((it) => root.querySelector<HTMLElement>(`[data-outline-id="${it.id}"]`))
      .filter((el): el is HTMLElement => !!el);
    if (!targets.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.outlineId!;
          ratios.current.set(id, e.isIntersecting ? e.intersectionRatio : 0);
        }
        // 取当前可见度最高的标题；都不可见时保持上一个
        let best: string | null = null;
        let bestRatio = 0;
        for (const it of items) {
          const r = ratios.current.get(it.id) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            best = it.id;
          }
        }
        if (best) setActiveId(best);
      },
      {
        root,
        // 顶部 12% 到底部 55% 的带状区域，标题进入这里才算「当前」
        rootMargin: "-12% 0px -55% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    for (const t of targets) io.observe(t);
    return () => io.disconnect();
  }, [items, scrollRef, resetKey]);

  const scrollTo = (id: string) => {
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-outline-id="${id}"]`);
    if (!root || !el) return;
    const top = el.offsetTop - 28;
    root.scrollTo({ top, behavior: "smooth" });
    setActiveId(id);
  };

  if (items.length === 0) return <aside className="w-[180px] shrink-0" />;

  return (
    <aside className="hidden w-[180px] shrink-0 pt-[52px] pr-6 xl:block" aria-label="目录树">
      <motion.p
        className="mb-3 pl-3 text-[10.5px] tracking-[0.08em] text-faint"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={tween.base}
      >
        目录树
      </motion.p>

      <nav className="relative flex flex-col gap-[1px]">
        {items.map((it, i) => {
          const active = it.id === activeId;
          return (
            <motion.button
              key={it.id}
              type="button"
              onClick={() => scrollTo(it.id)}
              initial={{ opacity: 0, x: 5 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...tween.base, delay: 0.06 + i * 0.035 }}
              className={cn(
                "relative rounded-r-sm py-[5px] pr-2 text-left text-[12px] leading-[1.5]",
                "transition-colors duration-[160ms]",
                it.level === 2 ? "pl-6" : "pl-3",
                active ? "text-ink" : "text-faint hover:text-muted",
              )}
            >
              {active && (
                <motion.span
                  layoutId="outline-indicator"
                  className="absolute left-0 top-[5px] bottom-[5px] w-[2px] rounded-full bg-ink"
                  transition={spring.smooth}
                />
              )}
              <span
                className={cn(
                  "block truncate transition-[font-weight] duration-[160ms]",
                  active ? "font-semibold" : "font-normal",
                )}
              >
                {it.text}
              </span>
            </motion.button>
          );
        })}
      </nav>
    </aside>
  );
}
