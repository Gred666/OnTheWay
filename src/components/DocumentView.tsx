import { RAIL_WIDTH, useApp } from "@/app/store";
import { NEW_NOTE_TITLE, saveKeyOf, useData } from "@/data/store";
import type { DocumentModel, DocumentSaveTarget } from "@/data/types";
import type { EditorOutlineHandle } from "@/editor/MarkdownEditor";
import { cn } from "@/lib/cn";
import { buildOutline, renderMarkdown } from "@/lib/markdown";
import { spring, tween } from "@/lib/motion";
import { MOD_KEY } from "@/lib/platform";
import { AlertTriangle, Archive, FolderOpen, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DayTasks } from "./ActionItem";
import { Outline } from "./Outline";
import { OverlayScrollbar } from "./OverlayScrollbar";
import { Segmented } from "./Segmented";
import { SwapFade } from "./SwapFade";

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
  const outline = useMemo(() => buildOutline(outlineSource), [outlineSource]);

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
  // 只显示这一篇自己的保存失败（以及不属于某一篇的，比如关窗时那次）。
  // saveError 只有一格，别的文档后来又失败会把它覆盖；这一篇还有草稿没落盘的话照样提示。
  const saveError = useData((state) => {
    if (!doc.editor) return null;
    const key = saveKey(doc);
    const failure = state.saveError;
    if (failure && (failure.key === null || failure.key === key)) return failure.message;
    return state.drafts[key] ? `有修改还没存进去，继续编辑或按 ${MOD_KEY}+S 重试` : null;
  });

  // 切换文档时滚回顶部。用 instant 而不是 smooth ——
  // 换了一篇文档还看到旧位置平滑滚动，是错误的心智模型。
  // layout effect：新一篇的第一帧就得在顶上。放在 useEffect 里的话，不是点击触发的
  // 切换（比如命令面板）可能先按旧的滚动位置画出一帧，再跳回顶部。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只应在 doc.key 变化时触发
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
    setLiveMarkdown(null);
    outlineKeyRef.current = null;
  }, [doc.key]);

  const canEdit = !!doc.editor && !!onSaveDocument && editorEnabled;

  // 别的程序改了这篇的文件：编辑器据此分辨「正文变了」是外部改动还是自己的保存回来了
  const externalRevision = useData((state) =>
    doc.editor ? (state.externalRevisions[saveKey(doc)] ?? 0) : 0,
  );
  const target = doc.editor?.target;
  const handleExternalConflict = useCallback(() => {
    if (target) useData.getState().markConflict(target);
  }, [target]);
  const handleReveal = target ? () => void useData.getState().revealDocument(target) : undefined;

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
      {/* data-swap-host：切换文档时旧内容的快照放在这一层（见 SwapFade）——
          它不滚动、就是正文的可视区，快照按它裁切。 */}
      <div className="relative min-w-0 flex-1" data-swap-host>
        {/* 画布往左 chrome 底下多铺 RAIL_WIDTH：负外边距把盒子拉过去，等宽的
            内边距把内容留在原位，所以排版一点没变，只是底色和裁切边界往左
            延到了窗口边缘。退出专注模式时 chrome 滑回来的那段时间，正文能
            一直完整地显示在白底上、往右滑到新位置 —— 否则滚动容器（overflow-y
            一设，横向也必然裁切）会在 chrome 的右边缘把正在位移的正文切掉。
            平时这一截压在 z-30 的 chrome 底下，看不见也摸不着。 */}
        <div
          ref={scrollRef}
          // 查找面板（editor/searchPanel.ts）按它的右边缘贴边
          data-doc-scroller
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
            {/* 换文档时整块交叉淡化：旧的一份快照原地淡出，新的一份淡入（见 SwapFade）。
                标题、分隔线、正文、状态栏都在里面，一起换，不再各播各的入场动画。 */}
            <SwapFade swapKey={doc.key} exitLift={4} className="flex flex-1 flex-col">
              {/* ---------- 归档横幅 ----------
                  key 固定：在两篇归档笔记之间切换时横幅本身不动，文字跟着整块一起淡换。
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
                    <span className="text-[12px] text-danger">{doc.banner.text}</span>
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
                      <p
                        className="min-w-0 truncate text-[12px] font-medium leading-[20px]
                                   tracking-[0.02em] text-muted"
                      >
                        {doc.eyebrow}
                      </p>
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

                {/* 标题按文档 key 重挂（可编辑标题的本地状态跟着换篇重置），
                    但不再单独播入场：以前旧标题直接消失、新标题从下面 16px 弹上来，
                    中间空着一拍，正文却已经换好了。 */}
                {doc.editor?.titleEditable && onSaveTitle ? (
                  <EditableDocumentTitle
                    key={doc.key}
                    title={doc.title}
                    // 占位标题（无标题笔记）不是真标题：输入框里留空，让用户直接起名
                    placeholder={doc.title === NEW_NOTE_TITLE}
                    onSave={(title) => onSaveTitle(doc.editor!.target, title)}
                  />
                ) : (
                  <h1
                    key={doc.key}
                    className="selectable break-words text-[38px] font-bold leading-[1.25]
                               tracking-[-0.02em] text-ink"
                  >
                    {doc.title}
                  </h1>
                )}
              </header>

              {/* 标题下的细分隔线：宽度从 0 展开，是「文档打开了」的一个小信号。
                  只在进这个工作区时播一次；换篇时它留在原地，跟着整块一起淡换 */}
              <motion.div
                className="mt-6 h-px origin-left bg-line"
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
              />

              {/* ---------- 正文 ----------
                  编辑器稳定岛：这里以及编辑器自身都没有 Motion layout/transform
                  （SwapFade 只动 opacity）。Shell 那边的工作区进场也是纯 opacity，
                  所以编辑器可以在新一屏的第一帧就挂上，不需要先拿 DocumentPreview
                  顶一段。这一点很重要：预览和编辑器的排版并不一致（正文 15px vs
                  17px/1.82，h2 21px vs 29.75px），中途替换会让整篇重排一次，看着像卡顿。
                  数据还没到（没有 doc.editor）或 editorEnabled 强制只读时才是预览。 */}
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
                    fill={!doc.dayTasks?.length}
                    // 切走时缓存编辑器状态，切回来不用再解析全文
                    cacheKey={saveKey(doc)}
                    externalRevision={externalRevision}
                    onExternalConflict={handleExternalConflict}
                  />
                ) : (
                  <DocumentPreview markdown={doc.bodyMd} />
                )}

                {doc.dayTasks && doc.dayTasks.length > 0 && (
                  <DayTasks tasks={doc.dayTasks} onToggle={onToggleTask} />
                )}
              </div>

              {/* ---------- 底部状态栏 ---------- */}
              <StatusBar
                parts={doc.statusParts}
                onDelete={doc.deletable ? onDelete : undefined}
                onReveal={handleReveal}
                saving={saving}
                saveError={saveError}
              />
            </SwapFade>
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

