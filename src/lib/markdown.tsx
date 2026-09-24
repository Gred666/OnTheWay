import type { OutlineItem } from "@/data/types";
import { type MarkdownTableModel, parseMarkdownTable } from "@/editor/markdownTable";
import { type ReactNode, createElement } from "react";

/* ============================================================
   轻量 Markdown 渲染。
   自己解析而不是 dangerouslySetInnerHTML —— 返回真实 React 节点，
   没有 XSS 面，也方便给行内元素挂交互（如双链跳转）。

   支持：# ~ ###### 标题、段落、有序/无序列表（含任务勾选框）、
        ``` 围栏代码、GFM 表格、--- 分隔线、
        > [!标签] 形式的 callout、行内 粗体/斜体/删除线/代码/链接/[[双链]]

   这份渲染器同时是「切换工作区时编辑器还没挂上」和「大文档只读」两种
   场景下用户实际看到的东西，语法覆盖必须跟编辑器对得上，
   否则每次切换都会闪一版长得不一样的正文。
   ============================================================ */

interface ListEntry {
  text: string;
  /** null = 普通条目；true/false = 任务列表的勾选状态 */
  checked: boolean | null;
}

type Block =
  | { kind: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; id: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: ListEntry[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "table"; table: MarkdownTableModel }
  | { kind: "callout"; label: string; body: string; id: string }
  | { kind: "hr" };

const FENCE_RE = /^(?:`{3,}|~{3,})(.*)$/;
const TASK_RE = /^\[([ xX])\]\s+/;
const DELIMITER_ROW_RE = /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/;

/**
 * 把标题文本转成稳定的锚点 id（中文直接用原文，浏览器支持）。
 * ns 用于同页多个 Markdown 区域隔离 id。
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

    // --- 围栏代码
    const fence = FENCE_RE.exec(trimmed);
    if (fence) {
      flushPara();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !FENCE_RE.test(lines[j]!.trim())) body.push(lines[j++]!);
      blocks.push({ kind: "code", lang: fence[1]!.trim(), code: body.join("\n") });
      i = j;
      continue;
    }

    // --- GFM 表格：当前行有竖线且下一行是分隔行
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      DELIMITER_ROW_RE.test(lines[i + 1]!.trim())
    ) {
      let j = i;
      const rows: string[] = [];
      while (j < lines.length && lines[j]!.trim().includes("|")) rows.push(lines[j++]!.trim());
      const table = parseMarkdownTable(rows.join("\n"));
      if (table) {
        flushPara();
        blocks.push({ kind: "table", table });
        i = j - 1;
        continue;
      }
    }

    // --- 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      flushPara();
      const text = h[2]!.replace(/\s+#+\s*$/, "").trim();
      blocks.push({
        kind: "h",
        level: h[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        text,
        id: slug(text, anchorIndex++, ns),
      });
      continue;
    }

    // --- callout：`> [!标签]` 起头，后续 `>` 行是正文
    // 也认 `[!标签]-` / `[!标签]+` 的折叠符和后面的自定义标题（标题优先显示）
    const callout = /^>\s*\[!(.+?)\][+-]?(?:[ \t]+(\S.*?))?\s*$/.exec(trimmed);
    if (callout) {
      flushPara();
      const body: string[] = [];
      while (i + 1 < lines.length && lines[i + 1]!.trim().startsWith(">")) {
        body.push(lines[++i]!.trim().replace(/^>\s?/, ""));
      }
      const label = (callout[2] ?? callout[1]!).trim();
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
      const items: ListEntry[] = [];
      const re = isUl ? /^[-*]\s+/ : /^\d+\.\s+/;
      let j = i;
      while (j < lines.length) {
        const cur = lines[j]!.trim();
        if (!re.test(cur)) break;
        const content = cur.replace(re, "");
        const task = TASK_RE.exec(content);
        items.push(
          task
            ? { text: content.slice(task[0].length), checked: task[1]!.toLowerCase() === "x" }
            : { text: content, checked: null },
        );
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

const INLINE_RE =
  /(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*]+\*)|(`[^`]+`)|(\[\[[^\]]+\]\])|(\[[^\]]+\]\([^)]+\))/g;

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
    } else if (tok.startsWith("~~")) {
      out.push(<del key={k}>{tok.slice(2, -2)}</del>);
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
        return createElement(
          `h${b.level}`,
          { key, id: b.id, "data-outline-id": b.id },
          renderInline(b.text, key),
        );
      case "p":
        return <p key={key}>{renderInline(b.text, key)}</p>;
      case "code":
        return (
          <pre key={key} data-lang={b.lang || undefined}>
            <code>{b.code}</code>
          </pre>
        );
      case "table":
        return (
          <div key={key} className="prose-table-wrap">
            <table>
              <thead>
                <tr>
                  {b.table.header.map((cell, j) => (
                    <th
                      key={`${key}-h${j}-${cell}`}
                      style={{ textAlign: b.table.alignments[j] ?? "left" }}
                    >
                      {renderInline(cell, `${key}-h${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.table.rows.map((row, r) => (
                  <tr key={`${key}-r${r}-${row.join("|")}`}>
                    {row.map((cell, c) => (
                      <td
                        key={`${key}-r${r}c${c}-${cell}`}
                        style={{ textAlign: b.table.alignments[c] ?? "left" }}
                      >
                        {renderInline(cell, `${key}-r${r}c${c}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "ul":
      case "ol":
        return createElement(
          b.kind,
          { key, className: b.items.some((it) => it.checked !== null) ? "prose-tasks" : undefined },
          b.items.map((it, j) => (
            <li key={`${key}-${it.text.slice(0, 24)}`}>
              {it.checked !== null && (
                <input type="checkbox" checked={it.checked} disabled />
              )}
              {renderInline(it.text, `${key}-${j}`)}
            </li>
          )),
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

export function buildOutline(md: string, actionGroupTitle?: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const source = lines[lineIndex]!;
    const heading = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(source);
    const setext = lineIndex + 1 < lines.length && /^\s*(=+|-+)\s*$/.exec(lines[lineIndex + 1]!);
    const callout = /^\s*>\s*\[!(.+?)\][+-]?(?:[ \t]+(\S.*?))?\s*$/.exec(source);
    if (heading) {
      const depth = heading[1]!.length;
      const text = heading[2]!.replace(/\s+#+\s*$/, "").trim();
      items.push({
        id: slug(text, index++, "h"),
        text,
        level: depth <= 2 ? 1 : 2,
        line: lineIndex + 1,
      });
    } else if (source.trim() && setext) {
      const text = source.trim();
      items.push({
        id: slug(text, index++, "h"),
        text,
        level: 1,
        line: lineIndex + 1,
      });
      lineIndex += 1;
    } else if (callout) {
      const text = (callout[2] ?? callout[1]!).trim();
      items.push({ id: slug(text, index++, "h"), text, level: 1, line: lineIndex + 1 });
    }
  }

  if (actionGroupTitle) {
    items.push({
      id: "action-group",
      text: actionGroupTitle,
      level: 1,
      line: md.split("\n").length,
    });
  }

  // 开头补一个「概览」锚点回到文档顶部。
  // 只有在下面确实有内容时才加 —— 否则目录里孤零零一个「概览」很傻。
  if (items.length > 0) {
    items.unshift({ id: "doc-top", text: "概览", level: 1, line: 1 });
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
