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

/**
 * 代码块 / 属性块的围栏：光标不在里面时是封口 widget，进去以后是源码行。两种
 * 状态这一行必须一样高，否则一点进代码块，上面的围栏行一变高矮，整块代码连同
 * 刚点的那一行一起跳。两边都从同一组变量取数，这里守着别有人只改一边。
 */
describe("围栏的封口和源码行同高", () => {
  const uses = (className: string, variable: string) =>
    declarationsFor(className).some((d) => d.includes(`var(${variable})`));

  it("code fence caps and revealed fence lines share the fence geometry", () => {
    expect(uses("cm-otw-code-fence.is-open", "--fence-open")).toBe(true);
    expect(uses("cm-otw-code-fence", "--fence-close")).toBe(true);
    expect(uses("cm-otw-fence-block.is-open", "--fence-gap")).toBe(true);
    expect(uses("cm-otw-fence-block.is-close", "--fence-gap")).toBe(true);
    for (const variable of ["--fence-gap", "--fence-open", "--fence-line"]) {
      expect(uses("cm-otw-fence-source.is-open", variable), variable).toBe(true);
    }
    for (const variable of ["--fence-gap", "--fence-close"]) {
      expect(uses("cm-otw-fence-source.is-close", variable), variable).toBe(true);
    }
  });

  it("front matter caps and revealed fence lines share the front matter geometry", () => {
    expect(uses("cm-otw-frontmatter-fence.is-open", "--frontmatter-open")).toBe(true);
    expect(uses("cm-otw-frontmatter-fence", "--frontmatter-close")).toBe(true);
    expect(uses("cm-otw-frontmatter-block.is-close", "--frontmatter-gap")).toBe(true);
    expect(uses("cm-otw-frontmatter-fence-line.is-open", "--frontmatter-open")).toBe(true);
    for (const variable of ["--frontmatter-gap", "--frontmatter-close"]) {
      expect(uses("cm-otw-frontmatter-fence-line.is-close", variable), variable).toBe(true);
    }
  });
});