/**
 * 标题按内容自动长高、超出一行就折行。WebView2（Chromium）认 `field-sizing: content`，
 * 文本框自己随内容长高；不认的内核拿 JS 量 scrollHeight，宽度变了（窗口缩放、
 * 进出专注模式）再量一次。
 */
const FIELD_SIZING = typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");

function useFitHeight(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  const fit = useCallback(() => {
    const field = ref.current;
    if (!field || FIELD_SIZING) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [ref]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 内容变了就要重新量
  useLayoutEffect(fit, [fit, value]);

  useEffect(() => {
    const field = ref.current;
    if (!field || FIELD_SIZING || typeof ResizeObserver === "undefined") return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      fit();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [ref, fit]);
}

/**
 * 可编辑的大标题。
 *
 * 是 textarea 不是 input：input 只有一行，标题一长就在框里横着往后滚，
 * 开头那半截被推出去看不见。textarea 按宽度折行、跟着内容长高；
 * 标题本身仍然是一行文字 —— 回车是「写完了」，粘贴进来的换行直接去掉。
 */
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
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useFitHeight(fieldRef, value);

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
    <textarea
      ref={fieldRef}
      rows={1}
      value={value}
      disabled={saving}
      aria-label="笔记标题"
      placeholder={placeholder ? title : undefined}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value.replace(/[\r\n]/g, ""))}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        // 输入法选字时的回车是在上屏，不是写完了
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setValue(shown);
          event.currentTarget.blur();
        }
      }}
      className={cn(
        "block w-full min-w-0 resize-none overflow-hidden border-0 bg-transparent p-0",
        "text-[38px] font-bold leading-[1.25] tracking-[-0.02em] text-ink outline-none",
        "transition-opacity duration-[160ms] [field-sizing:content] placeholder:text-faint",
        saving && "opacity-65",
      )}
    />
  );
}

function StatusBar({
  parts,
  onDelete,
  onReveal,
  saving,
  saveError,
}: {
  parts: string[];
  onDelete?: () => void;
  /** 在文件夹中显示这篇文档的文件（每篇都是仓库里的一个 .md） */
  onReveal?: () => void;
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

      {onReveal && (
        <button
          type="button"
          onClick={onReveal}
          aria-label="在文件夹中显示"
          title="在文件夹中显示"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint
                     transition-colors duration-[140ms] hover:bg-raised hover:text-ink"
        >
          <FolderOpen size={13.5} strokeWidth={1.8} />
        </button>
      )}

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
