import type { OutlineItem } from "@/data/types";
import type { ReactNode } from "react";

/* ============================================================
   轻量 Markdown 渲染。
   自己解析而不是 dangerouslySetInnerHTML —— 返回真实 React 节点，
   没有 XSS 面，也方便给行内元素挂交互（如双链跳转）。

   支持：## / ### 标题、段落、有序/无序列表、--- 分隔线、
        > [!标签] 形式的 callout、行内 粗体/斜体/代码/链接/[[双链]]
   P6 上 Milkdown 后，这个模块退化为「大文档只读预览」的渲染器。
   ============================================================ */

type Block =
  | { kind: "h"; level: 2 | 3; text: string; id: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "callout"; label: string; body: string; id: string }
  | { kind: "hr" };

/**
 * 把标题文本转成稳定的锚点 id（中文直接用原文，浏览器支持）。
 * ns 用于隔离 bodyMd 和 bodyAfterMd 两段正文的 id，避免重名。
 */
function slug(text: string, index: number, ns: string): string {
  return `${ns}-${index}-${text.replace(/\s+/g, "-").slice(0, 24)}`;
}

export function parseBlocks(md: string, ns = "h"): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let anchorIndex = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: "p", text: para.join("") });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      flushPara();
      continue;
    }

    // --- 分隔线
    if (/^-{3,}$/.test(trimmed)) {
      flushPara();
      blocks.push({ kind: "hr" });
      continue;
    }

    // --- 标题
    const h = /^(#{2,3})\s+(.*)$/.exec(trimmed);
    if (h) {
      flushPara();
      const text = h[2]!.trim();
      blocks.push({
        kind: "h",
        level: h[1]!.length === 2 ? 2 : 3,
        text,
        id: slug(text, anchorIndex++, ns),
      });
      continue;
    }

    // --- callout：`> [!标签]` 起头，后续 `>` 行是正文
    const callout = /^>\s*\[!(.+?)\]\s*$/.exec(trimmed);
    if (callout) {
      flushPara();
      const body: string[] = [];
      while (i + 1 < lines.length && lines[i + 1]!.trim().startsWith(">")) {
        body.push(lines[++i]!.trim().replace(/^>\s?/, ""));
      }
      const label = callout[1]!.trim();
      blocks.push({
        kind: "callout",
        label,
        body: body.join(" "),
        id: slug(label, anchorIndex++, ns),
      });
      continue;
    }

    // --- 列表
    const isUl = /^[-*]\s+/.test(trimmed);
    const isOl = /^\d+\.\s+/.test(trimmed);
    if (isUl || isOl) {
      flushPara();
      const items: string[] = [];
      const re = isUl ? /^[-*]\s+/ : /^\d+\.\s+/;
      let j = i;
      while (j < lines.length) {
        const cur = lines[j]!.trim();
        if (!re.test(cur)) break;
        items.push(cur.replace(re, ""));
        j++;
      }
      blocks.push({ kind: isUl ? "ul" : "ol", items });
      i = j - 1;
      continue;
    }

    // --- 段落（软换行合并成一段，中文排版不需要保留硬换行）
    para.push(trimmed);
  }
  flushPara();
  return blocks;
}

/* ---------------- 行内渲染 ---------------- */

const INLINE_RE = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\[\[[^\]]+\]\])|(\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;

  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index!;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const k = `${keyPrefix}-${n++}`;

    if (tok.startsWith("**")) {
      out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("[[")) {
      // 双链：P6 接上真实跳转，现在先渲染成可识别的样式
      out.push(
        <span key={k} className="otw-wikilink">
          {tok.slice(2, -2)}
        </span>,
      );
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      out.push(
        <a key={k} href={lm[2]} target="_blank" rel="noreferrer noopener">
          {lm[1]}
        </a>,
      );
    } else if (tok.startsWith("*")) {
      out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ---------------- 块渲染 ---------------- */

export function renderMarkdown(md: string, ns = "h"): ReactNode[] {
  return parseBlocks(md, ns).map((b, i) => {
    const key = `${ns}-b${i}`;
    switch (b.kind) {
      case "h":
        return b.level === 2 ? (
          <h2 key={key} id={b.id} data-outline-id={b.id}>
            {renderInline(b.text, key)}
          </h2>
        ) : (
          <h3 key={key} id={b.id} data-outline-id={b.id}>
            {renderInline(b.text, key)}
          </h3>
        );
      case "p":
        return <p key={key}>{renderInline(b.text, key)}</p>;
      case "ul":
        return (
          <ul key={key}>
            {b.items.map((it, j) => (
              <li key={`${key}-${it.slice(0, 24)}`}>{renderInline(it, `${key}-${j}`)}</li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={key}>
            {b.items.map((it, j) => (
              <li key={`${key}-${it.slice(0, 24)}`}>{renderInline(it, `${key}-${j}`)}</li>
            ))}
          </ol>
        );
      case "callout":
        return (
          <div key={key} id={b.id} data-outline-id={b.id} className="callout">
            <span className="callout-label">{b.label}</span>
            <div className="callout-body">{renderInline(b.body, key)}</div>
          </div>
        );
      case "hr":
        return <hr key={key} />;
    }
  });
}

/* ---------------- 目录树 ----------------
   右侧目录从正文标题 + 行动项分组标题自动生成。
   这样文档结构变了目录自动跟上，不需要单独维护一份。
*/

export function buildOutline(
  md: string,
  actionGroupTitle?: string,
  afterMd?: string,
): OutlineItem[] {
  // 按文档顺序收集锚点：## / ### 标题，以及 callout 的标签
  // （原型里「核心判断」「当时的结论」这类就是 callout，它们是文档的骨架之一）
  const collect = (src: string, ns: string): OutlineItem[] => {
    const out: OutlineItem[] = [];
    for (const b of parseBlocks(src, ns)) {
      if (b.kind === "h") {
        out.push({ id: b.id, text: b.text, level: b.level === 2 ? 1 : 2 });
      } else if (b.kind === "callout") {
        out.push({ id: b.id, text: b.label, level: 1 });
      }
    }
    return out;
  };

  const items: OutlineItem[] = collect(md, "h");

  if (actionGroupTitle) {
    items.push({ id: "action-group", text: actionGroupTitle, level: 1 });
  }
  if (afterMd) {
    items.push(...collect(afterMd, "after"));
  }

  // 开头补一个「概览」锚点回到文档顶部。
  // 只有在下面确实有内容时才加 —— 否则目录里孤零零一个「概览」很傻。
  if (items.length > 0) {
    items.unshift({ id: "doc-top", text: "概览", level: 1 });
  }
  return items;
}

/** 正文字数：中文按字算，英文按词算 */
export function countWords(md: string): number {
  const plain = md
    .replace(/^>\s*\[!.+?\]\s*$/gm, "")
    .replace(/[#>*`\-[\]()]/g, " ")
    .trim();
  const cjk = (plain.match(/[一-龥]/g) ?? []).length;
  const words = (plain.match(/[a-zA-Z0-9]+/g) ?? []).length;
  return cjk + words;
}
