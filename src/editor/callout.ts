/**
 * `> [!标签]` 形式的 callout。
 *
 * 标签既可以是 GitHub 那五种（NOTE / TIP / IMPORTANT / WARNING / CAUTION），
 * 也可以是任意中文短语（原型里的「核心判断」「当时的结论」）。
 * 前者按语义配色，后者一律走中性的主色边条。
 *
 * 也认 Obsidian 的两种变体：`[!标签]-` / `[!标签]+` 是可折叠的（减号默认收起），
 * `[!标签] 自定义标题` 在徽章后面跟一段标题文字。
 */
export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution" | "generic";

/** 引用块首行是否是 callout 标签行；捕获组 1 是 `>` 前缀，2 是标签，3 是折叠符，4 是标题。 */
export const CALLOUT_HEAD_RE = /^(\s*(?:>\s*)+)\[!([^\]\n]+)\]([+-]?)(?:[ \t]+(\S.*?))?[ \t]*$/;

export interface CalloutHead {
  /** 标签原文，如 `TIP` / `核心判断` */
  label: string;
  kind: CalloutKind;
  /** `-` 默认收起、`+` 默认展开、空串不可折叠 */
  fold: "-" | "+" | "";
  /** 徽章后面的自定义标题；没写就是空串 */
  title: string;
  /** `[!` 在行内的偏移 */
  labelOffset: number;
  /** `]` 之后的位置：折叠符（如果有）就在这里 */
  foldOffset: number;
}

export function parseCalloutHead(line: string): CalloutHead | null {
  const match = CALLOUT_HEAD_RE.exec(line);
  if (!match) return null;
  const label = match[2]!.trim();
  const labelOffset = match[1]!.length;
  return {
    label,
    kind: calloutKind(label),
    fold: (match[3] ?? "") as CalloutHead["fold"],
    title: match[4]?.trim() ?? "",
    labelOffset,
    foldOffset: labelOffset + 2 + match[2]!.length + 1,
  };
}

const KIND_BY_LABEL: Record<string, CalloutKind> = {
  note: "note",
  info: "note",
  笔记: "note",
  说明: "note",
  备注: "note",
  tip: "tip",
  hint: "tip",
  提示: "tip",
  技巧: "tip",
  建议: "tip",
  important: "important",
  重要: "important",
  关键: "important",
  warning: "warning",
  warn: "warning",
  注意: "warning",
  警告: "warning",
  caution: "caution",
  danger: "caution",
  error: "caution",
  危险: "caution",
  错误: "caution",
};

export function calloutKind(label: string): CalloutKind {
  return KIND_BY_LABEL[label.trim().toLowerCase()] ?? "generic";
}

/** 24×24 的 lucide 线稿，只取 path 数据，widget 里自己拼 SVG。 */
const ICON_PATHS: Record<CalloutKind, string> = {
  note: "M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  tip: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1.3.5 2.6 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4",
  important: "M7.9 20A9 9 0 1 0 4 16.1L2 22ZM12 8v4M12 16h.01",
  warning:
    "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01",
  caution:
    "M12 16h.01M12 8v4M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z",
  generic: "M4 20h16M4 12h16M4 4h10",
};

export function calloutIcon(kind: CalloutKind): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICON_PATHS[kind]);
  svg.append(path);
  return svg;
}
