import { cn } from "@/lib/cn";
import { layoutIds, spring, tween } from "@/lib/motion";
import { shortcut } from "@/lib/platform";
import { Search } from "lucide-react";
import { motion, useIsPresent } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ANIMATED_EMOJIS, type AnimatedEmoji, EmojiPlayer } from "./animatedEmoji";
import { EMOJI_GROUPS } from "./animatedEmojiSet";

/* ============================================================
   动态表情选择器（编辑器里 Ctrl/⌘ + E）。

   贴着光标弹出来：下面放得下就在下面，放不下翻到上面。一行 6 个，分组正好
   各一行；最上面一行是最近用过的。方向键在格子里走，回车插入，Esc 关掉并把
   焦点还给编辑器；输入框里打字就是搜索（中文、拼音、英文都行）。
   当前格子里的表情循环播放，其余静止 —— 一屏 30 个同时动太吵。
   ============================================================ */

export interface EmojiPickerAnchor {
  /** 光标的视口坐标（coordsAtPos） */
  left: number;
  top: number;
  bottom: number;
}

const COLUMNS = 6;
const GAP = 6;
const EDGE = 8;

/* ---------------- 最近使用 ---------------- */

const RECENT_KEY = "otw.emoji.recent";
const RECENT_LIMIT = COLUMNS;

export function loadRecent(): AnimatedEmoji[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(ids)) return [];
    return ids
      .map((id) => ANIMATED_EMOJIS.find((emoji) => emoji.id === id))
      .filter((emoji): emoji is AnimatedEmoji => !!emoji)
      .slice(0, RECENT_LIMIT);
  } catch {
    /* 隐私模式 / 数据损坏：当没有 */
    return [];
  }
}

export function rememberRecent(emoji: AnimatedEmoji): void {
  try {
    const ids = [
      emoji.id,
      ...loadRecent()
        .map((item) => item.id)
        .filter((id) => id !== emoji.id),
    ];
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_LIMIT)));
  } catch {
    /* 存不下就算了，不影响插入 */
  }
}

/* ---------------- 搜索与分区 ---------------- */

/** 中文名、近义词、拼音、英文、Unicode 表情本身都能搜；也认 `:otw_fire` 这种短码写法。 */
export function searchEmojis(query: string): AnimatedEmoji[] {
  const q = query.trim().toLowerCase().replace(/^:/, "").replace(/^otw_/, "").replace(/:$/, "");
  if (!q) return [...ANIMATED_EMOJIS];
  return ANIMATED_EMOJIS.filter(
    (emoji) =>
      emoji.id.includes(q) ||
      emoji.name.includes(q) ||
      emoji.fallback === q ||
      emoji.keywords
        .toLowerCase()
        .split(" ")
        .some((keyword) => keyword.includes(q)),
  );
}

export interface PickerSection {
  id: string;
  label: string;
  items: AnimatedEmoji[];
}

export function pickerSections(query: string, recent: AnimatedEmoji[]): PickerSection[] {
  if (query.trim()) {
    const items = searchEmojis(query);
    return items.length ? [{ id: "search", label: "搜索结果", items }] : [];
  }
  const sections: PickerSection[] = [];
  if (recent.length) sections.push({ id: "recent", label: "最近使用", items: recent });
  for (const group of EMOJI_GROUPS) {
    sections.push({
      id: group.id,
      label: group.label,
      items: ANIMATED_EMOJIS.filter((emoji) => emoji.group === group.id),
    });
  }
  return sections;
}

/** 分区切成行，每行最多 COLUMNS 个。方向键按行列走，而不是按下标 ±6 —— 最近使用那行可能不满。 */
export function gridRows(sections: PickerSection[]): number[][] {
  const rows: number[][] = [];
  let index = 0;
  for (const section of sections) {
    for (let start = 0; start < section.items.length; start += COLUMNS) {
      const row: number[] = [];
      for (let col = start; col < Math.min(start + COLUMNS, section.items.length); col += 1) {
        row.push(index);
        index += 1;
      }
      rows.push(row);
    }
  }
  return rows;
}

