import { isTauri } from "@/lib/tauri";
import { convertFileSrc } from "@tauri-apps/api/core";

/* ============================================================
   笔记里的 HTML。

   原则不变：永远不把用户写的字符串交给 innerHTML。行内标签只在装饰层
   映射成样式类（`<b>` 和 `**` 走同一个类），块级 HTML 先用 DOMParser 解析到
   一份惰性文档里，再按白名单一个节点一个节点地重建 —— 脚本、事件属性、
   javascript: 地址、外部样式表在重建时全部丢掉。
   ============================================================ */

/** 行内标签 → 装饰类。`<b>` 和 `**` 长得一样，不另起一套样式。 */
export const INLINE_HTML_TAGS: Readonly<Record<string, string>> = {
  b: "cm-otw-strong",
  strong: "cm-otw-strong",
  i: "cm-otw-emphasis",
  em: "cm-otw-emphasis",
  cite: "cm-otw-emphasis",
  var: "cm-otw-emphasis",
  s: "cm-otw-strike",
  del: "cm-otw-strike",
  strike: "cm-otw-strike",
  u: "cm-otw-underline",
  ins: "cm-otw-underline",
  mark: "cm-otw-highlight",
  sub: "cm-otw-sub",
  sup: "cm-otw-sup",
  kbd: "cm-otw-kbd",
  code: "cm-otw-code",
  samp: "cm-otw-code",
  small: "cm-otw-small",
  big: "cm-otw-big",
  span: "cm-otw-span",
  font: "cm-otw-span",
  a: "cm-otw-link",
  abbr: "cm-otw-abbr",
};

/** 单标签：没有闭合，行内直接换成替身。 */
export const VOID_HTML_TAGS = new Set(["br", "img", "hr", "wbr"]);

export interface ParsedTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Record<string, string>;
}

const TAG_RE =
  /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`]+))?)*)\s*(\/?)>$/;
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;

/** 解析一个标签字面量（`<span style="…">` / `</span>` / `<br/>`）。不是标签返回 null。 */
export function parseTag(source: string): ParsedTag | null {
  const match = TAG_RE.exec(source.trim());
  if (!match) return null;
  const attrs: Record<string, string> = {};
  for (const attr of (match[3] ?? "").matchAll(ATTR_RE)) {
    attrs[attr[1]!.toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? "";
  }
  return {
    name: match[2]!.toLowerCase(),
    closing: match[1] === "/",
    selfClosing: match[4] === "/",
    attrs,
  };
}

/* ---------------- 样式白名单 ---------------- */

const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%/]+\)|[a-z]+)$/i;
const LENGTH = /^\d+(?:\.\d+)?(?:px|em|rem|%|pt)$/i;

const STYLE_RULES: Readonly<Record<string, RegExp>> = {
  color: COLOR,
  "background-color": COLOR,
  background: COLOR,
  "font-size": LENGTH,
  "font-weight": /^(?:[1-9]00|bold|normal|bolder|lighter)$/i,
  "font-style": /^(?:italic|normal|oblique)$/i,
  "font-family": /^[\w\s,'"-]+$/,
  "text-decoration":
    /^(?:underline|line-through|overline|none)(?:\s+(?:underline|line-through|overline|wavy|dotted|dashed|solid|double))*$/i,
  "text-align": /^(?:left|center|right|justify)$/i,
  "vertical-align": /^(?:sub|super|baseline|middle|top|bottom)$/i,
};

/** `<font size>` 的 1–7 档对应的字号。 */
const FONT_SIZES = ["0.63em", "0.82em", "1em", "1.13em", "1.5em", "2em", "3em"];

/** 只放行颜色、字号、粗细这几样排版属性；`position` / `url()` 之类一律丢掉。 */
export function sanitizeStyle(style: string | undefined): string | null {
  if (!style) return null;
  const kept: string[] = [];
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    const rule = STYLE_RULES[property];
    if (rule?.test(value)) kept.push(`${property}: ${value}`);
  }
  return kept.length ? kept.join("; ") : null;
}

/** 一个行内标签自带的样式：`style=` 过滤后，再把 `<font color size>` 折算进去。 */
export function inlineStyleOf(tag: ParsedTag): string | null {
  const parts: string[] = [];
  const style = sanitizeStyle(tag.attrs.style);
  if (style) parts.push(style);
  if (tag.name === "font") {
    if (tag.attrs.color && COLOR.test(tag.attrs.color)) parts.push(`color: ${tag.attrs.color}`);
    const size = Number(tag.attrs.size);
    if (size >= 1 && size <= 7) parts.push(`font-size: ${FONT_SIZES[size - 1]}`);
  }
  return parts.length ? parts.join("; ") : null;
}

/* ---------------- 地址 ---------------- */

/** `<a href>` 只放行能用系统浏览器打开的那几种协议。 */
export function safeHref(url: string | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  return /^(?:https?:\/\/|mailto:|tel:)/i.test(trimmed) ? trimmed : null;
}

const LOCAL_PATH_RE = /^(?:[a-zA-Z]:[\\/]|\/(?!\/)|\\\\)/;

/**
 * 图片地址。桌面端把本机绝对路径（`C:\…`、`/…`、`file://…`）转成 asset 协议，
 * WebView 才读得到；网络地址和 data: 原样返回。相对路径没有基准目录可言，
 * 只能原样交给 <img>。
 */
