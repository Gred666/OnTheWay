import { openDocument } from "@/app/navigate";
import { useData } from "@/data/store";
import type { DocumentModel, Note } from "@/data/types";
import { cn } from "@/lib/cn";
import { type DiffLine, diffHunks, diffLines, diffStats } from "@/lib/lineDiff";
import { tween } from "@/lib/motion";
import { ChevronRight, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

/* ============================================================
   冲突副本的横幅（标题上方）。

   这篇是另一篇的冲突副本：两台机器都改了同一篇，网盘同步时没法合并，把其中一版
   另存成了这一篇（或者本应用自己另存的 ——外部改动撞上了没存的修改）。
   给四个动作：看两版差在哪、打开原文、用这一版替换原文、删掉这份副本。
   删掉的副本进回收站，撤销提示条照常能撤。
   ============================================================ */

export function ConflictBanner({
  conflict,
}: {
  conflict: NonNullable<DocumentModel["conflict"]>;
}) {
  const copy = useData((s) => findNote(s, conflict.copyId));
  const original = useData((s) => findNote(s, conflict.originalId));
  const resolveConflict = useData((s) => s.resolveConflict);
  const [showDiff, setShowDiff] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const diff = useMemo(
    () => (copy && original ? diffLines(original.contentMd, copy.contentMd) : null),
    [copy, original],
  );
  const stats = diff ? diffStats(diff) : null;
  const identical = !!stats && stats.added === 0 && stats.removed === 0;

  const resolve = async (keep: "copy" | "original") => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await resolveConflict(conflict.copyId, keep);
      if (id) openDocument({ kind: "note", id });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="mb-7 rounded-xl border border-warning/30 bg-warning/[0.07] px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <Copy size={14} strokeWidth={1.9} className="mt-[3px] shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-[1.6] text-ink">
            这是「{conflict.originalTitle}」的冲突副本
          </p>
          <p className="mt-0.5 text-[12px] leading-[1.65] text-muted">
            {identical
              ? "两版内容一模一样，留着它没有用，可以直接删掉。"
              : "同一篇在两处都被改过，同步时没法自动合并，另一版就留成了这一篇。对比一下，留下要的那一版。"}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {!identical && (
              <BannerButton onClick={() => setShowDiff((value) => !value)}>
                <ChevronRight
                  size={12}
                  strokeWidth={2.2}
                  className={cn("transition-transform duration-[160ms]", showDiff && "rotate-90")}
                />
                {stats ? (
                  <>
                    查看差异
                    <span className="font-mono text-[10.5px] text-success">+{stats.added}</span>
                    <span className="font-mono text-[10.5px] text-danger">−{stats.removed}</span>
                  </>
                ) : (
                  "查看差异"
                )}
              </BannerButton>
            )}
            <BannerButton onClick={() => openDocument({ kind: "note", id: conflict.originalId })}>
              打开原文
            </BannerButton>
            {confirming ? (
              <span className="flex items-center gap-1.5 rounded-md bg-warning/10 py-0.5 pl-2 pr-0.5">
                <span className="text-[11.5px] text-body">原文现在的内容会被这一版覆盖</span>
                <BannerButton strong disabled={busy} onClick={() => void resolve("copy")}>
                  替换
                </BannerButton>
                <BannerButton onClick={() => setConfirming(false)}>取消</BannerButton>
              </span>
            ) : (
              !identical && (
                <BannerButton disabled={busy} onClick={() => setConfirming(true)}>
                  用这一版替换原文
                </BannerButton>
              )
            )}
            <BannerButton danger disabled={busy} onClick={() => void resolve("original")}>
              删掉这份副本
            </BannerButton>
          </div>

          <AnimatePresence initial={false}>
            {showDiff && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={tween.fast}
              >
                <DiffView lines={diff} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function DiffView({ lines }: { lines: DiffLine[] | null }) {
  if (!lines) {
    return (
      <p className="mt-3 text-[12px] text-faint">
        两版都很长，没法逐行对比。打开原文，两篇并排看吧。
      </p>
    );
  }
  const hunks = diffHunks(lines);
  return (
    <div
      className="scroll-thin mt-3 max-h-[300px] overflow-y-auto rounded-lg border border-line
                 bg-canvas py-1.5 font-mono text-[11.5px] leading-[1.7]"
    >
      <div className="flex gap-3 px-3 pb-1.5 text-[10.5px] text-faint">
        <span>
          <span className="text-danger">−</span> 只在原文里
        </span>
        <span>
          <span className="text-success">+</span> 只在这一版里
        </span>
      </div>
      {hunks.map((hunk, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 差异段按位置排，不会重排
        <div
          key={index}
          className={cn(index > 0 && "mt-1.5 border-t border-dashed border-line pt-1.5")}
        >
          {hunk.lines.map((line, lineIndex) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 同上
              key={lineIndex}
              className={cn(
                "flex gap-2 whitespace-pre-wrap break-words px-3",
                line.kind === "added" && "bg-success/10 text-body",
                line.kind === "removed" && "bg-danger/10 text-body",
                line.kind === "same" && "text-faint",
              )}
            >
              <span
                className={cn(
                  "w-2 shrink-0 select-none",
                  line.kind === "added" && "text-success",
                  line.kind === "removed" && "text-danger",
                )}
              >
                {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
              </span>
              <span className="min-w-0">{line.text || " "}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function BannerButton({
  children,
  onClick,
  disabled,
  danger,
  strong,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  strong?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-[3px] text-[12px] transition-colors duration-[140ms]",
        "disabled:opacity-50",
        strong
          ? "bg-warning/20 font-medium text-ink hover:bg-warning/30"
          : danger
            ? "text-danger hover:bg-danger/10"
            : "text-body hover:bg-raised",
      )}
    >
      {children}
    </button>
  );
}

function findNote(state: { notes: Note[]; archived: Note[] }, id: string) {
  return (
    state.notes.find((note) => note.id === id) ?? state.archived.find((note) => note.id === id)
  );
}
