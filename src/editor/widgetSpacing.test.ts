import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CodeMirror 用 getBoundingClientRect()（边框盒）测量 widget 的高度，
 * margin 不在边框盒里。所以 widget 上的 margin 会让高度图比真实布局短，
 * 点击坐标就会映射到错误的行 —— 表现为「点这一行，光标跳到下一行」。
 *
 * 实测：.cm-otw-table-widget 的 margin: 0.9em 0（font-size 14px）每个表格
 * 少算 25.2px，一篇有三个表格的文档累计偏 76px，标题行点下去落到下一行。
 *
 * 规则：widget 的间距一律用 padding（或外层容器的 padding），不许用 margin。
 */
const CSS = readFileSync(path.join(process.cwd(), "src/styles/globals.css"), "utf8");

/** 这些类会成为 widget 的最外层元素，它们的 margin 不会被计入高度图。 */
const WIDGET_ROOT_CLASSES = [
  "cm-otw-table-block",
  "cm-otw-fence-block",
  "cm-otw-hr",
  "cm-otw-image",
];

function declarationsFor(className: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(^|\n)([^\n{]*\.${className}[^\n{]*)\{([^}]*)\}`, "g");
  let match = re.exec(CSS);
  while (match) {
    out.push(
      ...match[3]!
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean),
    );
    match = re.exec(CSS);
  }
  return out;
}

describe("widget 间距不能用 margin", () => {
  for (const className of WIDGET_ROOT_CLASSES) {
    it(`.${className} 没有 margin 声明`, () => {
      const declarations = declarationsFor(className);
      expect(declarations.length).toBeGreaterThan(0);
      const margins = declarations.filter((d) => /^margin(-top|-bottom|-block)?\s*:/.test(d));
      // margin: 0 是允许的（显式清零）
      const nonZero = margins.filter((d) => !/:\s*0(px|em|rem)?\s*$/.test(d));
      expect(nonZero).toEqual([]);
    });
  }
});
