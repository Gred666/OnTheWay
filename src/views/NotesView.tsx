import { useApp } from "@/app/store";
import { ColumnButton, GroupLabel, ListColumn } from "@/components/ListColumn";
import { ActionMenu, RowMenu } from "@/components/RowMenu";
import { SearchInput } from "@/components/SearchInput";
import { useData } from "@/data/store";
import type { Note } from "@/data/types";
import { cn } from "@/lib/cn";
import { animatedEmojiText } from "@/lib/emojiText";
import { spring, tween } from "@/lib/motion";
import {
  ALargeSmall,
  Archive,
  ArrowUpDown,
  CalendarPlus,
  History,
  type LucideIcon,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

type SortMode = "updated" | "created" | "title";
const SORT_MODES: SortMode[] = ["updated", "created", "title"];
const SORT_LABEL: Record<SortMode, string> = {
  updated: "按更新时间",
  created: "按创建时间",
  title: "按标题",
};
const SORT_ICON: Record<SortMode, LucideIcon> = {
  updated: History,
  created: CalendarPlus,
  title: ALargeSmall,
};

export function NotesList({ notes }: { notes: Note[] }) {
  const selectedId = useApp((s) => s.selectedNoteId);
  const selectNote = useApp((s) => s.selectNote);
  const query = useApp((s) => s.noteQuery);
  const setQuery = useApp((s) => s.setNoteQuery);
  const createNote = useData((s) => s.createNote);
  const [sort, setSort] = useState<SortMode>("updated");
  const [creating, setCreating] = useState(false);

  // 选中的那篇没了（被删、被归档，或者初始 id 本来就不存在）：正文那边
  // 会退到第一篇（见 adapter），列表的高亮得跟着挪过去 —— 否则右边显示着
  // 一篇笔记、左边却没有任何一行是亮的。
  useEffect(() => {
    if (notes.length === 0 || notes.some((n) => n.id === selectedId)) return;
    selectNote(notes[0]!.id);
  }, [notes, selectedId, selectNote]);

  // 只按标题筛。原来还走一遍后端全文检索去匹配正文和标签，结果是
  // 输入「周」也能翻出一堆正文里提到过它的笔记，跟标题栏里看到的对不上；
  // 而且异步回填有 160ms 防抖，列表会先按本地规则闪一次再换成后端结果。
  // 标题就在内存里，同步过滤，敲一个字就是一个字的结果。
  const { pinned, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? notes.filter((n) => n.title.toLowerCase().includes(q)) : notes;

    // 「按更新时间」直接用 store 里的顺序（加载 / 置顶 / 归档时已按 updatedAt 排好），
    // 不在这里按 updatedAt 重排：自动保存每 400ms 刷新一次它，正在编辑的那篇
    // 会在侧栏里当着用户的面往上跳 —— store 刻意不重排就是为了避免这个。
    const sorted =
      sort === "updated"
        ? filtered
        : [...filtered].sort((a, b) =>
            sort === "title"
              ? a.title.localeCompare(b.title, "zh-Hans-CN")
              : b.createdAt - a.createdAt,
          );

    return {
      pinned: sorted.filter((n) => n.isPinned),
      rest: sorted.filter((n) => !n.isPinned),
    };
  }, [notes, query, sort]);

  const empty = pinned.length === 0 && rest.length === 0;

  const handleCreate = async () => {
    // 后端慢的时候连点两下会白建好几篇空笔记
    if (creating) return;
    setCreating(true);
    try {
      const id = await createNote();
      if (!id) return;
      // 新笔记是空的，搜索词留着的话它进不了当前筛选结果 ——
      // 用户点了「新建」，界面上却什么都没发生。
      setQuery("");
      selectNote(id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <ListColumn
      title="全部笔记"
      action={
        <div className="flex items-center gap-1.5">
          {/* 排序：点开一个单选菜单，而不是盲点循环 —— 循环切换看不到还有哪些
              选项、也不知道现在是哪一种，得点三下才能确认转了一圈。 */}
          <ActionMenu
            trigger={
              <ColumnButton label={`排序：${SORT_LABEL[sort]}`}>
                <ArrowUpDown size={13} strokeWidth={1.9} />
              </ColumnButton>
            }
            actions={SORT_MODES.map((mode) => ({
              id: mode,
              label: SORT_LABEL[mode],
              icon: SORT_ICON[mode],
              checked: sort === mode,
              onSelect: () => setSort(mode),
            }))}
          />
          <ColumnButton label="新建笔记" onClick={() => void handleCreate()}>
            <Plus size={15} strokeWidth={2.1} />
          </ColumnButton>
        </div>
      }
      belowTitle={<SearchInput value={query} onChange={setQuery} placeholder="搜索标题" />}
    >
      {empty ? (
        <EmptyResult query={query} emptyTitle="还没有笔记" emptyHint="点右上角的 + 新建一篇" />
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <GroupLabel icon={<Pin size={10} strokeWidth={2} />} text="置顶" />
              {pinned.map((n, i) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  index={i}
                  selected={n.id === selectedId}
                  onSelect={() => selectNote(n.id)}
                  boxed
                />
              ))}
            </>
          )}

          {/* 两组之间原本只有 6px 空隙、下面一组还没有标题，翻起来根本看不出
              哪里是分界。补一条分隔线和一个对称的组标题。 */}
          {pinned.length > 0 && rest.length > 0 && (
            <>
              <div className="mx-3 mt-3 mb-1 border-t border-line-strong/70" />
              <GroupLabel text="其他" />
            </>
          )}

          <div className="flex flex-col">
            {rest.map((n, i) => (
              <NoteCard
                key={n.id}
                note={n}
                index={pinned.length + i}
                selected={n.id === selectedId}
                onSelect={() => selectNote(n.id)}
                divided={i > 0}
              />
            ))}
          </div>
        </>
      )}
    </ListColumn>
  );
}

