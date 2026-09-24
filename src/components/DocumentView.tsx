import { RAIL_WIDTH, useApp } from "@/app/store";
import { NEW_NOTE_TITLE, saveKeyOf, useData } from "@/data/store";
import type { DocumentModel, DocumentSaveTarget } from "@/data/types";
import type { EditorOutlineHandle } from "@/editor/MarkdownEditor";
import { cn } from "@/lib/cn";
import { buildOutline, renderMarkdown } from "@/lib/markdown";
import { spring, tween } from "@/lib/motion";
import { AlertTriangle, Archive, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionGroup } from "./ActionItem";
import { Outline } from "./Outline";
import { OverlayScrollbar } from "./OverlayScrollbar";
import { Segmented } from "./Segmented";

/** 目录树的指纹：标题文字或行号变了才需要重新渲染文档视图。 */
const outlineKeyOf = (markdown: string) =>
  buildOutline(markdown)
    .map((item) => `${item.id}@${item.line}`)
    .join("|");

/* 编辑器分包在模块求值时就开始下载。DocumentView 是 Shell 的静态依赖，
   所以这一行等于「应用一启动就预载编辑器」。

   之所以要预载：首屏默认工作区（笔记）第一帧就要用编辑器渲染正文。chunk 没
   到位时会先渲染一次 DocumentPreview —— 而两者排版并不一致（正文 15px vs
   17px/1.82，h2 21px vs 29.75px），到位后一换，整篇重排一次，就是启动时那
   一下闪动。

   这里刻意没有用 React.lazy + Suspense：即便传给 lazy 的 promise 早已 resolve，
   首次渲染也必然先 suspend 一次、把 fallback 提交上屏，闪动照旧（实测预览仍
   会在 1162ms 出现一次）。改成自己持有解析后的组件引用，预载完成时首帧就能
   直接渲染编辑器，一次都不用替换。 */
type EditorComponent = typeof import("@/editor/MarkdownEditor").MarkdownEditor;

const editorModule = import("@/editor/MarkdownEditor");
/** 预载完成后同步可用；bootstrap 在挂载 React 之前把它填好。 */
let resolvedEditor: EditorComponent | null = null;

/** 供 bootstrap 在挂载 React 之前 await，确保首帧就能直接渲染编辑器。 */
export const preloadEditor = async () => {
  resolvedEditor = (await editorModule).MarkdownEditor;
};

/* ============================================================
   统一文档视图。
   笔记 / 今日TODO / GOAL / 日历某天 / 归档项 —— 全部由它渲染。
   新增内容类型只需要在 adapter 里多映射一个 DocumentModel，
   不需要写新的视图组件。
   ============================================================ */

