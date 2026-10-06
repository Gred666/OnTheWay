/* ============================================================
   正文里的 `[[双链]]`。

   和 Rust 侧 src-tauri/src/vault/links.rs 同一套规则（桌面版的反向链接在那边算；
   这里给浏览器 mock 和反向链接面板画行内小块用）：
     [[标题]]  [[标题|别名]]  [[标题#小节]]  [[标题^块id]]
   目标按标题匹配，去掉首尾空白、不分大小写。围栏代码块和行内代码里的不算。
   ============================================================ */

export interface WikiLinkHit {
  /** 正文里的行号（从 0 开始） */
  line: number;
  /** 目标标题（去掉了 `|别名`、`#小节`、`^块`） */
  title: string;
}

/** 双链的目标标题：`标题|别名` → 标题，`标题#小节` / `标题^块` → 标题 */
export function wikiTargetTitle(inner: string): string {
  const target = inner.split("|")[0] ?? "";
  const cuts = [target.indexOf("#"), target.indexOf("^")].filter((index) => index > 0);
  const cut = cuts.length ? Math.min(...cuts) : -1;
  return (cut >= 0 ? target.slice(0, cut) : target).trim();
}

/** `[[目标|别名]]` 显示成什么：有别名显示别名，没有就是目标原文 */
export function wikiDisplayText(inner: string): string {
  const pipe = inner.indexOf("|");
  return (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim();
}

/** 两篇标题是不是同一篇（和 Mod+点击跳转的规则一样） */
export function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 一篇正文里所有的双链，按出现顺序 */
export function findWikiLinks(body: string): WikiLinkHit[] {
  const out: WikiLinkHit[] = [];
  let fence: { ch: string; len: number } | null = null;
  body.split("\n").forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      const run = marker[1]!;
      if (!fence) {
        fence = { ch: run[0]!, len: run.length };
        return;
      }
      if (run[0] === fence.ch && run.length >= fence.len && !marker[2]!.trim()) {
        fence = null;
        return;
      }
    }
    if (fence || !line.includes("[[")) return;
    for (const title of linksInLine(withoutCodeSpans(line))) out.push({ line: index, title });
  });
  return out;
}

/** 一行里的双链片段：`[[` 和 `]]` 之间的原文（含别名），按出现顺序 */
export function splitWikiSegments(
  line: string,
): ({ kind: "text"; text: string } | { kind: "link"; inner: string })[] {
  const out: ({ kind: "text"; text: string } | { kind: "link"; inner: string })[] = [];
  let rest = line;
  while (rest) {
    const start = rest.indexOf("[[");
    const end = start >= 0 ? rest.indexOf("]]", start + 2) : -1;
    if (start < 0 || end < 0) {
      out.push({ kind: "text", text: rest });
      break;
    }
    const inner = rest.slice(start + 2, end);
    if (inner.includes("[") || inner.includes("]") || !wikiTargetTitle(inner)) {
      out.push({ kind: "text", text: rest.slice(0, end + 2) });
    } else {
      if (start > 0) out.push({ kind: "text", text: rest.slice(0, start) });
      out.push({ kind: "link", inner });
    }
    rest = rest.slice(end + 2);
  }
  return out;
}

function linksInLine(line: string): string[] {
  return splitWikiSegments(line)
    .filter((part, index, parts) => {
      if (part.kind !== "link") return false;
      const before = parts[index - 1];
      // `\[[` 是转义
      return !(before?.kind === "text" && before.text.endsWith("\\"));
    })
    .map((part) => wikiTargetTitle((part as { inner: string }).inner));
}

/** 去掉行内代码（成对的反引号串之间的内容），换成空格，位置不变 */
function withoutCodeSpans(line: string): string {
  return line.replace(/(`+)([\s\S]*?)\1/g, (match) => " ".repeat(match.length));
}

/** 反向链接里给人看的那一行：去掉列表符号、任务框、引用和标题的井号 */
export function contextLine(line: string): string {
  let text = line.trim();
  for (;;) {
    const before = text;
    text = text
      .replace(/^>\s*/, "")
      .replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^#+\s*/, "")
      .replace(/^\d+\.\s+/, "");
    if (text === before) return text;
  }
}
