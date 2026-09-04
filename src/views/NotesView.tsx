import { useApp } from "@/app/store";
import { ColumnButton, GroupLabel, ListColumn } from "@/components/ListColumn";
import { NoteIcon } from "@/components/NoteIcon";
import { RowMenu } from "@/components/RowMenu";
import { SearchInput } from "@/components/SearchInput";
import { useData } from "@/data/store";
import type { Note } from "@/data/types";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/lib/motion";
import { Archive, ArrowUpDown, Pin, PinOff, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

type SortMode = "updated" | "created" | "title";
const SORT_LABEL: Record<SortMode, string> = {
  updated: "按更新时间",
  created: "按创建时间",
  title: "按标题",
};

export function NotesList({ notes }: { notes: Note[] }) {
  const selectedId = useApp((s) => s.selectedNoteId);
  const selectNote = useApp((s) => s.selectNote);
  const query = useApp((s) => s.noteQuery);
  const setQuery = useApp((s) => s.setNoteQuery);
  const searchNotes = useData((s) => s.searchNotes);
  const [sort, setSort] = useState<SortMode>("updated");
  const [matchedIds, setMatchedIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    const value = query.trim();
    if (!value) {
      setMatchedIds(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchNotes(value)
        .then((result) => {
          if (!cancelled) setMatchedIds(new Set(result.hits.map((hit) => hit.id)));
        })
        .catch(() => {
          if (!cancelled) setMatchedIds(null);
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchNotes]);

  const { pinned, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? notes.filter((n) =>
          matchedIds
            ? matchedIds.has(n.id)
            : n.title.toLowerCase().includes(q) ||
              n.excerpt.toLowerCase().includes(q) ||
              n.contentMd.toLowerCase().includes(q),
        )
      : notes;

    const sorted = [...filtered].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title, "zh-Hans-CN");
      if (sort === "created") return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });

    return {
      pinned: sorted.filter((n) => n.isPinned),
      rest: sorted.filter((n) => !n.isPinned),
    };
  }, [matchedIds, notes, query, sort]);

  const empty = pinned.length === 0 && rest.length === 0;

  return (
    <ListColumn
      title="全部笔记"
      action={
        <ColumnButton
          label={`排序：${SORT_LABEL[sort]}`}
          onClick={() =>
            setSort((s) => (s === "updated" ? "created" : s === "created" ? "title" : "updated"))
          }
        >
          <ArrowUpDown size={13} strokeWidth={1.9} />
        </ColumnButton>
      }
      belowTitle={
        <SearchInput value={query} onChange={setQuery} placeholder="搜索标题、正文或标签" />
      }
    >
      {empty ? (
        <EmptyResult query={query} />
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
              <div className="h-1.5" />
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
        "group relative w-full cursor-default rounded-lg px-3 py-2.5 text-left",
        divided && "before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-line",
      )}
    >
      {/* 选中高亮：layoutId 让它在卡片之间滑过去，而不是瞬间跳过去 */}
      {selected && (
        <motion.span
          layoutId="note-selection"
          className={cn(
            "absolute inset-0 rounded-lg bg-accent-wash",
            boxed && "ring-1 ring-accent-line/70",
          )}
          transition={spring.smooth}
        />
      )}
      {!selected && (
        <span
          className="absolute inset-0 rounded-lg bg-raised/0 transition-colors duration-[150ms]
                     group-hover:bg-raised/40"
        />
      )}

      <span className="relative z-10 flex items-start gap-2">
        <motion.span
          className={cn("mt-[3px] shrink-0", selected ? "text-accent" : "text-muted")}
          animate={{ scale: selected ? 1.05 : 1 }}
          transition={spring.snappy}
        >
          <NoteIcon id={note.icon} />
        </motion.span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "flex items-center gap-1.5 text-[13.5px] font-semibold leading-[1.45]",
              selected ? "text-ink" : "text-ink/90",
              note.icon === "sparkle" && "italic",
            )}
          >
            <span className="truncate">{note.title}</span>
          </span>
          <span className="mt-[3px] block truncate text-[11.5px] leading-[1.45] text-muted">
            {note.excerpt}
          </span>
        </span>

        {/* 占位：给右上角的图钉/菜单留出固定宽度，避免标题在悬停时抖动 */}
        <span className="mt-[2px] block h-[13px] w-[13px] shrink-0" aria-hidden="true">
          {note.isPinned && (
            <motion.span
              className="block text-accent transition-opacity duration-[150ms]
                         group-hover:opacity-0"
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

export function EmptyResult({ query }: { query: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={query}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={tween.base}
        className="px-3 pt-10 text-center"
      >
        <p className="text-[12.5px] text-muted">没有匹配的内容</p>
        <p className="mt-1 text-[11.5px] text-faint">试试更短的关键词</p>
      </motion.div>
    </AnimatePresence>
  );
}
