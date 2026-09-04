import { describe, expect, it } from "vitest";
import { buildOutline } from "./markdown";

describe("Markdown outline", () => {
  it("maps H1-H6 to real source lines", () => {
    const outline = buildOutline(
      ["# 一级", "正文", "## 二级", "### 三级", "#### 四级", "##### 五级", "###### 六级"].join(
        "\n",
      ),
    );

    expect(outline.map(({ text, line }) => [text, line])).toEqual([
      ["概览", 1],
      ["一级", 1],
      ["二级", 3],
      ["三级", 4],
      ["四级", 5],
      ["五级", 6],
      ["六级", 7],
    ]);
  });

  it("includes Setext headings", () => {
    const outline = buildOutline("一级标题\n====\n\n二级标题\n----");
    expect(outline.map(({ text, line }) => [text, line])).toEqual([
      ["概览", 1],
      ["一级标题", 1],
      ["二级标题", 4],
    ]);
  });
});