export function resolveImageSource(source: string): string {
  const trimmed = source.trim();
  const fileUrl = /^file:\/\//i.test(trimmed);
  if (!fileUrl && !LOCAL_PATH_RE.test(trimmed)) return trimmed;
  if (!isTauri) return trimmed;
  const path = fileUrl ? decodeFilePath(trimmed.replace(/^file:\/\/\/?/i, "")) : trimmed;
  return convertFileSrc(path);
}

/**
 * `file://` 地址里的百分号转义。`100%.png` 这种没编码的 `%` 会让 decodeURI 抛
 * URIError —— 这里是在装饰层里调用的，一抛整个行内装饰插件就崩了，整篇笔记
 * 退回裸 Markdown。解不开就按字面路径用。
 */
function decodeFilePath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/** `<img src>` 只放行图片能来的地方；不合规的返回 null，替身会显示 alt。 */
export function safeImageSource(source: string | undefined): string | null {
  if (!source) return null;
  const trimmed = source.trim();
  if (/^(?:javascript|vbscript):/i.test(trimmed)) return null;
  if (/^data:/i.test(trimmed) && !/^data:image\//i.test(trimmed)) return null;
  return resolveImageSource(trimmed);
}

/* ---------------- 块级 HTML 的净化重建 ---------------- */

const BLOCK_TAGS = new Set([
  "div",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "blockquote",
  "pre",
  "details",
  "summary",
  "hr",
  "br",
  "img",
  "figure",
  "figcaption",
  "center",
  "section",
  "article",
  "aside",
  "nav",
  "header",
  "footer",
  "main",
  "address",
  "dl",
  "dt",
  "dd",
]);

/** 整棵子树都不要的：脚本、样式表、嵌入内容、表单。 */
const DROP_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "svg",
  "math",
  "template",
  "noscript",
  "video",
  "audio",
  "source",
  "track",
  "canvas",
  "dialog",
]);

const DIGITS = /^\d{1,4}$/;
const ALIGN = /^(?:left|center|right|justify)$/i;

/** 每种标签允许带的属性，以及怎么清洗它的值。 */
function sanitizeAttribute(tag: string, name: string, value: string): string | null {
  switch (name) {
    case "title":
      return value;
    case "style":
      return sanitizeStyle(value);
    case "align":
      return ALIGN.test(value) ? value.toLowerCase() : null;
    case "href":
      return tag === "a" ? safeHref(value) : null;
    case "src":
      return tag === "img" ? safeImageSource(value) : null;
    case "alt":
      return tag === "img" ? value : null;
    case "width":
    case "height":
      return (tag === "img" || tag === "td" || tag === "th" || tag === "table") &&
        DIGITS.test(value)
        ? value
        : null;
    case "colspan":
    case "rowspan":
      return (tag === "td" || tag === "th") && DIGITS.test(value) ? value : null;
    case "start":
      return tag === "ol" && DIGITS.test(value) ? value : null;
    case "open":
      return tag === "details" ? "" : null;
    case "color":
    case "size":
      return null; // <font> 在 rebuild 里折算成 style
    default:
      return null;
  }
}

function rebuild(source: Node, target: Node): void {
  for (const child of source.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    const tag = element.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) continue;

    const allowed = BLOCK_TAGS.has(tag) || tag in INLINE_HTML_TAGS;
    if (!allowed) {
      // 不认识但也无害的标签：只留内容
      rebuild(element, target);
      continue;
    }

    // <font> 没有语义，落成带 style 的 span
    const node = document.createElement(tag === "font" ? "span" : tag);
    const styles: string[] = [];
    for (const attr of element.attributes) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) continue;
      const value = sanitizeAttribute(tag, name, attr.value);
      if (value === null) continue;
      if (name === "style") styles.push(value);
      else node.setAttribute(name, value);
    }
    if (tag === "font") {
      const style = inlineStyleOf({
        name: "font",
        closing: false,
        selfClosing: false,
        attrs: attrsOf(element),
      });
      if (style) styles.push(style);
    }
    if (styles.length) node.setAttribute("style", styles.join("; "));
    if (tag === "img") {
      node.setAttribute("loading", "lazy");
      node.setAttribute("decoding", "async");
    }
    rebuild(element, node);
    target.appendChild(node);
  }
}

function attrsOf(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of element.attributes) attrs[attr.name.toLowerCase()] = attr.value;
  return attrs;
}

/**
 * 把一段 HTML 源码变成可以直接挂进页面的节点。
 * DOMParser 解析出来的文档是惰性的（脚本不执行、资源不加载），我们只从里面
 * 按白名单抄节点出来，所以最终挂上去的树里不可能有脚本或事件属性。
 */
export function sanitizeHtml(source: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const parsed = new DOMParser().parseFromString(source, "text/html");
  rebuild(parsed.body, fragment);
  return fragment;
}

/** 块级 HTML 有没有值得渲染的东西；纯注释或空白就不用换替身了。 */
export function hasRenderableHtml(source: string): boolean {
  return /<[a-zA-Z]/.test(source);
}
