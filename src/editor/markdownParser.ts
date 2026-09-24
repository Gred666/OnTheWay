import { commonmarkLanguage, markdown } from "@codemirror/lang-markdown";
import type { LanguageDescription } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import {
  type BlockContext,
  Emoji,
  GFM,
  type InlineContext,
  type Line,
  type MarkdownConfig,
  type MarkdownExtension,
  Superscript,
} from "@lezer/markdown";

/* ============================================================
   解析器配置。

   在 CommonMark + GFM 之上自己拼，而不是直接用 lang-markdown 的
   markdownLanguage —— 那一套把单个 `~` 给了 Pandoc 下标，`~x~` 永远
   不可能是删除线。这里按 GitHub 的规矩来：一个或两个 `~` 都是删除线，
   下标改走 `<sub>` 标签。

   另外加了 `$…$` / `$$…$$` 数学公式的节点：公式必须在解析阶段就被整块
   认下来，否则 `$a*b$ 和 $c*d$` 里的两个 `*` 会被当成一对强调标记。
   ============================================================ */

const DOLLAR = 36;
const TILDE = 126;
const BACKSLASH = 92;
const NEWLINE = 10;

const isSpace = (code: number) => code === 32 || code === 9 || code === NEWLINE;
const isDigit = (code: number) => code >= 48 && code <= 57;
const PUNCTUATION = /[\p{P}\p{S}]/u;

/**
 * 行内公式：`$x$`，或写在同一行里的 `$$x$$`。
 * 按 Pandoc 的规矩：开头的 `$` 后面不能是空白，结尾的 `$` 前面不能是空白、
 * 后面不能紧跟数字 —— 这样「$5 和 $10」不会被当成公式。
 */
function parseInlineMath(cx: InlineContext, next: number, pos: number): number {
  if (next !== DOLLAR) return -1;
  const display = cx.char(pos + 1) === DOLLAR;
  const open = display ? 2 : 1;
  const start = pos + open;
  if (start >= cx.end) return -1;
  if (!display && (isSpace(cx.char(start)) || cx.char(start) === DOLLAR)) return -1;

  for (let i = start; i < cx.end; i += 1) {
    const code = cx.char(i);
    if (code === BACKSLASH) {
      i += 1;
      continue;
    }
    if (code === NEWLINE) return -1;
    if (code !== DOLLAR) continue;
    if (display) {
      if (cx.char(i + 1) !== DOLLAR || i === start) continue;
      return cx.addElement(
        cx.elt("InlineMath", pos, i + 2, [
          cx.elt("MathMark", pos, start),
          cx.elt("MathMark", i, i + 2),
        ]),
      );
    }
    if (i === start || isSpace(cx.char(i - 1)) || isDigit(cx.char(i + 1))) continue;
    return cx.addElement(
      cx.elt("InlineMath", pos, i + 1, [
        cx.elt("MathMark", pos, start),
        cx.elt("MathMark", i, i + 1),
      ]),
    );
  }
  return -1;
}

const startsMathBlock = (line: Line) =>
  line.next === DOLLAR && line.text.charCodeAt(line.pos + 1) === DOLLAR;

/**
 * 这一行还处在多少层容器块（引用、列表）里。运行时有、类型里没导出 ——
 * FencedCode 自己就是拿它和 cx.depth 比来判断围栏有没有被容器截断的。
 */
const lineDepth = (line: Line) => (line as unknown as { depth: number }).depth;

/**
 * 公式块：`$$` 起头，到某一行以 `$$` 结尾为止（可以是同一行）。
 * 没闭合就一直到文档末尾 —— 和围栏代码一个脾气。
 */
function parseMathBlock(cx: BlockContext, line: Line): boolean {
  if (!startsMathBlock(line)) return false;
  const from = cx.lineStart + line.pos;
  const marks = [cx.elt("MathMark", from, from + 2)];

  const rest = line.text.slice(line.pos + 2).trimEnd();
  if (rest.length >= 2 && rest.endsWith("$$")) {
    const to = from + 2 + rest.length;
    marks.push(cx.elt("MathMark", to - 2, to));
    cx.nextLine();
    cx.addElement(cx.elt("MathBlock", from, to, marks));
    return true;
  }

  while (cx.nextLine() && lineDepth(line) >= cx.depth) {
    const text = line.text.slice(line.pos).trimEnd();
    if (!text.endsWith("$$")) continue;
    const to = cx.lineStart + line.pos + text.length;
    marks.push(cx.elt("MathMark", to - 2, to));
    cx.nextLine();
    cx.addElement(cx.elt("MathBlock", from, to, marks));
    return true;
  }
  cx.addElement(cx.elt("MathBlock", from, cx.prevLineEnd(), marks));
  return true;
}

const MathExtension: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: t.special(t.content) },
    { name: "MathBlock", block: true, style: t.special(t.content) },
    { name: "MathMark", style: t.processingInstruction },
  ],
  parseInline: [{ name: "InlineMath", parse: parseInlineMath, before: "Emphasis" }],
  parseBlock: [
    {
      name: "MathBlock",
      parse: parseMathBlock,
      // `$$` 可以直接打断段落，不用先空一行
      endLeaf: (_cx, line) => startsMathBlock(line),
      before: "LinkReference",
    },
  ],
};

/** 单个 `~` 的删除线。复用 GFM 的节点名，装饰层不用知道它是一个还是两个波浪线。 */
const SingleTildeDelimiter = { resolve: "Strikethrough", mark: "StrikethroughMark" };

const SingleTildeStrikethrough: MarkdownConfig = {
  parseInline: [
    {
      name: "SingleTildeStrikethrough",
      after: "Strikethrough",
      parse(cx, next, pos) {
        if (next !== TILDE || cx.char(pos + 1) === TILDE || cx.char(pos - 1) === TILDE) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 1, pos + 2);
        const spaceBefore = /\s|^$/.test(before);
        const spaceAfter = /\s|^$/.test(after);
        const punctBefore = PUNCTUATION.test(before);
        const punctAfter = PUNCTUATION.test(after);
        return cx.addDelimiter(
          SingleTildeDelimiter,
          pos,
          pos + 1,
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter),
        );
      },
    },
  ],
};

/** 编辑器用的全部 Markdown 解析扩展；单测直接拿它配到 commonmark 上。 */
export const markdownExtensions: MarkdownExtension = [
  GFM,
  SingleTildeStrikethrough,
  Superscript,
  Emoji,
  MathExtension,
];

/** 编辑器的语言支持。围栏代码按语言名懒加载对应解析器。 */
export function markdownSupport(codeLanguages?: readonly LanguageDescription[]) {
  return markdown({ base: commonmarkLanguage, extensions: markdownExtensions, codeLanguages });
}
