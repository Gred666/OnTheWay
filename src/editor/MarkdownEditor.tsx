import type { OutlineItem } from "@/data/types";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { type DebouncedSaver, createDebouncedSaver } from "./debouncedSave";
import { markdownKeymap } from "./markdownKeymap";
import {
  hiddenMarkerNodes,
  markdownSourceStyleRules,
  rulesByNode,
  selectionTouchesRange,
  widgetByNode,
} from "./markdownStyleRegistry";
import { type MarkdownTableModel, parseMarkdownTable } from "./markdownTable";
import { registerEditorFlush } from "./saveBus";

/**
 * Typora 式 Markdown 编辑器。
 *
 * 文档始终是 Markdown 源文；非当前语法范围只隐藏标记并施加排版样式，光标进入
 * 后标记在原位置重新出现，所以 `#`、`**`、链接等都能直接修改，不存在富文本
 * AST 与 Markdown 互转导致的输入跳行或内容漂移。
 */
export function MarkdownEditor({
  initialMarkdown,
  onSave,
  outlineItems,
  onOutlineHandle,
}: {
  initialMarkdown: string;
  onSave: (markdown: string) => Promise<void>;
  outlineItems: OutlineItem[];
  onOutlineHandle: (handle: EditorOutlineHandle | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const saverRef = useRef<DebouncedSaver | null>(null);
  const onSaveRef = useRef(onSave);
  const initialMarkdownRef = useRef(initialMarkdown);
  const outlineItemsRef = useRef(outlineItems);
  outlineItemsRef.current = outlineItems;
  onSaveRef.current = onSave;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const saver = createDebouncedSaver((markdown) => onSaveRef.current(markdown), 400);
    const unregisterFlush = registerEditorFlush(saver.flush);
    saverRef.current = saver;

    const state = EditorState.create({
      doc: initialMarkdownRef.current,
      extensions: [
        markdown({ base: markdownLanguage }),
        history(),
        keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
        typoraDecorations,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "Markdown 正文编辑器",
          spellcheck: "true",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) saver.schedule(update.state.doc.toString());
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
        const item = outlineItemsRef.current.find((entry) => entry.id === id);
        if (!item) return;
        const line = view.state.doc.line(Math.min(item.line, view.state.doc.lines));
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 72 }),
        });
        view.focus();
        for (const listener of listeners) listener(id);
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
      void saver.flush();
      saverRef.current = null;
      onOutlineHandle(null);
      delete host.dataset.editorReady;
      view.destroy();
    };
  }, [onOutlineHandle]);

  return <div ref={hostRef} data-editor-stable-island className="otw-editor mt-7 selectable" />;
}

export interface EditorOutlineHandle {
  scrollTo: (id: string) => void;
  subscribe: (listener: (id: string) => void) => () => void;
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return selectionTouchesRange(state.selection.ranges, from, to);
}