/** 在网格里走一步：左右跨行连续走，上下保持列（目标行短就落在它最后一个）。 */
export function moveInGrid(
  rows: number[][],
  current: number,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
): number {
  const total = rows.reduce((sum, row) => sum + row.length, 0);
  if (!total) return 0;
  if (key === "ArrowLeft") return (current - 1 + total) % total;
  if (key === "ArrowRight") return (current + 1) % total;
  const rowIndex = rows.findIndex((row) => row.includes(current));
  const row = rows[rowIndex] ?? rows[0]!;
  const col = Math.max(0, row.indexOf(current));
  const target = rows[rowIndex + (key === "ArrowUp" ? -1 : 1)];
  if (!target) return current;
  return target[Math.min(col, target.length - 1)]!;
}

/* ---------------- 组件 ---------------- */

/** 一个格子里的表情：当前项循环播放，离开就停回静止帧。 */
function EmojiGlyph({ emoji, active }: { emoji: AnimatedEmoji; active: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const playerRef = useRef<EmojiPlayer | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const player = new EmojiPlayer(emoji);
    playerRef.current = player;
    player.mount(host);
    return () => {
      player.stop();
      host.replaceChildren();
      playerRef.current = null;
    };
  }, [emoji]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (active) player.loop();
    else player.stop();
  }, [active]);

  return <span ref={hostRef} className="otw-ae otw-ae-picker" aria-hidden="true" />;
}

