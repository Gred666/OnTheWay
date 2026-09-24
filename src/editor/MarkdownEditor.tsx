import type { OutlineItem } from "@/data/types";
import { MOD_KEY } from "@/lib/platform";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search } from "@codemirror/search";
import {
  Annotation,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  type WidgetType,
  keymap,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { useEffect, useRef } from "react";
import { type CalloutHead, parseCalloutHead } from "./callout";
import { codeHighlight } from "./codeHighlight";
import { type DebouncedSaver, createDebouncedSaver } from "./debouncedSave";
import { DiagramWidget } from "./diagram";
import { emojiFor } from "./emoji";
import { decodeEntity } from "./entities";
import { type FrontMatterRange, frontMatterRange } from "./frontMatter";
import {
  INLINE_HTML_TAGS,
  inlineStyleOf,
  parseTag,
  resolveImageSource,
  safeHref,
  safeImageSource,
} from "./html";
import { inlinePlainText } from "./inlineDom";
import {
  linkTargetAt,
  modKeyCursor,
  normalizeLabel,
  openExternal,
  splitWikiTarget,
  wikiTargetAt,
} from "./links";
import { markdownKeymap } from "./markdownKeymap";
import { markdownSupport } from "./markdownParser";
import { MathWidget } from "./math";
import {
  hiddenMarkerNodes,
  markdownSourceStyleRules,
  rulesByNode,
  selectionTouchesRange,
  widgetByNode,
} from "./markdownStyleRegistry";
import { parseDelimitedTable, parseMarkdownTable } from "./markdownTable";
import { registerEditorFlush } from "./saveBus";
import {
  CalloutBadgeWidget,
  CalloutFoldWidget,
  CodeFenceWidget,
  CodeInfoWidget,
  CommentWidget,
  FootnoteWidget,
  FrontMatterFenceWidget,
  GlyphWidget,
  HardBreakWidget,
  HtmlBlockWidget,
  type ImageSpec,
  ImageWidget,
  LineBreakWidget,
  ListMarkerWidget,
  TableWidget,
  TaskWidget,
  type TocEntry,
  TocWidget,
  horizontalRuleWidget,
} from "./widgets";

/**
 * Typora 式 Markdown 编辑器。
 *
 * 文档始终是 Markdown 源文；非当前语法范围只隐藏标记并施加排版样式，光标进入
 * 后标记在原位置重新出现，所以 `#`、`**`、链接等都能直接修改，不存在富文本
 * AST 与 Markdown 互转导致的输入跳行或内容漂移。
 */

/** 外部内容回填产生的事务，不该被当成用户输入去触发保存。 */
const externalSync = Annotation.define<boolean>();

/** 搜索面板的中文文案。@codemirror/search 的默认标签是英文的。 */
const searchPhrases = EditorState.phrases.of({
  "Go to line": "跳转到行",
  go: "跳转",
  Find: "查找",
  Replace: "替换",
  next: "下一个",
  previous: "上一个",
  all: "全部",
  "match case": "区分大小写",
  "by word": "全词匹配",
  regexp: "正则",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭",
  "current match": "当前匹配",
  "on line": "位于行",
});

export function MarkdownEditor({
  initialMarkdown,
  onSave,
  outlineItems,
  onOutlineHandle,
  onDocumentChange,
  onWikiLink,
  fill = true,
}: {
  initialMarkdown: string;
  onSave: (markdown: string) => Promise<void>;
  outlineItems: OutlineItem[];
  onOutlineHandle: (handle: EditorOutlineHandle | null) => void;
  /** 正文变化时回调，供目录树跟着当前输入实时更新。 */
  onDocumentChange?: (markdown: string) => void;
  /** Mod + 点击 `[[双链]]` 时回调：目标标题，以及 `[[标题#小节]]` 里的小节（没有就是 undefined）。 */
  onWikiLink?: (title: string, heading?: string) => void;
  /**
   * 是否撑出一块最小高度（360px）并在末尾留 72px 空白。
   * 编辑器是页面最后一块内容时要这样，短文档也有地方可以点进去继续写；
   * 后面还跟着别的内容（日历的当日安排）时关掉，否则正文和任务之间会空出
   * 一大截，看起来像两个不相干的区域。
   */
  fill?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saverRef = useRef<DebouncedSaver | null>(null);
  const onSaveRef = useRef(onSave);
  const onDocumentChangeRef = useRef(onDocumentChange);
  const onWikiLinkRef = useRef(onWikiLink);
  const initialMarkdownRef = useRef(initialMarkdown);
  /** 最近一次与外部（store）达成一致的正文，用来判断本地有没有未同步的编辑。 */
  const syncedMarkdownRef = useRef(initialMarkdown);
  const outlineItemsRef = useRef(outlineItems);
  outlineItemsRef.current = outlineItems;
  onSaveRef.current = onSave;
  onDocumentChangeRef.current = onDocumentChange;
  onWikiLinkRef.current = onWikiLink;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const saver = createDebouncedSaver((markdown) => onSaveRef.current(markdown), 400);
    const unregisterFlush = registerEditorFlush(saver.flush);
    saverRef.current = saver;

    // 目录树不需要逐帧精确。每次按键都往上抛正文的话，
    // 上层要对整篇文档重扫一遍标题，长文档下这笔开销比排版本身还大。
    let outlineTimer: ReturnType<typeof setTimeout> | null = null;
    const notifyDocumentChange = (markdown: string) => {
      if (outlineTimer) clearTimeout(outlineTimer);
      outlineTimer = setTimeout(() => {
        outlineTimer = null;
        onDocumentChangeRef.current?.(markdown);
      }, 250);
    };

    const state = EditorState.create({
      doc: initialMarkdownRef.current,
      extensions: [
        // 围栏代码按语言名懒加载对应的解析器，配合 codeHighlight 上色
        markdownSupport(languages),
        codeHighlight,
        history(),
        search({ top: true }),
        searchPhrases,
        keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
        typoraDecorations,
        modKeyCursor,
        linkClickHandler((title, heading) => onWikiLinkRef.current?.(title, heading)),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "Markdown 正文编辑器",
          // 中文正文在 WebView2 里会被拼写检查画满红波浪线，得关掉。
          spellcheck: "false",
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) {
            if (update.focusChanged && !update.view.hasFocus) void saver.flush();
            return;
          }
          const markdown = update.state.doc.toString();
          notifyDocumentChange(markdown);
          // 外部回填不是用户输入，不能反过来触发一次保存。
          if (update.transactions.some((transaction) => transaction.annotation(externalSync))) {
            syncedMarkdownRef.current = markdown;
            return;
          }
          saver.schedule(markdown);
          if (update.focusChanged && !update.view.hasFocus) void saver.flush();
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: (view) => {
              saver.schedule(view.state.doc.toString());
              void saver.flush();
              return true;
            },
          },
        ]),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    const listeners = new Set<(id: string) => void>();
    const notifyActive = () => {
      const line = view.state.doc.lineAt(view.state.selection.main.head).number;
      const active =
        [...outlineItemsRef.current].filter((item) => item.line <= line).at(-1) ??
        outlineItemsRef.current[0];
      if (active) for (const listener of listeners) listener(active.id);
    };
    const handle: EditorOutlineHandle = {
      scrollTo(id) {
        // 编辑器已经卸载（切换文档的那一帧上层还握着旧句柄）就当没这回事
        if (viewRef.current !== view) return false;
        const item = outlineItemsRef.current.find((entry) => entry.id === id);
        if (!item) return false;
        const line = view.state.doc.line(Math.min(item.line, view.state.doc.lines));
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 72 }),
        });
        view.focus();
        for (const listener of listeners) listener(id);
        return true;
      },
      subscribe(listener) {
        listeners.add(listener);
        notifyActive();
        return () => listeners.delete(listener);
      },
    };
    const selectionListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet) notifyActive();
    });
    view.dispatch({ effects: StateEffect.appendConfig.of(selectionListener) });
    onOutlineHandle(handle);
    host.dataset.editorReady = "true";

    return () => {
      unregisterFlush();
      if (outlineTimer) clearTimeout(outlineTimer);
      void saver.flush();
      saverRef.current = null;
      viewRef.current = null;
      onOutlineHandle(null);
      delete host.dataset.editorReady;
      view.destroy();
    };
  }, [onOutlineHandle]);

  // 外部正文变化时回填。
  //
  // 这是修 P0 的关键：日历某天的备注是异步加载的，编辑器往往先以空文档挂载，
  // 数据晚一步才到。以前 initialMarkdown 只在挂载时读一次，于是界面上是空的、
  // 用户一输入就把当天原有的备注整篇覆盖掉了。
  // 只有在本地没有未同步编辑时才回填，用户已经动过的内容永远优先。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (initialMarkdown === current) {
      syncedMarkdownRef.current = initialMarkdown;
      return;
    }
    if (current !== syncedMarkdownRef.current) return;
    syncedMarkdownRef.current = initialMarkdown;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: initialMarkdown },
      annotations: externalSync.of(true),
    });
  }, [initialMarkdown]);

  return (
    <div
      ref={hostRef}
      data-editor-stable-island
      className={fill ? "otw-editor mt-7 selectable" : "otw-editor is-compact mt-7 selectable"}
    />
  );
}

