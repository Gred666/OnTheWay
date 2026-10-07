import { selectNeighbor } from "@/app/navigate";
import { useApp } from "@/app/store";
import { ListColumn } from "@/components/ListColumn";
import { SearchInput } from "@/components/SearchInput";
import { useData } from "@/data/store";
import type { Note } from "@/data/types";
import { cn } from "@/lib/cn";
import { formatSmartCN, toISODate } from "@/lib/date";
import { animatedEmojiText } from "@/lib/emojiText";
import { spring, tween } from "@/lib/motion";
import { RotateCcw, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo } from "react";
import { ConflictTag, EmptyResult, useListTitle } from "./NotesView";

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
  const deleteNote = useData((s) => s.deleteNote);

  // 同 NotesList：选中的那条在别处没了（或上次看的那条已经不在），正文退到第一条，
  // 列表高亮也跟过去。从这里恢复 / 删除的已经先挪到了下一条（selectNeighbor）
  useEffect(() => {
    if (items.length === 0 || items.some((n) => n.id === selectedId)) return;
    selectArchive(items[0]!.id);
  }, [items, selectedId, selectArchive]);

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
      belowTitle={<SearchInput value={query} onChange={setQuery} placeholder="搜索归档内容" />}
    >
      {filtered.length === 0 ? (
        <EmptyResult
          query={query}
          emptyTitle="归档是空的"
          emptyHint="归档的笔记会保留在这里，不出现在日常列表中"
        />
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
              // 正在看的这篇走了：选中先挪到下一篇（app/navigate 的 selectNeighbor）
              onRestore={() => {
                selectNeighbor(n.id);
                onRestore(n.id);
              }}
              onDelete={() => {
                selectNeighbor(n.id);
                void deleteNote(n.id);
              }}
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
  onDelete,
}: {
  note: Note;
  index: number;
  divided: boolean;
  selected: boolean;
  onSelect: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const dateLabel = note.archivedAt ? formatSmartCN(toISODate(new Date(note.archivedAt))) : "";
  const title = useListTitle(note);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12, transition: tween.fast }}
      transition={{ ...tween.base, delay: Math.min(index, 9) * 0.028 }}
      data-note-row={note.id}
      className={cn(
        "group relative",
        divided && "before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-line",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="relative w-full rounded-lg px-3 py-3 pr-14 text-left"
      >
        {selected && (
          <motion.span
            layoutId="archive-selection"
            className="absolute inset-x-0 inset-y-[2px] rounded-lg bg-accent-wash ring-1
                       ring-accent-line/60"
            transition={spring.smooth}
          />
        )}
        {!selected && (
          <span
            className="absolute inset-x-0 inset-y-[2px] rounded-lg transition-colors
                       duration-[150ms] group-hover:bg-raised/40"
          />
        )}

        <span className="relative z-10 flex items-start gap-2">
          <span className="min-w-0 flex-1">
            {/* 同 NotesView：标题单行，超出用省略号 */}
            <span className="block truncate text-[13.5px] font-semibold leading-[1.45] text-ink/90">
              {title}
            </span>
            <span className="mt-[3px] block truncate text-[11.5px] leading-[1.45] text-muted">
              {note.conflictOf && <ConflictTag title={note.title} />}
              {animatedEmojiText(note.excerpt)}
            </span>
            <span className="mt-[5px] flex items-center gap-1.5 text-[10.5px] text-faint">
              <span>{note.archiveCategory}</span>
              <span className="opacity-50">·</span>
              <span className="font-mono tabular-nums">{dateLabel}</span>
            </span>
          </span>
        </span>
      </button>

      {/* 右上角两个按钮：删除（悬停才出现）、恢复（选中时常亮）。
          以前只有恢复 —— 归档里的笔记删不掉，得先恢复出来再删 */}
      <div className="absolute right-3 top-[11px] z-20 flex items-center gap-1">
        <button
          type="button"
          aria-label={`删除「${title}」`}
          title="删除（可以撤销）"
          onClick={onDelete}
          className="grid h-5 w-5 place-items-center rounded text-faint opacity-0 transition-[opacity,color]
                     duration-[150ms] hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 size={12} strokeWidth={2} />
        </button>
        {/* 恢复按钮：悬停旋转一圈，是「转回去」的直观隐喻 */}
        <motion.button
          type="button"
          aria-label={`恢复「${title}」`}
          title="恢复到笔记"
          onClick={onRestore}
          whileHover={{ rotate: -150 }}
          whileTap={{ scale: 0.85, rotate: -300 }}
          transition={spring.smooth}
          className={cn(
            "grid h-5 w-5 place-items-center rounded",
            "transition-opacity duration-[150ms] hover:text-accent focus-visible:opacity-100",
            selected ? "text-accent opacity-100" : "text-faint opacity-0 group-hover:opacity-100",
          )}
        >
          <RotateCcw size={12.5} strokeWidth={2} />
        </motion.button>
      </div>
    </motion.div>
  );
}