export function DocumentView({
  doc,
  onToggleTask,
  onSegmentChange,
  onDelete,
  onSaveDocument,
  onSaveTitle,
  editorEnabled = true,
}: {
  doc: DocumentModel;
  onToggleTask: (id: string) => void;
  onSegmentChange?: (v: string) => void;
  onDelete?: () => void;
  onSaveDocument?: (target: DocumentSaveTarget, markdown: string) => Promise<void>;
  onSaveTitle?: (target: DocumentSaveTarget, title: string) => Promise<void>;
  editorEnabled?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editorOutline, setEditorOutline] = useState<EditorOutlineHandle | null>(null);
  const workspace = useApp((s) => s.workspace);
  const zen = useApp((s) => s.zen);
  const setZen = useApp((s) => s.setZen);
  // 只有笔记区给这个入口：其它区要么是两栏、要么本来就没有可铺满的正文
  const zenAvailable = workspace === "notes";
  // 编辑器里的实时正文。doc.bodyMd 要等一次保存往返才更新，
  // 只靠它的话目录树会永远慢半拍，点条目还会跳到旧行号。
  const [liveMarkdown, setLiveMarkdown] = useState<string | null>(null);
  const outlineKeyRef = useRef<string | null>(null);

  // 只有目录真的变了才把正文提上来，避免每敲一个字都重渲染整个文档视图。
  const handleDocumentChange = useCallback((markdown: string) => {
    const key = outlineKeyOf(markdown);
    if (key === outlineKeyRef.current) return;
    outlineKeyRef.current = key;
    setLiveMarkdown(markdown);
  }, []);

  // Mod + 点击 [[双链]]：按标题找到那篇笔记就跳过去（归档里的也算），找不到就什么都不做。
  // `[[标题#小节]]` 再记一个待滚动的锚点，等那篇的编辑器挂上后滚过去。
  const handleWikiLink = useCallback((title: string, heading?: string) => {
    const wanted = title.trim().toLowerCase();
    const { notes, archived } = useData.getState();
    const hit =
      notes.find((note) => note.title.trim().toLowerCase() === wanted) ??
      archived.find((note) => note.title.trim().toLowerCase() === wanted);
    if (!hit) return;
    const app = useApp.getState();
    if (hit.isArchived) {
      app.selectArchive(hit.id);
      app.setWorkspace("archive");
    } else {
      app.selectNote(hit.id);
      app.setWorkspace("notes");
    }
    app.setPendingAnchor(heading ? { docKey: `note-${hit.id}`, heading } : null);
  }, []);


  const outlineSource = liveMarkdown ?? doc.bodyMd;
  const outline = useMemo(
    () =>
      buildOutline(outlineSource, doc.actionGroup?.hideHeader ? undefined : doc.actionGroup?.title),
    [outlineSource, doc.actionGroup?.title, doc.actionGroup?.hideHeader],
  );

  // 双链带的小节：目标笔记的目录一算出来就滚过去。旧编辑器的句柄会拒绝（返回 false），
  // 那就等下一次 —— 新编辑器挂上后 editorOutline 会换掉，effect 会再跑。
  const pendingAnchor = useApp((s) => s.pendingAnchor);
  const setPendingAnchor = useApp((s) => s.setPendingAnchor);
  useEffect(() => {
    if (!pendingAnchor || pendingAnchor.docKey !== doc.key || !editorOutline) return;
    const wanted = pendingAnchor.heading.trim().toLowerCase();
    const item = outline.find((entry) => entry.text.trim().toLowerCase() === wanted);
    if (!item) return;
    if (editorOutline.scrollTo(item.id)) setPendingAnchor(null);
  }, [pendingAnchor, doc.key, editorOutline, outline, setPendingAnchor]);

  const saving = useData((state) => (doc.editor ? state.savingDocs.has(saveKey(doc)) : false));
  const saveError = useData((state) => state.saveError);

  // 切换文档时滚回顶部。用 instant 而不是 smooth ——
  // 换了一篇文档还看到旧位置平滑滚动，是错误的心智模型。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只应在 doc.key 变化时触发
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
    setLiveMarkdown(null);
    outlineKeyRef.current = null;
  }, [doc.key]);

  const canEdit = !!doc.editor && !!onSaveDocument && editorEnabled;

  // 正常路径下 bootstrap 已经预载完，这里首帧就拿到组件。
  // 兜底：万一没走 bootstrap（比如单测直接渲染本组件），照旧异步加载后再补上。
  const [Editor, setEditor] = useState<EditorComponent | null>(() => resolvedEditor);
  useEffect(() => {
    if (Editor) return;
    let alive = true;
    void editorModule.then((module) => {
      resolvedEditor = module.MarkdownEditor;
      if (alive) setEditor(() => module.MarkdownEditor);
    });
    return () => {
      alive = false;
    };
  }, [Editor]);

  return (
    <div className="relative flex h-full min-w-0 flex-1 bg-canvas">
      {/* 定位基准必须是滚动容器自己这一层。挂到外面那行上的话，
          absolute right-0 贴的是「正文 + 大纲栏」的右边 ——
          滑块会跑到大纲栏外侧去，离它真正在滚的那块内容隔着一整栏。 */}
      <div className="relative min-w-0 flex-1">
        {/* 画布往左 chrome 底下多铺 RAIL_WIDTH：负外边距把盒子拉过去，等宽的
            内边距把内容留在原位，所以排版一点没变，只是底色和裁切边界往左
            延到了窗口边缘。退出专注模式时 chrome 滑回来的那段时间，正文能
            一直完整地显示在白底上、往右滑到新位置 —— 否则滚动容器（overflow-y
            一设，横向也必然裁切）会在 chrome 的右边缘把正在位移的正文切掉。
            平时这一截压在 z-30 的 chrome 底下，看不见也摸不着。 */}
        <div
          ref={scrollRef}
          className="scroll-none h-full overflow-y-auto bg-canvas"
          style={{ marginLeft: -RAIL_WIDTH, paddingLeft: RAIL_WIDTH }}
        >
          {/* layout="position" 让这一列在进出专注模式时「滑」到新的居中位置，
              而不是瞬间跳过去。只动位置不动尺寸 —— 尺寸动画是 scale，会把文字
              拉变形。layoutDependency={zen} 把重新测量限定在 zen 变化这一次，
              换笔记、正文变长都不会触发多余的位移动画。 */}
          <motion.div
            layout="position"
            layoutDependency={zen}
            transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto flex min-h-full w-full max-w-[860px] flex-col px-14 pb-6 pt-[52px]"
          >
            {/* ---------- 归档横幅 ----------
                key 固定：在两篇归档笔记之间切换时横幅本身不动，只有文字淡入换掉。
                原来按文字做 key，日期不同的两篇一切，旧条往上退、新条从上落，
                两条叠在一起错开几像素 —— 看起来就是在抖。 */}
            <AnimatePresence mode="popLayout" initial={false}>
              {doc.banner && (
                <motion.div
                  key="banner"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={tween.base}
                  className="mb-7 flex items-center gap-2 rounded-lg bg-danger/10 px-3.5 py-2.5"
                >
                  <Archive size={12.5} strokeWidth={1.9} className="shrink-0 text-danger" />
                  <motion.span
                    key={doc.banner.text}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={tween.fast}
                    className="text-[12px] text-danger"
                  >
                    {doc.banner.text}
                  </motion.span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ---------- 标题行 ---------- */}
            <header id="doc-top" data-outline-id="doc-top">
              {/* 标题上方那一行：左边是小字（日历某天的日期），右边是分段控件。
                  分段控件原来和标题并排在同一行、分掉一截宽度，日历某天的标题
                  稍长就被它截掉。挪上来之后标题独占整行；这一行的高度钉在小字
                  的一行高，控件比它高出来的部分往上溢进顶部留白里（负外边距），
                  标题的位置不受影响，切「日TODO ↔ 周/GOAL」时控件也不挪窝。 */}
              {(doc.eyebrow || (doc.segments && onSegmentChange)) && (
                <div className="mb-2 flex min-h-[20px] items-end justify-between gap-8">
                  {doc.eyebrow && (
                    <motion.p
                      key={`${doc.key}-eyebrow`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={tween.base}
                      className="min-w-0 truncate text-[12px] font-medium leading-[20px]
                                 tracking-[0.02em] text-muted"
                    >
                      {doc.eyebrow}
                    </motion.p>
                  )}
                  {doc.segments && onSegmentChange && (
                    <div className="-mt-2.5 ml-auto shrink-0">
                      <Segmented
                        group={doc.segments.group}
                        options={doc.segments.options.map((o) => ({ value: o, label: o }))}
                        value={doc.segments.active}
                        onChange={onSegmentChange}
                        size={doc.segments.options.length > 3 ? "sm" : "md"}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="min-w-0 overflow-hidden">
                <AnimatePresence mode="popLayout" initial={false}>
                  {doc.editor?.titleEditable && onSaveTitle ? (
                    <EditableDocumentTitle
                      key={doc.key}
                      title={doc.title}
                      // 占位标题（无标题笔记）不是真标题：输入框里留空，让用户直接起名
                      placeholder={doc.title === NEW_NOTE_TITLE}
                      onSave={(title) => onSaveTitle(doc.editor!.target, title)}
                    />
                  ) : (
                    <motion.h1
                      key={doc.key}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -14 }}
                      transition={spring.smooth}
                      className="selectable text-[38px] font-bold leading-[1.25] tracking-[-0.02em]
                               text-ink"
                    >
                      {doc.title}
                    </motion.h1>
                  )}
                </AnimatePresence>
              </div>
            </header>

            {/* 标题下的细分隔线：宽度从 0 展开，是「文档打开了」的一个小信号 */}
            <motion.div
              key={`${doc.key}-rule`}
              className="mt-6 h-px origin-left bg-line"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
            />

            {/* ---------- 正文 ---------- */}
            {doc.editor ? (
              // 编辑器稳定岛：这里以及编辑器自身都没有 Motion layout/transform。
              // Shell 那边的工作区进场也是纯 opacity、不带 transform，所以编辑器
              // 可以在新一屏的第一帧就挂上，不需要先拿 DocumentPreview 顶一段。
              // 这一点很重要：预览和编辑器的排版并不一致（正文 15px vs 17px/1.82，
              // h2 21px vs 29.75px），中途替换会让整篇重排一次，看着像卡顿。
              // editorEnabled 仍然保留给需要强制只读的调用方。
              <div className="flex-1">
                {canEdit && Editor ? (
                  <Editor
                    key={saveKey(doc)}
                    initialMarkdown={doc.bodyMd}
                    onSave={(markdown) => onSaveDocument(doc.editor!.target, markdown)}
                    outlineItems={outline}
                    onOutlineHandle={setEditorOutline}
                    onDocumentChange={handleDocumentChange}
                    onWikiLink={handleWikiLink}
                    // 日历当日安排跟在正文后面：编辑器别再撑 360px 把任务推到底下
                    fill={!doc.actionGroup?.tasks.length}
                  />
                ) : (
                  <DocumentPreview markdown={doc.bodyMd} />
                )}

                {doc.actionGroup && doc.actionGroup.tasks.length > 0 && (
                  <ActionGroup
                    title={doc.actionGroup.title}
                    tasks={doc.actionGroup.tasks}
                    counterMode={doc.actionGroup.title === "本周重点" ? "count" : "progress"}
                    hideHeader={doc.actionGroup.hideHeader}
                    onToggle={onToggleTask}
                  />
                )}
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={doc.key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ ...tween.base, delay: 0.04 }}
                  className="flex-1"
                >
                  <DocumentPreview markdown={doc.bodyMd} />

                  {doc.actionGroup && doc.actionGroup.tasks.length > 0 && (
                    <ActionGroup
                      title={doc.actionGroup.title}
                      tasks={doc.actionGroup.tasks}
                      counterMode={doc.actionGroup.title === "本周重点" ? "count" : "progress"}
                      hideHeader={doc.actionGroup.hideHeader}
                      onToggle={onToggleTask}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            )}

            {/* ---------- 底部状态栏 ---------- */}
            <StatusBar
              parts={doc.statusParts}
              onDelete={doc.deletable ? onDelete : undefined}
              saving={saving}
              saveError={doc.editor ? saveError : null}
            />
          </motion.div>
        </div>
        <OverlayScrollbar targetRef={scrollRef} />
      </div>

      <Outline
        items={outline}
        scrollRef={scrollRef}
        resetKey={doc.key}
        editorHandle={editorOutline}
        zen={zen}
      />

      {zenAvailable && <ZenToggle zen={zen} onToggle={() => setZen(!zen)} />}
    </div>
  );
}

/**
 * 全屏（专注模式）开关。
 *
 * 位置固定在正文区右上角，不跟着正文滚动。静止时是极淡的一个图标 ——
 * 写字的时候它不该抢注意力；悬停才变实。进入之后图标换成收起，
 * 加上 Esc 也能退出（见 Shell）。
 */
function ZenToggle({ zen, onToggle }: { zen: boolean; onToggle: () => void }) {
  const Icon = zen ? Minimize2 : Maximize2;
  const label = zen ? "退出全屏（Esc）" : "全屏编辑";

  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={zen}
      title={label}
      whileTap={{ scale: 0.9 }}
      transition={spring.snappy}
      className={cn(
        "absolute right-4 top-[44px] z-40 grid h-8 w-8 place-items-center rounded-lg",
        "text-faint transition-colors duration-[160ms] hover:bg-raised hover:text-ink",
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={zen ? "min" : "max"}
          initial={{ opacity: 0, scale: 0.7, rotate: zen ? -35 : 35 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.7, rotate: zen ? 35 : -35 }}
          transition={spring.snappy}
          className="grid place-items-center"
        >
          <Icon size={14.5} strokeWidth={2} />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

/**
 * 只读正文预览。
 *
 * 做成组件而不是父组件里的一个 useMemo：它主要是编辑器分包加载时的
 * Suspense 占位，而占位只在真正挂起时才会被渲染。写成 memo 之后，
 * 编辑器已经挂上的情况下这段渲染根本不会执行 —— 否则每次自动保存
 * 回填 bodyMd 都要白白重排一遍整篇（90KB 文档约 10ms）。
 */
const DocumentPreview = memo(function DocumentPreview({ markdown }: { markdown: string }) {
  const body = useMemo(() => renderMarkdown(markdown), [markdown]);
  return <article className="prose-doc selectable mt-7">{body}</article>;
});

/** store 里 savingDocs 的键。 */
function saveKey(doc: DocumentModel): string {
  return doc.editor ? saveKeyOf(doc.editor.target) : "";
}

function EditableDocumentTitle({
  title,
  placeholder,
  onSave,
}: {
  title: string;
  /** 当前标题只是占位（还没起名）：输入框留空、显示占位文字 */
  placeholder?: boolean;
  onSave: (title: string) => Promise<void>;
}) {
  const shown = placeholder ? "" : title;
  const [value, setValue] = useState(shown);
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const clean = value.trim();
    if (!clean) {
      setValue(shown);
      return;
    }
    if (clean === title) return;
    setSaving(true);
    try {
      await onSave(clean);
      setValue(clean);
    } catch {
      setValue(shown);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.input
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: saving ? 0.65 : 1, y: 0 }}
      transition={spring.smooth}
      value={value}
      disabled={saving}
      aria-label="笔记标题"
      placeholder={placeholder ? title : undefined}
      onChange={(event) => setValue(event.target.value.replace(/[\r\n]/g, ""))}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setValue(shown);
          event.currentTarget.blur();
        }
      }}
      className="w-full min-w-0 border-0 bg-transparent p-0 text-[38px] font-bold leading-[1.25]
                 tracking-[-0.02em] text-ink outline-none placeholder:text-faint"
    />
  );
}

function StatusBar({
  parts,
  onDelete,
  saving,
  saveError,
}: {
  parts: string[];
  onDelete?: () => void;
  saving?: boolean;
  saveError?: string | null;
}) {
  return (
    <footer className="mt-16 flex items-center gap-3 border-t border-line pt-3.5">
      <motion.div
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...tween.base, delay: 0.18 }}
      >
        {parts.map((p, i) => (
          <span key={p} className="flex items-center gap-2.5">
            {i > 0 && <span className="text-faint/50">·</span>}
            <span className="font-mono text-[10.5px] leading-none text-faint">{p}</span>
          </span>
        ))}
        {/* 保存状态。以前 store 里记了 error 却没人渲染，
            自动保存失败时界面上完全看不出来。 */}
        {saveError ? (
          <span className="flex min-w-0 items-center gap-1.5" role="status">
            <span className="text-faint/50">·</span>
            <AlertTriangle size={11} strokeWidth={2} className="shrink-0 text-danger" />
            <span className="truncate font-mono text-[10.5px] leading-none text-danger">
              保存失败：{saveError}
            </span>
          </span>
        ) : (
          saving && (
            <span className="flex items-center gap-2.5" role="status">
              <span className="text-faint/50">·</span>
              <span className="font-mono text-[10.5px] leading-none text-muted">保存中…</span>
            </span>
          )
        )}
      </motion.div>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="删除"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint
                     transition-colors duration-[140ms] hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={13.5} strokeWidth={1.8} />
        </button>
      )}
    </footer>
  );
}
