import { describe, expect, it } from "vitest";
import {
  alignmentMarker,
  csvCellSource,
  displayWidth,
  emptyRowSource,
  formatGfmTable,
  gfmCellSource,
  numericColumns,
  parseDelimitedTable,
  parseMarkdownTable,
} from "./markdownTable";

describe("GFM table preview", () => {
  it("parses rows and column alignment", () => {
    expect(
      parseMarkdownTable("| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| A | B | C |"),
    ).toMatchObject({
      header: ["左", "中", "右"],
      rows: [["A", "B", "C"]],
      alignments: ["left", "center", "right"],
    });
  });

  it("preserves escaped pipes and pads missing cells", () => {
    const table = parseMarkdownTable("| A | B |\n| --- | --- |\n| a\\|b |");
    expect(table?.rows).toEqual([["a|b", ""]]);
  });

  it("rejects text without a valid delimiter row", () => {
    expect(parseMarkdownTable("A | B\nnot a table")).toBeNull();
  });

  // 格式化工具按列宽对齐时会写出 `:--:`；以前要求至少三个 `-`，整张表退回源码
  it("accepts delimiter cells with fewer than three dashes, as GFM does", () => {
    const table = parseMarkdownTable("| 语法 | 状态 | 备注 |\n| :--- | :--: | -: |\n| a | b | c |");
    expect(table?.alignments).toEqual(["left", "center", "right"]);
    expect(parseMarkdownTable("| a |\n| - |\n| 1 |")?.rows).toEqual([["1"]]);
  });

  it("leaves non-pipe escapes for the inline renderer", () => {
    const table = parseMarkdownTable("| A |\n| --- |\n| \\*不是斜体\\* a\\|b |");
    expect(table?.rows).toEqual([["\\*不是斜体\\* a|b"]]);
  });
});

describe("numeric columns", () => {
  it("flags columns whose non-empty cells are all numbers", () => {
    const table = parseDelimitedTable(
      '名字,数量,占比,备注\n苹果,3,12%,\n梨,"1,024",-3.5%,红的\n香蕉,,¥98,',
      ",",
    )!;
    expect(numericColumns(table)).toEqual([false, true, true, false]);
    const money = parseDelimitedTable("价格\n¥98\n$1.50", ",")!;
    expect(numericColumns(money)).toEqual([true]);
  });
});

describe("cell layout for in-place editing", () => {
  it("locates every GFM cell in the source, empty ones included", () => {
    const source = "| a | b |\n| --- | :-: |\n|  **x**  |   |\n| y |";
    const table = parseMarkdownTable(source)!;
    const text = (range: [number, number]) => source.slice(range[0], range[1]);
    expect(table.layout!.cells[0]!.map(text)).toEqual(["a", "b"]);
    expect(table.layout!.cells[1]!.map(text)).toEqual(["**x**", " "]);
    // 短行只有自己那一格；整行范围用来在行尾补格子
    expect(table.layout!.cells[2]!.map(text)).toEqual(["y"]);
    expect(text(table.layout!.lines[2]!)).toBe("| y |");
    expect(text(table.layout!.delimiter!)).toBe("| --- | :-: |");
  });

  it("locates csv fields including their quotes, and keeps rows of empty cells", () => {
    const source = '名字,备注\n苹果,"红的, 甜的"\n\n,,\n';
    const table = parseDelimitedTable(source, ",")!;
    expect(table.rows).toEqual([
      ["苹果", "红的, 甜的"],
      ["", ""],
    ]);
    const [from, to] = table.layout!.cells[1]![1]!;
    expect(source.slice(from, to)).toBe('"红的, 甜的"');
    expect(table.layout!.lines).toHaveLength(3);
  });

  it("writes cell text back as valid source", () => {
    // 没转义的 `|` 补上反斜杠；已经转义过的不再重复
    expect(gfmCellSource(" a|b\nc ")).toBe(String.raw`a\|b<br>c`);
    expect(gfmCellSource(String.raw`已经转义 \| 了`)).toBe(String.raw`已经转义 \| 了`);
    expect(csvCellSource("plain", ",")).toBe("plain");
    expect(csvCellSource('a, "b"', ",")).toBe('"a, ""b"""');
    expect(csvCellSource("a,b", "\t")).toBe("a,b");
    expect(emptyRowSource(3, "markdown")).toBe("|   |   |   |");
    expect(emptyRowSource(3, "csv")).toBe(",,");
    expect(emptyRowSource(1, "tsv")).toBe('""');
  });
});

describe("formatGfmTable", () => {
  it("pads columns by display width, CJK and emoji counting double", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("语法")).toBe(4);
    expect(displayWidth("✅")).toBe(2);
    expect(displayWidth("🚀 ok")).toBe(5);
    expect(
      formatGfmTable(["语法", "状态", "n"], ["left", "center", "right"], [["**粗体**", "✅", "3"]]),
    ).toEqual([
      "| 语法     | 状态 |   n |",
      "| :------- | :--: | --: |",
      "| **粗体** |  ✅  |   3 |",
    ]);
  });

  it("keeps the delimiter width when only the alignment changes", () => {
    expect(alignmentMarker(5, "center")).toBe(":---:");
    expect(alignmentMarker(5, "right")).toBe("----:");
    expect(alignmentMarker(5, "left")).toBe(":----");
    expect(alignmentMarker(5, null)).toBe("-----");
    expect(alignmentMarker(1, "center")).toBe(":-:");
  });
});
