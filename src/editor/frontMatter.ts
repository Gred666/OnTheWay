import type { Text } from "@codemirror/state";

export interface FrontMatterRange {
  /** 第一行 `---` 的起点（永远是 0） */
  from: number;
  /** 结束行 `---` 的终点（不含其后的换行） */
  to: number;
  /** 起止两行的行号（一基） */
  openLine: number;
  closeLine: number;
}

const FENCE_RE = /^---\s*$/;
const KEY_RE = /^[A-Za-z_][\w-]*\s*:/;
/** 超过这么多行还没闭合就不当 front matter 了：真有人写 200 行 YAML 头也不合理。 */
const MAX_LINES = 60;

/**
 * 文档开头的 YAML front matter。
 *
 * CommonMark 会把它解析成「分隔线 + Setext 标题」，`title: x` 会变成一个 H2。
 * 这里在解析之外单独识别：必须从第 1 行开始、以单独一行 `---` 结束，
 * 且中间至少有一行长得像 `key: value` —— 否则一篇以分隔线开头的普通笔记
 * 会被误判。
 */
export function frontMatterRange(doc: Text): FrontMatterRange | null {
  if (doc.lines < 3) return null;
  const first = doc.line(1);
  if (!FENCE_RE.test(first.text)) return null;

  let sawKey = false;
  const last = Math.min(doc.lines, MAX_LINES);
  for (let number = 2; number <= last; number += 1) {
    const line = doc.line(number);
    if (FENCE_RE.test(line.text)) {
      if (!sawKey) return null;
      return { from: 0, to: line.to, openLine: 1, closeLine: number };
    }
    if (KEY_RE.test(line.text)) sawKey = true;
  }
  return null;
}