export interface TyporaDecorationState {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

type DecorationRange = { from: number; to: number; value: Decoration };

function buildDecorations(state: EditorState): TyporaDecorationState {
  const ranges: DecorationRange[] = [];
  const atomicRanges: DecorationRange[] = [];
  const lineRanges = new Set<string>();
  const addMark = (from: number, to: number, className: string) => {
    if (from < to) ranges.push({ from, to, value: Decoration.mark({ class: className }) });
  };
  const addReplacement = (from: number, to: number, value: Decoration) => {
    const range = { from, to, value };
    ranges.push(range);
    atomicRanges.push(range);
  };
  const addSyntaxMarker = (from: number, to: number, visible: boolean) => {
    if (!visible) {
      // Let CodeMirror own the source-to-DOM mapping while the inactive marker is folded.
      // When the range becomes active the real source characters return to normal flow,
      // matching Typora's focused-block editing behaviour.
      addReplacement(from, to, Decoration.replace({}));
      return;
    }
    ranges.push({
      from,
      to,
      value: Decoration.mark({ class: "cm-otw-syntax-marker" }),
    });
  };
  const addLines = (from: number, to: number, className: string) => {
    const start = state.doc.lineAt(from).number;
    const end = state.doc.lineAt(Math.max(from, to - 1)).number;
    for (let number = start; number <= end; number += 1) {
      const line = state.doc.line(number);
      const key = `${line.from}:${className}`;
      if (lineRanges.has(key)) continue;
      lineRanges.add(key);
      ranges.push({
        from: line.from,
        to: line.from,
        value: Decoration.line({ class: className }),
      });
    }
  };

  const source = state.doc.toString();
  for (const rule of markdownSourceStyleRules) {
    let cursor = 0;
    while (cursor < source.length) {
      const open = source.indexOf(rule.open, cursor);
      if (open < 0) break;
      const contentFrom = open + rule.open.length;
      const close = source.indexOf(rule.close, contentFrom);
      if (close < 0) break;
      addMark(contentFrom, close, rule.className);
      const visible = selectionTouches(state, open, close + rule.close.length);
      addSyntaxMarker(open, contentFrom, visible);
      addSyntaxMarker(close, close + rule.close.length, visible);
      cursor = close + rule.close.length;
    }
  }

  syntaxTree(state).iterate({
    enter(node) {
      const { name } = node.type;
      const line = state.doc.lineAt(node.from);
      const owner = node.node.parent;
      const syntaxActive = selectionTouches(state, owner?.from ?? node.from, owner?.to ?? node.to);

      if (/^(?:ATX|Setext)Heading[1-6]$/.test(name)) {
        const level = Number(name.at(-1));
        ranges.push({
          from: line.from,
          to: line.from,
          value: Decoration.line({ class: `cm-otw-h${level}` }),
        });
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
      if (widget === "horizontal-rule" && !selectionTouches(state, node.from, node.to)) {
        addReplacement(node.from, node.to, Decoration.replace({ widget: horizontalRuleWidget }));
        return false;
      }
      if (widget === "image" && !selectionTouches(state, node.from, node.to)) {
        const source = state.sliceDoc(node.from, node.to);
        const image = resolveImage(state.doc.toString(), source);
        if (image) {
          addReplacement(
            node.from,
            node.to,
            Decoration.replace({ widget: new ImageWidget(image.alt, image.source) }),
          );
          return false;
        }
      }
      if (widget === "table" && !selectionTouches(state, node.from, node.to)) {
        const table = parseMarkdownTable(state.sliceDoc(node.from, node.to));
        if (table) {
          addReplacement(
            node.from,
            node.to,
            Decoration.replace({ widget: new TableWidget(table, node.from), block: true }),
          );
          return false;
        }
      }

      if (name === "ListMark") {
        const marker = state.sliceDoc(node.from, node.to);
        const taskItem = /^\s+\[[ xX]\]/.test(
          state.sliceDoc(node.to, Math.min(line.to, node.to + 5)),
        );
        if (!syntaxActive) {
          addReplacement(
            node.from,
            node.to,
            Decoration.replace({
              widget: taskItem ? undefined : new ListMarkerWidget(marker, node.from),
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

      const rule = rulesByNode.get(name);
      if (rule?.kind === "mark") addMark(node.from, node.to, rule.className);
      else if (rule?.kind === "line") addLines(node.from, node.to, rule.className);

      const parentName = node.node.parent?.name;
      const hiddenLinkDestination =
        name === "URL" && (parentName === "Link" || parentName === "Image");
      const hiddenReferenceLabel =
        name === "LinkLabel" && (parentName === "Link" || parentName === "Image");
      if (
        (hiddenMarkerNodes.has(name) || hiddenLinkDestination || hiddenReferenceLabel) &&
        node.from < node.to
      ) {
        const markerTo =
          (name === "HeaderMark" || name === "QuoteMark") &&
          state.sliceDoc(node.to, node.to + 1) === " "
            ? node.to + 1
            : node.to;
        addSyntaxMarker(node.from, markerTo, syntaxActive);
      }
    },
  });

  const toSet = (items: DecorationRange[]) =>
    Decoration.set(
      items.map(({ from, to, value }) => value.range(from, to)),
      true,
    );
  return { decorations: toSet(ranges), atomic: toSet(atomicRanges) };
}

export const typoraDecorations = StateField.define<TyporaDecorationState>({
  create: buildDecorations,
  update(decorations, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return buildDecorations(transaction.state);
    }
    return {
      decorations: decorations.decorations.map(transaction.changes),
      atomic: decorations.atomic.map(transaction.changes),
    };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.from(field, (value) => () => value.atomic),
  ],
});

class TaskWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: TaskWidget) {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = `cm-otw-task${this.checked ? " is-checked" : ""}`;
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    box.textContent = this.checked ? "✓" : "";
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? "[ ]" : "[x]" },
      });
      view.focus();
    });
    return box;
  }
}

class ListMarkerWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly sourcePosition: number,
  ) {
    super();
  }

  eq(other: ListMarkerWidget) {
    return other.source === this.source && other.sourcePosition === this.sourcePosition;
  }

  toDOM(view: EditorView) {
    const marker = document.createElement("span");
    marker.className = "cm-otw-list-marker";
    marker.textContent = /^\d/.test(this.source) ? this.source : "•";
    marker.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.sourcePosition } });
      view.focus();
    });
    return marker;
  }
}

class CodeInfoWidget extends WidgetType {
  constructor(
    private readonly language: string,
    private readonly sourcePosition: number,
  ) {
    super();
  }

  eq(other: CodeInfoWidget) {
    return other.language === this.language && other.sourcePosition === this.sourcePosition;
  }

  toDOM(view: EditorView) {
    const label = document.createElement("span");
    label.className = "cm-otw-code-info";
    label.textContent = this.language;
    label.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.sourcePosition } });
      view.focus();
    });
    return label;
  }
}

class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-otw-hr";
    return rule;
  }
}

const horizontalRuleWidget = new HorizontalRuleWidget();

function resolveImage(markdown: string, source: string): { alt: string; source: string } | null {
  const inline = /^!\[([^\]]*)\]\((\S+?)(?:\s+["'].*["'])?\)$/.exec(source);
  if (inline) return { alt: inline[1]!, source: inline[2]! };

  const reference = /^!\[([^\]]*)\]\[([^\]]*)\]$/.exec(source);
  if (!reference) return null;
  const label = (reference[2] || reference[1]!).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const definition = new RegExp(`^\\[${label}\\]:\\s*(?:<([^>]+)>|(\\S+))`, "im").exec(markdown);
  const url = definition?.[1] ?? definition?.[2];
  return url ? { alt: reference[1]!, source: url } : null;
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly alt: string,
    private readonly source: string,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return other.alt === this.alt && other.source === this.source;
  }

  toDOM() {
    const image = document.createElement("img");
    image.className = "cm-otw-image";
    image.alt = this.alt;
    image.src = this.source;
    image.loading = "lazy";
    return image;
  }
}

class TableWidget extends WidgetType {
  constructor(
    private readonly table: MarkdownTableModel,
    private readonly sourcePosition: number,
  ) {
    super();
  }

  eq(other: TableWidget) {
    return (
      other.sourcePosition === this.sourcePosition &&
      JSON.stringify(other.table) === JSON.stringify(this.table)
    );
  }

  toDOM(view: EditorView) {
    const table = document.createElement("table");
    table.className = "cm-otw-table-widget";
    table.title = "点击编辑表格 Markdown";
    table.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.sourcePosition } });
      view.focus();
    });
    const head = table.createTHead().insertRow();
    this.table.header.forEach((value, index) => {
      const cell = document.createElement("th");
      cell.textContent = value;
      cell.style.textAlign = this.table.alignments[index] ?? "left";
      head.append(cell);
    });
    const body = table.createTBody();
    for (const row of this.table.rows) {
      const tr = body.insertRow();
      row.forEach((value, index) => {
        const cell = tr.insertCell();
        cell.textContent = value;
        cell.style.textAlign = this.table.alignments[index] ?? "left";
      });
    }
    return table;
  }
}