export interface EditorOutlineHandle {
  /** 滚到某个目录条目；编辑器已卸载或条目不存在时返回 false */
  scrollTo: (id: string) => boolean;
  subscribe: (listener: (id: string) => void) => () => void;
}

/* ============================================================
   链接点击：Mod + 左键打开外链 / 跳转双链。普通点击照常放光标。
   ============================================================ */

function linkClickHandler(onWikiLink: (title: string, heading?: string) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
      const target = (event.target as HTMLElement | null)?.closest?.(
        ".cm-otw-link, .cm-otw-wikilink",
      ) as HTMLElement | null;
      if (!target) return false;
      const position = view.posAtDOM(target);
      if (target.classList.contains("cm-otw-wikilink")) {
        const raw = wikiTargetAt(view.state, position);
        if (!raw) return false;
        event.preventDefault();
        const { title, heading } = splitWikiTarget(raw);
        onWikiLink(title, heading);
        return true;
      }
      // `<a href>` 的地址挂在装饰的 data-href 上，语法树里没有
      const url = target.dataset.href ?? linkTargetAt(view.state, position);
      if (!url) return false;
      event.preventDefault();
      void openExternal(url);
      return true;
    },
  });
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return selectionTouchesRange(state.selection.ranges, from, to);
}

type DecorationRange = { from: number; to: number; value: Decoration };

const toDecorationSet = (items: DecorationRange[]) =>
  Decoration.set(
    items.map(({ from, to, value }) => value.range(from, to)),
    true,
  );

/** 这些节点内部的文本是字面量，源码级规则不能进去改动显示。 */
const literalNodes = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "InlineMath",
  "MathBlock",
  "HTMLTag",
  "Comment",
  "URL",
  "Autolink",
]);