export function EmojiPicker({
  anchor,
  onPick,
  onClose,
}: {
  anchor: EmojiPickerAnchor;
  onPick: (emoji: AnimatedEmoji) => void;
  /** refocus：是否把焦点还给编辑器（Esc 要还；点到别处去了就不抢） */
  onClose: (refocus: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent] = useState(loadRecent);
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sections = useMemo(() => pickerSections(query, recent), [query, recent]);
  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const rows = useMemo(() => gridRows(sections), [sections]);
  const current = items[active];

  // 查询变了从第一个开始
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只跟着输入复位
  useEffect(() => setActive(0), [query]);

  // 定位：量出面板尺寸后贴着光标摆，下面放不下就翻到上面，左右夹在窗口里
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // offsetWidth / offsetHeight 是布局尺寸：入场动画的 scale(0.96) 这时已经挂上了，
    // 用 getBoundingClientRect 量会小 4%，贴右边、翻到上面时就差出十几像素
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const below = anchor.bottom + GAP;
    const above = below + height > window.innerHeight - EDGE && anchor.top - GAP - height >= EDGE;
    setPlace({
      left: Math.max(EDGE, Math.min(anchor.left - 18, window.innerWidth - width - EDGE)),
      top: above ? anchor.top - GAP - height : Math.max(EDGE, below),
      above,
    });
  }, [anchor]);

  // 摆好位置之后再聚焦：定位前面板是 visibility: hidden，那时候 focus() 会静默失败
  const placed = place !== null;
  useEffect(() => {
    if (placed) inputRef.current?.focus();
  }, [placed]);

  // 点到外面、窗口失焦、页面滚动或缩放：锚点已经不对了，直接收起。
  // 已经在退场的那一个不再监听 —— 否则它会把紧接着新开的选择器也关掉。
  const present = useIsPresent();
  useEffect(() => {
    if (!present) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && !!panelRef.current?.contains(target);
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target)) onClose(false);
    };
    const onScroll = (event: Event) => {
      if (!inside(event.target)) onClose(false);
    };
    const onBlur = () => onClose(false);
    const onResize = () => onClose(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose, present]);

  const pick = (emoji: AnimatedEmoji | undefined) => {
    if (!emoji) return;
    rememberRecent(emoji);
    onPick(emoji);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // 输入法组字时回车 / 方向键是给候选框的
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "e") {
      // 再按一次快捷键：收起
      event.preventDefault();
      onClose(true);
    } else if (key === "Enter") {
      event.preventDefault();
      pick(current);
    } else if (
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "ArrowUp" ||
      key === "ArrowDown"
    ) {
      event.preventDefault();
      setActive((index) => moveInGrid(rows, index, key));
    } else if (key === "Tab") {
      event.preventDefault();
      setActive((index) => moveInGrid(rows, index, event.shiftKey ? "ArrowLeft" : "ArrowRight"));
    }
  };

  let index = -1;
  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-label="插入动态表情"
      initial={{ opacity: 0, scale: 0.96, y: place?.above ? 6 : -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      // 退场要快：Esc 之后还挂着半秒会让人以为没关掉
      exit={{ opacity: 0, scale: 0.98, y: place?.above ? 3 : -3, transition: tween.fast }}
      transition={spring.snappy}
      onKeyDown={onKeyDown}
      style={{
        left: place?.left ?? anchor.left,
        top: place?.top ?? anchor.bottom + GAP,
        visibility: place ? "visible" : "hidden",
        // 退场中的那一帧帧已经透明了，不能再接点击 —— 否则点在它原来的位置会插进一个表情
        pointerEvents: present ? undefined : "none",
        transformOrigin: place?.above ? "18px 100%" : "18px 0",
      }}
      className="otw-emoji-picker fixed z-50 w-[292px] overflow-hidden rounded-xl bg-canvas
                 shadow-float ring-1 ring-line-strong"
    >
      <div className="flex h-[42px] items-center gap-2 border-b border-line px-3">
        <Search size={14} strokeWidth={2} className="shrink-0 text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索表情，如 冲 / huo / fire"
          aria-label="搜索动态表情"
          role="combobox"
          aria-expanded="true"
          aria-controls="otw-emoji-grid"
          aria-activedescendant={current ? `otw-emoji-${current.id}-${active}` : undefined}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none
                     placeholder:text-faint"
        />
      </div>

      <div
        id="otw-emoji-grid"
        role="listbox"
        aria-label="动态表情"
        // 焦点始终留在输入框里（aria-activedescendant 指向当前格），这里只是满足 listbox 可聚焦
        tabIndex={-1}
        className="px-2 pb-1.5 pt-1"
      >
        {sections.length === 0 ? (
          <p className="px-2 py-8 text-center text-[12.5px] text-muted">
            没有找到「{query.trim()}」
          </p>
        ) : (
          sections.map((section) => (
            <div key={section.id} role="group" aria-label={section.label}>
              <p className="px-1.5 pb-0.5 pt-1.5 text-[10.5px] font-medium tracking-[0.05em] text-faint">
                {section.label}
              </p>
              <div className="grid grid-cols-6">
                {section.items.map((emoji) => {
                  index += 1;
                  const itemIndex = index;
                  const selected = itemIndex === active;
                  return (
                    <button
                      key={`${section.id}-${emoji.id}`}
                      id={`otw-emoji-${emoji.id}-${itemIndex}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      aria-label={emoji.name}
                      title={`${emoji.name}  ${emoji.shortcode}`}
                      tabIndex={-1}
                      data-emoji={emoji.id}
                      // 按下时别把焦点从输入框抢走，键盘还能接着用
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => {
                        if (!selected) setActive(itemIndex);
                      }}
                      onClick={() => pick(emoji)}
                      className="relative flex h-[44px] items-center justify-center rounded-lg"
                    >
                      {/* 退场时撤掉：带 layoutId 的元素会让 Motion 把整个面板多留一会儿 */}
                      {selected && present && (
                        <motion.span
                          layoutId={layoutIds.emojiCursor}
                          className="absolute inset-[2px] rounded-lg bg-accent-wash"
                          transition={spring.snappy}
                        />
                      )}
                      <span
                        className={cn(
                          "relative z-10 text-[23px] transition-transform duration-[140ms]",
                          selected && "scale-[1.12]",
                        )}
                      >
                        <EmojiGlyph emoji={emoji} active={selected} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex h-[34px] items-center gap-2 border-t border-line px-3 text-[11px] text-faint">
        {current ? (
          <>
            <span className="truncate font-medium text-body">{current.name}</span>
            <span className="truncate font-mono text-[10.5px]">{current.shortcode}</span>
          </>
        ) : null}
        <span className="ml-auto shrink-0">↵ 插入 · Esc 关闭 · {shortcut("E")}</span>
      </div>
    </motion.div>
  );
}
