import { describe, expect, it } from "vitest";
import { parseMarkdownTable } from "./markdownTable";

describe("GFM table preview", () => {
  it("parses rows and column alignment", () => {
    expect(parseMarkdownTable("| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| A | B | C |")).toEqual({
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
});
