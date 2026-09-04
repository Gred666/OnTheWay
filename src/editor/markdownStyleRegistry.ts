/** Markdown 语法树节点的展示声明。新增纯样式语法时只需在这里注册。 */
export interface MarkdownStyleRule {
  nodes: readonly string[];
  className: string;
  kind: "mark" | "line";
}

export const markdownStyleRules: readonly MarkdownStyleRule[] = [
  { nodes: ["StrongEmphasis"], className: "cm-otw-strong", kind: "mark" },
  { nodes: ["Emphasis"], className: "cm-otw-emphasis", kind: "mark" },
  { nodes: ["Strikethrough"], className: "cm-otw-strike", kind: "mark" },
  { nodes: ["InlineCode"], className: "cm-otw-code", kind: "mark" },
  { nodes: ["Link", "Autolink", "URL"], className: "cm-otw-link", kind: "mark" },
  { nodes: ["CodeText", "CodeInfo"], className: "cm-otw-code-text", kind: "mark" },
  { nodes: ["HTMLTag"], className: "cm-otw-html", kind: "mark" },
  { nodes: ["Escape"], className: "cm-otw-escape", kind: "mark" },
  { nodes: ["LinkReference"], className: "cm-otw-reference", kind: "mark" },
  { nodes: ["Blockquote"], className: "cm-otw-quote", kind: "line" },
  { nodes: ["FencedCode", "CodeBlock"], className: "cm-otw-code-block", kind: "line" },
  { nodes: ["Table", "TableHeader", "TableRow"], className: "cm-otw-table", kind: "line" },
  { nodes: ["ListItem"], className: "cm-otw-list-item", kind: "line" },
] as const;

export const hiddenMarkerNodes = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "QuoteMark",
  "LinkMark",
  "ImageMarker",
]);

export type MarkdownWidgetKind = "task" | "horizontal-rule" | "image" | "table";

/** 需要 DOM 表现的语法同样集中注册，核心只分派通用 widget 类型。 */
export const widgetByNode = new Map<string, MarkdownWidgetKind>([
  ["TaskMarker", "task"],
  ["HorizontalRule", "horizontal-rule"],
  ["Image", "image"],
  ["Table", "table"],
]);

export const rulesByNode = new Map(
  markdownStyleRules.flatMap((rule) => rule.nodes.map((node) => [node, rule] as const)),
);

export interface MarkdownSourceStyleRule {
  open: string;
  close: string;
  className: string;
}

/** 供 CommonMark AST 不会合并成单节点的自定义行内语法使用。 */
export const markdownSourceStyleRules: readonly MarkdownSourceStyleRule[] = [
  { open: "<u>", close: "</u>", className: "cm-otw-underline" },
] as const;

export interface SelectionRangeLike {
  from: number;
  to: number;
  head: number;
  empty: boolean;
}

export function selectionTouchesRange(
  ranges: readonly SelectionRangeLike[],
  from: number,
  to: number,
): boolean {
  return ranges.some((range) =>
    range.empty ? range.head >= from && range.head <= to : range.from < to && range.to > from,
  );
}
