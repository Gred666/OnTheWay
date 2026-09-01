import { useApp } from "@/app/store";
import { ListColumn } from "@/components/ListColumn";
import { NoteIcon } from "@/components/NoteIcon";
import { SearchInput } from "@/components/SearchInput";
import type { Note } from "@/data/types";
import { cn } from "@/lib/cn";
import { formatSmartCN, toISODate } from "@/lib/date";
import { spring, tween } from "@/lib/motion";
import { Info, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { EmptyResult } from "./NotesView";

export function ArchiveList({
  items,
  onRestore,
}: {
  items: Note[];
  onRestore: (id: string) => void;
}) {
  const selectedId = useApp((s) => s.selectedArchiveId);
  const selectArchive = useApp((s) => s.selectArchive);
  const query = useApp((s) => s.archiveQuery);
  const setQuery = useApp((s) => s.setArchiveQuery);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.excerpt.toLowerCase().includes(q) ||
        n.contentMd.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <ListColumn
      title="归档"
      belowTitle={
        <div className="flex flex-col gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="搜索归档内容" />
          <div className="flex items-center gap-2 rounded-lg bg-raised/45 px-3 py-2">
            <Info size={11.5} strokeWidth={2} className="shrink-0 text-faint" />
            <span className="text-[11px] leading-[1.4] text-muted">
              归档内容不会出现在日常列表中
            </span>
          </div>
        </div>
      }
    >
      {filtered.length === 0 ? (
        <EmptyResult query={query} />
      ) : (
        <div className="flex flex-col">
          {filtered.map((n, i) => (
            <ArchiveCard
              key={n.id}
              note={n}
              index={i}
              divided={i > 0}
              selected={n.id === selectedId}
              onSelect={() => selectArchive(n.id)}
              onRestore={() => onRestore(n.id)}
            />
          ))}
        </div>
      )}
    </ListColumn>
  );
}

function ArchiveCard({
  note,
  index,
  divided,
  selected,
  onSelect,
  onRestore,
}: {
  note: Note;
  index: number;
  divided: boolean;
  selected: boolean;
  onSelect: () => void;
  onRestore: () => void;
}) {
  const dateLabel = note.archivedAt ? formatSmartCN(toISODate(new Date(note.archivedAt))) : "";

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12, transition: tween.fast }}
      transition={{ ...tween.base, delay: Math.min(index, 9) * 0.028 }}
      className={cn(
        "group relative",
        divided && "before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-line",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="relative w-full rounded-lg px-3 py-2.5 pr-9 text-left"
      >
        {selected && (
          <motion.span
            layoutId="archive-selection"
            className="absolute inset-0 rounded-lg bg-accent-wash ring-1 ring-accent-line/60"
            transition={spring.smooth}
          />
        )}
        {!selected && (
          <span
            className="absolute inset-0 rounded-lg transition-colors duration-[150ms]
                       group-hover:bg-raised/40"
          />
        )}

        <span className="relative z-10 flex items-start gap-2">
          <span className={cn("mt-[3px] shrink-0", selected ? "text-accent" : "text-muted")}>
            <NoteIcon id={note.icon} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold leading-[1.45] text-ink/90">
              {note.title}
            </span>
            <span className="mt-[3px] block truncate text-[11.5px] leading-[1.45] text-muted">
              {note.excerpt}
            </span>
            <span className="mt-[5px] flex items-center gap-1.5 text-[10.5px] text-faint">
              <span>{note.archiveCategory}</span>
              <span className="opacity-50">·</span>
              <span className="font-mono tabular-nums">{dateLabel}</span>
            </span>
          </span>
        </span>
      </button>

      {/* 恢复按钮：悬停旋转一圈，是「转回去」的直观隐喻 */}
      <motion.button
        type="button"
        aria-label={`恢复「${note.title}」`}
        title="恢复到笔记"
        onClick={onRestore}
        whileHover={{ rotate: -150 }}
        whileTap={{ scale: 0.85, rotate: -300 }}
        transition={spring.smooth}
        className={cn(
          "absolute right-3 top-[11px] z-20 grid h-5 w-5 place-items-center rounded",
          "transition-opacity duration-[150ms] hover:text-accent",
          selected ? "text-accent opacity-100" : "text-faint opacity-0 group-hover:opacity-100",
        )}
      >
        <RotateCcw size={12.5} strokeWidth={2} />
      </motion.button>
    </motion.div>
  );
}