const FENCE_LINE_RE = /^\s{0,3}(?:`{3,}|~{3,})/;
const CLOSING_FENCE_RE = /^\s{0,3}(?:`{3,}|~{3,})\s*$/;
const SETEXT_UNDERLINE_RE = /^\s{0,3}(?:=+|-+)\s*$/;
const TOC_RE = /^\s*\[\[?toc\]?\]\s*$/i;
const FOOTNOTE_RE = /^\[\^([^\]\s]+)\]$/;
/** 行首的脚注定义：`[^id]:` 加后面的空白 */
const FOOTNOTE_DEF_RE = /^\[\^([^\]\s]+)\]:[ \t]*/;
const CALLOUT_LABEL_RE = /^\[!([^\]\n]+)\]$/;
const HEADING_RE = /^(?:ATX|Setext)Heading([1-6])$/;
/** 缩写定义：`*[HTML]: HyperText Markup Language` */
const ABBREVIATION_RE = /^\s{0,3}\*\[([^\]\n]+)\]:[ \t]+(\S.*?)\s*$/;
/** 定义列表里的定义行：`: 释义` */
const DEFINITION_RE = /^\s{0,3}:[ \t]+(?=\S)/;
/** 长得像块级语法开头的行，不能当定义列表的术语 */
const BLOCK_START_RE = /^\s{0,3}(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s|`{3,}|~{3,}|\||\$\$|<|\[\^)/;
/** 整行都是分隔符：分隔线、Setext 下划线 —— 智能标点不能碰 */
const RULE_LINE_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,}|={3,})\s*$/;
/** 智能标点：显示层替换，源码不动 */
const SMART_RE = /---|--|\.\.\.|\((?:c|r|tm)\)/gi;
const SMART_GLYPHS: Readonly<Record<string, string>> = {
  "---": "—",
  "--": "–",
  "...": "…",
  "(c)": "©",
  "(r)": "®",
  "(tm)": "™",
};
const BULLET_GLYPHS = ["•", "◦", "▪"];

/* ============================================================
   装饰分成两层，因为两层的成本量级完全不同。

   块级层（StateField）：折叠围栏行、Setext 下划线行、分隔线行、front matter
   的围栏行、[TOC] 行，以及把表格 / 图表 / 公式块 / HTML 块换成 widget ——
   这些会改变行结构，CodeMirror 要求必须来自 StateField（视口是在插件更新
   之前算出来的）。它遍历全文，但只下探可能藏着块级构造的容器，Paragraph 及
   其下所有行内节点整棵剪掉。

   行内层（ViewPlugin）：标记隐藏、加粗斜体、任务勾选框、列表符号、callout、
   脚注、双链、Emoji、行内 HTML、行内公式、缩写、智能标点等等。这些不改变
   行结构，因此只需要处理当前视口，成本与文档长度无关。

   拆分前是一个 StateField 对全文做深度遍历，每次按键、每次移动光标都要
   重来一遍，53KB 文档上单次 5.3ms；拆分后同一文档 0.57ms。
   ============================================================ */

/** 块级层的产物。 */
export interface TyporaBlockState {
  decorations: DecorationSet;
  atomic: DecorationSet;
  /** 整行被折叠掉的行首偏移；行内层据此跳过这些行。 */
  foldedLines: Set<number>;
  /**
   * 文档里定义过的引用标签（CommonMark 规范化后）。
   * 行内层据此区分 `[文字]` 到底是引用式链接还是普通的方括号文本。
   */
  referenceLabels: Set<string>;
  /** 文档开头的 YAML front matter；两层都要绕开它，不然 `title: x` 会被当成 H2。 */
  frontMatter: FrontMatterRange | null;
  /** `*[缩写]: 全称`；行内层给正文里的缩写加悬停提示。 */
  abbreviations: Map<string, string>;
  /** 缩写定义行的行首；正文里的缩写高亮要跳过它们自己。 */
  abbreviationLines: Set<number>;
  /** `[^id]: …` 的正文（纯文本，截断），给引用端的悬停预览。 */
  footnotes: Map<string, string>;
}

/** 块级构造只可能藏在这些容器里，浅层遍历仅下探它们。 */
const blockContainers = new Set([
  "Document",
  "BulletList",
  "OrderedList",
  "ListItem",
  "Blockquote",
]);

/** [TOC] 需要的标题清单。只在文档里真的有 [TOC] 时才算。 */
function collectHeadings(state: EditorState, frontMatter: FrontMatterRange | null): TocEntry[] {
  const entries: TocEntry[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      // front matter 里的 `title: x` 会被解析成 Setext 标题，不能进目录
      if (frontMatter && node.type.name !== "Document" && node.from < frontMatter.to) return false;
      const match = HEADING_RE.exec(node.type.name);
      if (!match) return blockContainers.has(node.type.name);
      const line = state.doc.lineAt(node.from);
      const text = inlinePlainText(
        line.text
          .replace(/^\s{0,3}#{1,6}\s+/, "")
          .replace(/\s+#+\s*$/, "")
          .trim(),
      );
      if (text) entries.push({ level: Number(match[1]), text, from: node.from });
      return false;
    },
  });
  return entries;
}

/** 围栏的语言名：info 串的第一个词，小写。 */
const fenceLanguage = (info: string) => info.split(/\s+/)[0]?.toLowerCase() ?? "";

function buildBlockDecorations(state: EditorState): TyporaBlockState {
  const ranges: DecorationRange[] = [];
  const foldedLines = new Set<number>();
  const referenceLabels = new Set<string>();
  const abbreviations = new Map<string, string>();
  const abbreviationLines = new Set<number>();
  const footnotes = new Map<string, string>();
  const frontMatter = frontMatterRange(state.doc);
  let headings: TocEntry[] | null = null;

  const foldLine = (from: number, to: number, widget?: WidgetType) => {
    if (to <= from) return;
    foldedLines.add(from);
    ranges.push({ from, to, value: Decoration.replace({ block: true, widget }) });
  };
  /** 整块折叠。范围一律撑到整行：块级替换不能只盖住半行。 */
  const foldRange = (from: number, to: number, widget?: WidgetType) => {
    if (to <= from) return;
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to);
    for (let number = first.number; number <= last.number; number += 1) {
      foldedLines.add(state.doc.line(number).from);
    }
    ranges.push({
      from: first.from,
      to: last.to,
      value: Decoration.replace({ block: true, widget }),
    });
  };
  const lineClass = (from: number, className: string) => {
    ranges.push({ from, to: from, value: Decoration.line({ class: className }) });
  };
  const lineClasses = (from: number, to: number, className: string) => {
    const first = state.doc.lineAt(from).number;
    const last = state.doc.lineAt(to).number;
    for (let number = first; number <= last; number += 1) {
      lineClass(state.doc.line(number).from, className);
    }
  };
  /** 一个段落 / 引用定义里的脚注定义行和缩写定义行。 */
  const scanDefinitionLines = (from: number, to: number) => {
    const first = state.doc.lineAt(from).number;
    const last = state.doc.lineAt(to).number;
    for (let number = first; number <= last; number += 1) {
      const line = state.doc.line(number);
      const footnote = FOOTNOTE_DEF_RE.exec(line.text);
      if (footnote) {
        const body = inlinePlainText(line.text.slice(footnote[0].length));
        footnotes.set(footnote[1]!, body.replace(/\s+/g, " ").trim().slice(0, 240));
        continue;
      }
      const abbreviation = ABBREVIATION_RE.exec(line.text);
      if (abbreviation) {
        abbreviations.set(abbreviation[1]!.trim(), abbreviation[2]!.trim());
        abbreviationLines.add(line.from);
        lineClass(line.from, "cm-otw-abbr-def");
      }
    }
  };

  if (frontMatter) {
    const open = state.doc.line(frontMatter.openLine);
    const close = state.doc.line(frontMatter.closeLine);
    // 从 from + 1 起算：新挂载的编辑器光标停在 0，那不算「点进了属性块」，
    // 否则每篇带 front matter 的笔记一打开就是一坨展开的 YAML。
    const active = selectionTouches(state, frontMatter.from + 1, frontMatter.to);
    for (let number = open.number + 1; number < close.number; number += 1) {
      lineClass(state.doc.line(number).from, "cm-otw-frontmatter");
    }
    if (active) {
      lineClass(open.from, "cm-otw-frontmatter cm-otw-frontmatter-fence-line");
      lineClass(close.from, "cm-otw-frontmatter cm-otw-frontmatter-fence-line");
    } else {
      const firstKey = state.doc.line(open.number + 1).from;
      foldLine(open.from, open.to, new FrontMatterFenceWidget("open", firstKey));
      foldLine(close.from, close.to, new FrontMatterFenceWidget("close", firstKey));
    }
  }

  syntaxTree(state).iterate({
    enter(node) {
      const { name } = node.type;
      // front matter 里的 `---` 会被解析成分隔线和 Setext 标题，整段绕开。
      if (frontMatter && name !== "Document" && node.from < frontMatter.to) return false;

      if (name === "FencedCode") {
        if (!selectionTouches(state, node.from, node.to)) {
          const open = state.doc.lineAt(node.from);
          const close = state.doc.lineAt(node.to);
          // 只有真的有代码内容时才折叠；空围栏折叠后就再也点不进去了。
          if (close.number - open.number >= 2) {
            const info = open.text.replace(FENCE_LINE_RE, "").trim();
            const language = fenceLanguage(info);
            const code = state.sliceDoc(open.to + 1, Math.max(open.to + 1, close.from - 1));
            const closed = CLOSING_FENCE_RE.test(close.text);
            // 图表和 CSV 不是「代码」：整块换成图 / 表，点一下才回到源码
            if (closed && language === "mermaid") {
              foldRange(node.from, node.to, new DiagramWidget(code));
              return false;
            }
            if (closed && (language === "csv" || language === "tsv")) {
              const table = parseDelimitedTable(code, language === "csv" ? "," : "\t");
              if (table) {
                foldRange(node.from, node.to, new TableWidget(table));
                return false;
              }
            }
            if (FENCE_LINE_RE.test(open.text)) {
              foldLine(open.from, open.to, new CodeFenceWidget("open", info, code));
            }
            if (closed) foldLine(close.from, close.to, new CodeFenceWidget("close", "", code));
          }
        }
        return false;
      }

      if (name === "MathBlock") {
        if (selectionTouches(state, node.from, node.to)) {
          lineClasses(node.from, node.to, "cm-otw-math-source");
        } else {
          const tex = state
            .sliceDoc(node.from, node.to)
            .replace(/^\$\$/, "")
            .replace(/\$\$$/, "")
            .trim();
          foldRange(node.from, node.to, new MathWidget(tex, true));
        }
        return false;
      }

      if (name === "HTMLBlock") {
        if (!selectionTouches(state, node.from, node.to)) {
          const source = state.sliceDoc(node.from, node.to);
          foldRange(node.from, node.to, new HtmlBlockWidget(source));
        }
        return false;
      }

      if (name === "CommentBlock") {
        if (!selectionTouches(state, node.from, node.to)) {
          foldRange(node.from, node.to, new CommentWidget(true, node.from));
        }
        return false;
      }

      if (name === "LinkReference") {
        const label = node.node.getChild("LinkLabel");
        if (label) referenceLabels.add(normalizeLabel(state.sliceDoc(label.from, label.to)));
        scanDefinitionLines(node.from, node.to);
        return false;
      }

      if (name === "Paragraph") {
        const line = state.doc.lineAt(node.from);
        if (line.to >= node.to && TOC_RE.test(line.text)) {
          if (selectionTouches(state, line.from, line.to)) {
            lineClass(line.from, "cm-otw-toc-source");
          } else {
            headings ??= collectHeadings(state, frontMatter);
            foldLine(line.from, line.to, new TocWidget(headings));
          }
          return false;
        }
        scanDefinitionLines(node.from, node.to);
        return false;
      }

      if (widgetByNode.get(name) === "table") {
        if (!selectionTouches(state, node.from, node.to)) {
          const table = parseMarkdownTable(state.sliceDoc(node.from, node.to));
          if (table) foldRange(node.from, node.to, new TableWidget(table));
        }
        return false;
      }

      if (widgetByNode.get(name) === "horizontal-rule") {
        const line = state.doc.lineAt(node.from);
        // 分隔线独占一行时整行替换，别让源码行留成一条空行。
        if (
          !selectionTouches(state, node.from, node.to) &&
          line.from === node.from &&
          line.to === node.to
        ) {
          foldLine(line.from, line.to, horizontalRuleWidget);
        }
        return false;
      }

      if (/^SetextHeading[12]$/.test(name)) {
        if (!selectionTouches(state, node.from, node.to)) {
          const underline = state.doc.lineAt(node.to);
          // 只藏掉 `===` 三个字符等于留下一条空行，得整行折叠。
          if (SETEXT_UNDERLINE_RE.test(underline.text)) foldLine(underline.from, underline.to);
        }
        return false;
      }

      if (name === "Blockquote") {
        // `> [!标签]-`：默认收起的 callout，正文整块折成一行「展开」
        const line = state.doc.lineAt(node.from);
        const head = parseCalloutHead(line.text);
        const last = state.doc.lineAt(node.to);
        if (
          head?.fold === "-" &&
          last.number > line.number &&
          !selectionTouches(state, node.from, node.to)
        ) {
          const bodyFrom = state.doc.line(line.number + 1).from;
          foldRange(
            bodyFrom,
            node.to,
            new CalloutFoldWidget(
              last.number - line.number,
              head.kind,
              line.from + head.foldOffset,
            ),
          );
          return false;
        }
        return true;
      }

      return blockContainers.has(name);
    },
  });

  const decorations = toDecorationSet(ranges);
  return {
    decorations,
    atomic: decorations,
    foldedLines,
    referenceLabels,
    frontMatter,
    abbreviations,
    abbreviationLines,
    footnotes,
  };
}

export const typoraBlockDecorations = StateField.define<TyporaBlockState>({
  create: buildBlockDecorations,
  update(value, transaction) {
    // 折叠与否取决于光标在不在块里，所以选区变化也要重算。
    // 文档没变时旧值里的位置依然有效，直接沿用。
    if (transaction.docChanged || transaction.selection) {
      return buildBlockDecorations(transaction.state);
    }
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.from(field, (value) => () => value.atomic),
  ],
});

export interface TyporaInlineState {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildInlineDecorations(view: EditorView): TyporaInlineState {
  const { state } = view;
  const block = state.field(typoraBlockDecorations, false);
  const foldedLines = block?.foldedLines;
  const referenceLabels = block?.referenceLabels;
  const frontMatter = block?.frontMatter ?? null;
  const abbreviations = block?.abbreviations;
  const abbreviationLines = block?.abbreviationLines;
  const footnotes = block?.footnotes;
  const ranges: DecorationRange[] = [];
  const atomicRanges: DecorationRange[] = [];
  const lineRanges = new Set<string>();
  const literalRanges: Array<[number, number]> = [];
  /** 表格源码：`==` 之类的源码规则可以进，智能标点和缩写不行（分隔行全是 `---`）。 */
  const tableRanges: Array<[number, number]> = [];
  /** callout 标签所在行的行首；遇到那一行的 `[!标签]` 时换成徽章。 */
  const calloutHeads = new Map<number, CalloutHead>();
  const seenCalloutTitles = new Set<number>();
  /** 已经和开标签配成对、藏掉了的闭标签。 */
  const pairedTags = new Set<number>();
  /** 当前正在处理的可见区间，用来夹住跨区间的行装饰。 */
  let windowFrom = 0;
  let windowTo = state.doc.length;

  if (frontMatter) literalRanges.push([frontMatter.from, frontMatter.to]);

  const addMark = (
    from: number,
    to: number,
    className: string,
    attributes?: Record<string, string>,
  ) => {
    if (from < to)
      ranges.push({ from, to, value: Decoration.mark({ class: className, attributes }) });
  };
  const addReplacement = (from: number, to: number, value: Decoration) => {
    const range = { from, to, value };
    ranges.push(range);
    atomicRanges.push(range);
  };
  const addSyntaxMarker = (from: number, to: number, visible: boolean) => {
    if (from >= to) return;
    if (!visible) {
      // Let CodeMirror own the source-to-DOM mapping while the inactive marker is folded.
      // When the range becomes active the real source characters return to normal flow,
      // matching Typora's focused-block editing behaviour.
      addReplacement(from, to, Decoration.replace({}));
      return;
    }
    ranges.push({ from, to, value: Decoration.mark({ class: "cm-otw-syntax-marker" }) });
  };
  const addLines = (from: number, to: number, className: string) => {
    // 引用块 / 代码块可能远远长过视口，只给看得见的那几行加类。
    const start = state.doc.lineAt(Math.max(from, windowFrom)).number;
    const end = state.doc.lineAt(Math.min(Math.max(from, to - 1), windowTo)).number;
    for (let number = start; number <= end; number += 1) {
      const line = state.doc.line(number);
      if (foldedLines?.has(line.from)) continue;
      const key = `${line.from}:${className}`;
      if (lineRanges.has(key)) continue;
      lineRanges.add(key);
      ranges.push({ from: line.from, to: line.from, value: Decoration.line({ class: className }) });
    }
  };
  const insideAny = (list: Array<[number, number]>, position: number) =>
    list.some(([from, to]) => position >= from && position < to);

  /** 列表符号的显示文本：有序列表按位置编号，无序按深度换符号。 */
  const listMarkerText = (mark: SyntaxNode, marker: string): string => {
    const item = mark.parent;
    const list = item?.parent;
    if (!item || !list) return marker;
    if (list.name === "OrderedList") {
      let index = 0;
      let start = 1;
      for (let child = list.firstChild; child; child = child.nextSibling) {
        if (child.name !== "ListItem") continue;
        if (index === 0) {
          const first = child.getChild("ListMark");
          start = first ? Number.parseInt(state.sliceDoc(first.from, first.to), 10) || 1 : 1;
        }
        if (child.from === item.from) break;
        index += 1;
      }
      return `${start + index}${marker.endsWith(")") ? ")" : "."}`;
    }
    let depth = 0;
    for (let ancestor = list.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.name === "BulletList" || ancestor.name === "OrderedList") depth += 1;
    }
    return BULLET_GLYPHS[depth % BULLET_GLYPHS.length]!;
  };

  /**
   * 行内 HTML：`<b>`、`<mark>`、`<span style>` 这些白名单标签配对后映射成样式类，
   * 标签本身像 `**` 一样藏起来。找闭标签只在同一个父节点的兄弟里找 —— 跨段落
   * 的标签永远配不上对。
   */
  const decorateHtmlTag = (node: SyntaxNode, selfActive: boolean): void => {
    const source = state.sliceDoc(node.from, node.to);
    const tag = parseTag(source);
    if (!tag) {
      addMark(node.from, node.to, "cm-otw-html");
      return;
    }
    if (tag.name === "br" && !tag.closing) {
      if (selfActive) addMark(node.from, node.to, "cm-otw-html");
      else
        addReplacement(
          node.from,
          node.to,
          Decoration.replace({ widget: new LineBreakWidget(node.from) }),
        );
      return;
    }
    if (tag.name === "img" && !tag.closing) {
      const source = safeImageSource(tag.attrs.src);
      if (source && !selfActive) {
        const spec: ImageSpec = {
          alt: tag.attrs.alt ?? "",
          source,
          title: tag.attrs.title ?? "",
          width: Number(tag.attrs.width) || null,
          height: Number(tag.attrs.height) || null,
        };
        addReplacement(node.from, node.to, Decoration.replace({ widget: new ImageWidget(spec) }));
      } else {
        addMark(node.from, node.to, "cm-otw-html");
      }
      return;
    }
    const className = INLINE_HTML_TAGS[tag.name];
    if (!className || tag.closing || tag.selfClosing) {
      addMark(node.from, node.to, "cm-otw-html");
      return;
    }
    // 往后找同名闭标签；中间再遇到同名开标签就要多配一个
    let depth = 0;
    let close: SyntaxNode | null = null;
    for (let sibling = node.nextSibling; sibling; sibling = sibling.nextSibling) {
      if (sibling.name !== "HTMLTag") continue;
      const other = parseTag(state.sliceDoc(sibling.from, sibling.to));
      if (!other || other.name !== tag.name || other.selfClosing) continue;
      if (!other.closing) {
        depth += 1;
        continue;
      }
      if (depth === 0) {
        close = sibling;
        break;
      }
      depth -= 1;
    }
    if (!close) {
      addMark(node.from, node.to, "cm-otw-html");
      return;
    }
    pairedTags.add(close.from);
    const attributes: Record<string, string> = {};
    const style = inlineStyleOf(tag);
    if (style) attributes.style = style;
    if (tag.name === "a") {
      const href = safeHref(tag.attrs.href);
      if (href) {
        attributes["data-href"] = href;
        attributes.title = `${href}\n${MOD_KEY}+点击打开`;
      }
    }
    if (tag.name === "abbr" && tag.attrs.title) attributes.title = tag.attrs.title;
    addMark(node.to, close.from, className, attributes);
    const visible = selectionTouches(state, node.from, close.to);
    addSyntaxMarker(node.from, node.to, visible);
    addSyntaxMarker(close.from, close.to, visible);
  };

  /** 段落里的定义列表（`术语` 下一行 `: 释义`）和脚注定义行。 */
  const decorateParagraphLines = (node: SyntaxNode): void => {
    const first = state.doc.lineAt(Math.max(node.from, windowFrom)).number;
    const last = state.doc.lineAt(Math.min(node.to, windowTo)).number;
    for (let number = first; number <= last; number += 1) {
      const line = state.doc.line(number);
      if (foldedLines?.has(line.from)) continue;

      const footnote = FOOTNOTE_DEF_RE.exec(line.text);
      if (footnote) {
        addLines(line.from, line.to, "cm-otw-footnote-def");
        const labelTo = line.from + footnote[1]!.length + 3;
        if (selectionTouches(state, line.from, labelTo + 1)) {
          addMark(line.from, labelTo + 1, "cm-otw-footnote-source");
        } else {
          addReplacement(
            line.from,
            line.from + footnote[0].length,
            Decoration.replace({ widget: new FootnoteWidget(footnote[1]!, "def", line.from + 2) }),
          );
        }
        continue;
      }

      const definition = DEFINITION_RE.exec(line.text);
      if (!definition || number === 1) continue;
      // 上一行是术语（中间隔一个空行也算，Markdown Extra 允许）；
      // 连续几行 `: ` 共用同一个术语，所以上一行本身是释义时不再标术语。
      let term = state.doc.line(number - 1);
      if (!term.text.trim() && number >= 3) term = state.doc.line(number - 2);
      const termInParagraph = term.from >= node.from;
      if (!term.text.trim() || (!termInParagraph && BLOCK_START_RE.test(term.text))) continue;
      if (!DEFINITION_RE.test(term.text) && !foldedLines?.has(term.from)) {
        addLines(term.from, term.to, "cm-otw-dt");
      }
      addLines(line.from, line.to, "cm-otw-dd");
      const markerTo = line.from + definition[0].length;
      addSyntaxMarker(line.from, markerTo, selectionTouches(state, line.from, line.to));
    }
  };

  for (const visible of view.visibleRanges) {
    windowFrom = visible.from;
    windowTo = visible.to;
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const { name } = node.type;
        if (frontMatter && name !== "Document" && node.from < frontMatter.to) return false;
        const line = state.doc.lineAt(node.from);
        // 所在行已被块级层整行折叠：行内标记、语言名等都不用再渲染。
        if (foldedLines?.has(line.from) && node.to <= line.to) return false;

        const owner = node.node.parent;
        const parentName = owner?.name;
        const syntaxActive = selectionTouches(
          state,
          owner?.from ?? node.from,
          owner?.to ?? node.to,
        );
        /** 节点自身是否被光标碰到。行内小构造（Emoji、转义、图片）只看自己。 */
        const selfActive = selectionTouches(state, node.from, node.to);

        if (literalNodes.has(name)) literalRanges.push([node.from, node.to]);
        if (name === "Table") tableRanges.push([node.from, node.to]);
        // 围栏里挂着的是别的语言的语法树，交给 codeHighlight，这里不下探。
        if (name === "CodeText") {
          addMark(node.from, node.to, "cm-otw-code-text");
          return false;
        }

        const heading = HEADING_RE.exec(name);
        if (heading) {
          ranges.push({
            from: line.from,
            to: line.from,
            value: Decoration.line({ class: `cm-otw-h${heading[1]}` }),
          });
        }

        if (name === "Paragraph") {
          decorateParagraphLines(node.node);
          return;
        }

        /* ---------- 引用块：普通引用按层级缩进；`> [!标签]` 起头的是 callout ---------- */
        if (name === "Blockquote") {
          const head = parseCalloutHead(line.text);
          if (head) {
            calloutHeads.set(line.from, head);
            addLines(node.from, node.to, `cm-otw-callout is-${head.kind}`);
            addLines(line.from, line.to, "cm-otw-callout-head");
            const tail = state.doc.lineAt(node.to);
            addLines(tail.from, tail.to, "cm-otw-callout-tail");
            // 正文被折叠时头行就是最后一行可见的行，圆角要落在它身上
            if (
              tail.number > line.number &&
              foldedLines?.has(state.doc.line(line.number + 1).from)
            ) {
              addLines(line.from, line.to, "cm-otw-callout-tail");
            }
            // 正文折叠会把可见区间切成两段，这个引用块可能被进入两次；标题只标一次
            // （行装饰有 lineRanges 去重，行内 mark 没有）
            if (head.title && !seenCalloutTitles.has(line.from)) {
              seenCalloutTitles.add(line.from);
              const titleFrom =
                line.to - head.title.length - (line.text.length - line.text.trimEnd().length);
              addMark(titleFrom, titleFrom + head.title.length, "cm-otw-callout-title");
            }
            return;
          }
          let depth = 1;
          for (let ancestor = owner; ancestor; ancestor = ancestor.parent) {
            if (ancestor.name === "Blockquote") depth += 1;
          }
          addLines(node.from, node.to, `cm-otw-quote cm-otw-quote-d${Math.min(depth, 4)}`);
          return;
        }

        const widget = widgetByNode.get(name);
        if (widget === "task" && !syntaxActive) {
          const checked = /x/i.test(state.sliceDoc(node.from, node.to));
          addReplacement(
            node.from,
            node.to,
            Decoration.replace({ widget: new TaskWidget(checked, node.from, node.to) }),
          );
          return;
        }
        if (widget === "image" && !selfActive) {
          const image = resolveImage(state.doc.toString(), state.sliceDoc(node.from, node.to));
          if (image) {
            addReplacement(
              node.from,
              node.to,
              Decoration.replace({ widget: new ImageWidget(image) }),
            );
            return false;
          }
        }
        if (widget === "emoji") {
          const source = state.sliceDoc(node.from, node.to);
          const glyph = emojiFor(source);
          if (glyph && !selfActive) {
            addReplacement(
              node.from,
              node.to,
              Decoration.replace({
                widget: new GlyphWidget("emoji", glyph, source, node.from + 1),
              }),
            );
          } else {
            addMark(node.from, node.to, glyph ? "cm-otw-glyph-source" : "cm-otw-emoji-unknown");
          }
          return false;
        }
        if (widget === "entity") {
          const source = state.sliceDoc(node.from, node.to);
          const glyph = decodeEntity(source);
          if (glyph && !selfActive) {
            addReplacement(
              node.from,
              node.to,
              Decoration.replace({
                widget: new GlyphWidget("entity", glyph, source, node.from + 1),
              }),
            );
          } else {
            addMark(node.from, node.to, "cm-otw-html");
          }
          return false;
        }
        if (widget === "hard-break") {
          // 节点末尾是换行符本身，替换范围必须停在它前面，否则两行会被拼成一行。
          const markerTo = node.to - 1;
          if (markerTo > node.from) {
            if (selectionTouches(state, node.from, markerTo)) {
              addMark(node.from, markerTo, "cm-otw-syntax-marker");
            } else {
              addReplacement(
                node.from,
                markerTo,
                Decoration.replace({ widget: new HardBreakWidget(node.from) }),
              );
            }
          }
          return false;
        }
        if (widget === "math") {
          const source = state.sliceDoc(node.from, node.to);
          if (selfActive) {
            addMark(node.from, node.to, "cm-otw-math-source");
            return;
          }
          const display = source.startsWith("$$");
          const tex = source.slice(display ? 2 : 1, display ? -2 : -1).trim();
          addReplacement(
            node.from,
            node.to,
            Decoration.replace({
              widget: new MathWidget(tex, false),
            }),
          );
          return false;
        }
        if (name === "MathMark") {
          addMark(node.from, node.to, "cm-otw-syntax-marker");
          return false;
        }
        if (widget === "html-tag") {
          if (pairedTags.has(node.from)) return false;
          decorateHtmlTag(node.node, selfActive);
          return false;
        }
        if (widget === "comment") {
          // 光标在这一行时露出源码，否则收成一个「注释」标记
          if (selectionTouches(state, line.from, state.doc.lineAt(node.to).to)) {
            addMark(node.from, node.to, "cm-otw-html");
          } else {
            addReplacement(
              node.from,
              node.to,
              Decoration.replace({ widget: new CommentWidget(false, node.from) }),
            );
          }
          return false;
        }
        if (name === "Escape") {
          // 只藏反斜杠，被转义的那个字符照常显示。
          addSyntaxMarker(node.from, node.from + 1, selfActive);
          return false;
        }
        // 表格和分隔线整行都归块级层管，这里不重复处理。

        if (name === "ListMark") {
          const marker = state.sliceDoc(node.from, node.to);
          // 任务项：连同「- 」后面的空格一起藏掉，否则勾选框前面会多出一格缩进。
          const taskGap = /^(\s+)\[[ xX]\]/.exec(
            state.sliceDoc(node.to, Math.min(line.to, node.to + 5)),
          );
          if (!syntaxActive) {
            addReplacement(
              node.from,
              taskGap ? node.to + taskGap[1]!.length : node.to,
              Decoration.replace({
                widget: taskGap
                  ? undefined
                  : new ListMarkerWidget(listMarkerText(node.node, marker), node.from),
              }),
            );
          } else {
            addMark(node.from, node.to, "cm-otw-syntax-marker");
          }
          return;
        }

        if (name === "CodeInfo" && !syntaxActive) {
          addReplacement(
            node.from,
            node.to,
            Decoration.replace({
              widget: new CodeInfoWidget(state.sliceDoc(node.from, node.to), node.from),
            }),
          );
          return;
        }

        /* ---------- 方括号家族：callout 标签、脚注、双链，以及真正的引用链接 ---------- */
        if (name === "Link") {
          const text = state.sliceDoc(node.from, node.to);
          const shortcut = !node.node.getChild("URL") && !node.node.getChild("LinkLabel");
          if (shortcut) {
            const head = calloutHeads.get(line.from);
            const calloutLabel = head && CALLOUT_LABEL_RE.exec(text);
            if (head && calloutLabel) {
              const headActive = selectionTouches(state, line.from, line.to);
              const foldPosition = head.fold ? line.from + head.foldOffset : null;
              if (headActive) {
                addMark(node.from, node.to, "cm-otw-callout-label");
                addSyntaxMarker(node.from, node.from + 2, true);
                addSyntaxMarker(node.to - 1, node.to + (head.fold ? 1 : 0), true);
              } else {
                addReplacement(
                  node.from,
                  node.to + (head.fold ? 1 : 0),
                  Decoration.replace({
                    widget: new CalloutBadgeWidget(head, node.from + 2, foldPosition),
                  }),
                );
              }
              return false;
            }

            const footnote = FOOTNOTE_RE.exec(text);
            if (footnote) {
              // 行首的 `[^id]:` 是定义，段落那边已经处理过了
              if (node.from === line.from && state.sliceDoc(node.to, node.to + 1) === ":") {
                return false;
              }
              if (selfActive) {
                addMark(node.from, node.to, "cm-otw-footnote-source");
              } else {
                addReplacement(
                  node.from,
                  node.to,
                  Decoration.replace({
                    widget: new FootnoteWidget(
                      footnote[1]!,
                      "ref",
                      node.from + 2,
                      footnotes?.get(footnote[1]!) ?? "",
                    ),
                  }),
                );
              }
              return false;
            }

            const wiki =
              state.sliceDoc(node.from - 1, node.from) === "[" &&
              state.sliceDoc(node.to, node.to + 1) === "]";
            if (wiki) {
              const outerFrom = node.from - 1;
              const outerTo = node.to + 1;
              const inner = text.slice(1, -1);
              const pipe = inner.indexOf("|");
              const target = splitWikiTarget((pipe >= 0 ? inner.slice(0, pipe) : inner).trim());
              // `[[目标|别名]]`：不激活时只显示别名
              const displayFrom = pipe >= 0 ? node.from + 1 + pipe + 1 : node.from + 1;
              const active = selectionTouches(state, outerFrom, outerTo);
              addSyntaxMarker(outerFrom, displayFrom, active);
              addSyntaxMarker(node.to - 1, outerTo, active);
              const where = target.heading
                ? `${target.title} › ${target.heading}`
                : target.block
                  ? `${target.title} › ^${target.block}`
                  : target.title;
              addMark(displayFrom, node.to - 1, "cm-otw-wikilink", {
                title: `${where}\n${MOD_KEY}+点击打开`,
              });
              return false;
            }

            // 普通的 `[文字]`：文档里有对应的 `[文字]: 地址` 才是链接，否则就是方括号文本。
            if (!referenceLabels?.has(normalizeLabel(text))) return false;
          }

          const url = linkTargetAt(state, node.from);
          addMark(
            node.from,
            node.to,
            "cm-otw-link",
            url ? { title: `${url}\n${MOD_KEY}+点击打开` } : undefined,
          );
          return;
        }

        if (name === "LinkReference") {
          // 脚注定义（`[^id]: 一个词`）会被解析成引用定义；走和段落一样的行处理
          decorateParagraphLines(node.node);
          const label = node.node.getChild("LinkLabel");
          if (label && FOOTNOTE_RE.test(state.sliceDoc(label.from, label.to))) return false;
        }

        const rule = rulesByNode.get(name);
        if (rule?.kind === "mark") addMark(node.from, node.to, rule.className);
        else if (rule?.kind === "line") addLines(node.from, node.to, rule.className);

        const inLink = parentName === "Link" || parentName === "Image";
        const hiddenLinkDestination = name === "URL" && inLink;
        const hiddenReferenceLabel = name === "LinkLabel" && inLink;
        // 标题跟在地址后面（`[文字](地址 "标题")`），和地址一起藏；单独出现时照藏。
        const hiddenLinkTitle =
          name === "LinkTitle" && inLink && node.node.prevSibling?.name !== "URL";
        if (
          (hiddenMarkerNodes.has(name) ||
            hiddenLinkDestination ||
            hiddenReferenceLabel ||
            hiddenLinkTitle) &&
          node.from < node.to
        ) {
          let markerTo = node.to;
          if (
            (name === "HeaderMark" || name === "QuoteMark") &&
            state.sliceDoc(node.to, node.to + 1) === " "
          ) {
            markerTo = node.to + 1;
          }
          if (hiddenLinkDestination && node.node.nextSibling?.name === "LinkTitle") {
            markerTo = node.node.nextSibling.to;
          }
          addSyntaxMarker(node.from, markerTo, syntaxActive);
        }
      },
    });
  }

  // 源码级规则放在语法树之后：需要先知道哪些区间是代码字面量。
  const insideLiteral = (position: number) => insideAny(literalRanges, position);
  const insideTable = (position: number) => insideAny(tableRanges, position);
  for (const visible of view.visibleRanges) {
    const source = state.sliceDoc(visible.from, visible.to);
    for (const rule of markdownSourceStyleRules) {
      const symmetric = rule.open === rule.close;
      let cursor = 0;
      while (cursor < source.length) {
        const open = source.indexOf(rule.open, cursor);
        if (open < 0) break;
        const contentFrom = open + rule.open.length;
        const docOpen = visible.from + open;
        // 开标记落在代码字面量里，或者整行都是 `=`（Setext 的下划线）：它根本不是
        // 标记，只跳过它自己。以前会把它和后面某个真标记配成一对、再把那个真标记
        // 吃掉，一条 `===` 下划线就让整屏之后的 ==高亮== 全部错位。
        if (insideLiteral(docOpen) || RULE_LINE_RE.test(state.doc.lineAt(docOpen).text)) {
          cursor = contentFrom;
          continue;
        }
        const close = source.indexOf(rule.close, contentFrom);
        if (close < 0) break;
        const content = source.slice(contentFrom, close);
        const docClose = visible.from + close;
        // 配不上对的开标记（内容为空 / 首尾是空白 / 闭标记在字面量里 / 中间隔了
        // 空行跨到别的段落）：从它后面重新找，别把闭标记也一起跳过。
        // `a == b == c` 这种普通文字就是靠「首尾不能是空白」挡下来的。
        if (
          (symmetric && (!content || /^\s|\s$/.test(content))) ||
          insideLiteral(docClose) ||
          /\n[ \t]*\n/.test(content)
        ) {
          cursor = contentFrom;
          continue;
        }
        cursor = close + rule.close.length;
        const docContent = visible.from + contentFrom;
        const docEnd = visible.from + cursor;
        addMark(docContent, docClose, rule.className);
        const markersVisible = selectionTouches(state, docOpen, docEnd);
        addSyntaxMarker(docOpen, docContent, markersVisible);
        addSyntaxMarker(docClose, docEnd, markersVisible);
      }
    }

    /* ---------- 智能标点：`--` `---` `...` (c) (r) (tm) 只在显示层替换 ---------- */
    for (const match of source.matchAll(SMART_RE)) {
      const from = visible.from + match.index;
      const to = from + match[0].length;
      const line = state.doc.lineAt(from);
      if (foldedLines?.has(line.from)) continue;
      if (insideLiteral(from) || insideTable(from) || RULE_LINE_RE.test(line.text)) continue;
      // `- --x` 这类列表符号、`--- ` 开头的 YAML 之类都不该动：只替换夹在文字里的
      if (selectionTouches(state, from, to)) continue;
      const glyph = SMART_GLYPHS[match[0].toLowerCase()]!;
      addReplacement(
        from,
        to,
        Decoration.replace({ widget: new GlyphWidget("smart", glyph, match[0], from) }),
      );
    }

    /* ---------- 缩写：正文里出现 `*[缩写]: 全称` 定义过的词，加悬停提示 ---------- */
    if (abbreviations?.size) {
      for (const [abbreviation, expansion] of abbreviations) {
        const pattern = new RegExp(
          `(?<![\\p{L}\\p{N}_])${escapeRegExp(abbreviation)}(?![\\p{L}\\p{N}_])`,
          "gu",
        );
        for (const match of source.matchAll(pattern)) {
          const from = visible.from + match.index;
          const line = state.doc.lineAt(from);
          if (abbreviationLines?.has(line.from) || foldedLines?.has(line.from)) continue;
          if (insideLiteral(from) || insideTable(from)) continue;
          addMark(from, from + abbreviation.length, "cm-otw-abbr", { title: expansion });
        }
      }
    }
  }

  return { decorations: toDecorationSet(ranges), atomic: toDecorationSet(atomicRanges) };
}

const typoraInlineDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(view: EditorView) {
      const built = buildInlineDecorations(view);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
    }

    update(update: ViewUpdate) {
      // 视口滚动同样要重算 —— 行内装饰只覆盖看得见的那一段。
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        const built = buildInlineDecorations(update.view);
        this.decorations = built.decorations;
        this.atomic = built.atomic;
      }
    }
  },
  {
    decorations: (value) => value.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

/** 编辑器要的完整装饰扩展：块级 StateField + 行内 ViewPlugin。 */
export const typoraDecorations: Extension = [typoraBlockDecorations, typoraInlineDecorations];

/**
 * `![alt](src "title")` / `![alt][ref]`，alt 里的 `|300` / `|300x200` 是 Obsidian 式尺寸。
 */
export function resolveImage(markdown: string, source: string): ImageSpec | null {
  const inline = /^!\[([^\]]*)\]\((\S+?)(?:\s+["'](.*)["'])?\)$/.exec(source);
  if (inline) return withSize(inline[1]!, inline[2]!, inline[3] ?? "");

  const reference = /^!\[([^\]]*)\]\[([^\]]*)\]$/.exec(source);
  if (!reference) return null;
  const label = (reference[2] || reference[1]!).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const definition = new RegExp(
    `^\\[${label}\\]:\\s*(?:<([^>]+)>|(\\S+))(?:\\s+["'(](.*?)["')])?`,
    "im",
  ).exec(markdown);
  const url = definition?.[1] ?? definition?.[2];
  return url ? withSize(reference[1]!, url, definition?.[3] ?? "") : null;
}

function withSize(rawAlt: string, source: string, title: string): ImageSpec {
  const size = /^(.*?)\|(\d+)(?:x(\d+))?$/.exec(rawAlt);
  return {
    alt: (size ? size[1]! : rawAlt).trim(),
    source: resolveImageSource(source),
    title,
    width: size ? Number(size[2]) : null,
    height: size?.[3] ? Number(size[3]) : null,
  };
}