function NoteCard({
  note,
  index,
  selected,
  onSelect,
  boxed,
  divided,
}: {
  note: Note;
  index: number;
  selected: boolean;
  onSelect: () => void;
  /** 置顶卡片带独立圆角底 */
  boxed?: boolean;
  /** 普通卡片之间画分隔线 */
  divided?: boolean;
}) {
  const togglePin = useData((s) => s.togglePin);
  const archiveNote = useData((s) => s.archiveNote);
  const deleteNote = useData((s) => s.deleteNote);
  // 「…」菜单开着的时候指针在菜单上、不在行上，行会掉出 hover 态；
  // 底色一暗一亮，看着像菜单和行没关系。开着就按住不放。
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <motion.div
      layout="position"
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      initial={{ opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...tween.base, delay: Math.min(index, 9) * 0.028 }}
      className={cn(
        "group relative w-full cursor-default rounded-lg px-3 py-3 text-left",
        divided && "before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-line",
      )}
    >
      {/* 选中高亮：layoutId 让它在卡片之间滑过去，而不是瞬间跳过去 */}
      {selected && (
        <motion.span
          layoutId="note-selection"
          className={cn(
            "absolute inset-x-0 inset-y-[2px] rounded-lg bg-accent-wash",
            boxed && "ring-1 ring-accent-line/70",
          )}
          transition={spring.smooth}
        />
      )}
      {!selected && (
        /* 上下各缩 2px：底色铺满 inset-0 的话，选中那块和相邻那块悬停时会边贴边
           连成一片，看不出是两行。缩进之后中间留 4px，两块各自独立。
           「…」菜单开着时指针在菜单上、不在行上，这里按住不放。 */
        <span
          className={cn(
            "absolute inset-x-0 inset-y-[2px] rounded-lg transition-colors duration-[150ms]",
            menuOpen ? "bg-raised/40" : "bg-raised/0 group-hover:bg-raised/40",
          )}
        />
      )}

      {/* note.icon 是 seed 里写死的，没有任何入口能改它（新建笔记一律是 file），
          于是它看着像在分类、实际什么也没分。标题的斜体原本也挂在同一个字段上
          （icon === "sparkle"），一并去掉 —— 留着就是随机有几篇笔记是斜体。 */}
      <span className="relative z-10 flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "flex items-center gap-1.5 text-[13.5px] font-semibold leading-[1.45]",
              selected ? "text-ink" : "text-ink/90",
            )}
          >
            <span className="truncate">{note.title}</span>
          </span>
          <span className="mt-[3px] block truncate text-[11.5px] leading-[1.45] text-muted">
            {animatedEmojiText(note.excerpt)}
          </span>
        </span>

        {/* 占位：给右上角的图钉/菜单留出固定宽度，避免标题在悬停时抖动 */}
        <span className="mt-[2px] block h-[13px] w-[13px] shrink-0" aria-hidden="true">
          {note.isPinned && (
            <motion.span
              className={cn(
                "block text-accent transition-opacity duration-[150ms] group-hover:opacity-0",
                menuOpen && "opacity-0",
              )}
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 45 }}
              transition={spring.bouncy}
            >
              <Pin size={11.5} strokeWidth={2} />
            </motion.span>
          )}
        </span>
      </span>

      {/* 操作菜单叠在图钉的位置：静止时看到图钉，悬停时换成「…」 */}
      <div className="absolute right-[11px] top-[11px] z-20" onClick={(e) => e.stopPropagation()}>
        <RowMenu
          onOpenChange={setMenuOpen}
          actions={[
            {
              id: "pin",
              label: note.isPinned ? "取消置顶" : "置顶",
              icon: note.isPinned ? PinOff : Pin,
              onSelect: () => togglePin(note.id),
            },
            {
              id: "archive",
              label: "归档",
              icon: Archive,
              onSelect: () => archiveNote(note.id),
            },
            {
              id: "delete",
              label: "删除",
              icon: Trash2,
              danger: true,
              onSelect: () => deleteNote(note.id),
            },
          ]}
        />
      </div>
    </motion.div>
  );
}

/**
 * 列表空了。有搜索词时是「没搜到」；没有搜索词就是真的一篇都没有 ——
 * 以前两种情况都说「没有匹配的内容，试试更短的关键词」，可用户什么都没搜。
 */
export function EmptyResult({
  query,
  emptyTitle,
  emptyHint,
}: {
  query: string;
  /** 没有搜索词、列表本身就是空的时候显示的文案 */
  emptyTitle: string;
  emptyHint: string;
}) {
  const searching = query.trim() !== "";
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={searching ? query : "empty"}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={tween.base}
        className="px-3 pt-10 text-center"
      >
        <p className="text-[12.5px] text-muted">{searching ? "没有匹配的内容" : emptyTitle}</p>
        <p className="mt-1 text-[11.5px] text-faint">
          {searching ? "试试更短的关键词" : emptyHint}
        </p>
      </motion.div>
    </AnimatePresence>
  );
}
