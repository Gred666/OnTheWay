import { describe, expect, it } from "vitest";
import { matchKeywords, matchText, snippetAround } from "./paletteSearch";

describe("matchText", () => {
  it("ranks a prefix above a hit in the middle, and an exact label above both", () => {
    const prefix = matchText("主题跟随系统", "主题")!;
    const middle = matchText("切换主题", "主题")!;
    const exact = matchText("主题", "主题")!;
    expect(prefix.ranges).toEqual([[0, 2]]);
    expect(middle.ranges).toEqual([[2, 4]]);
    expect(prefix.score).toBeGreaterThan(middle.score);
    expect(exact.score).toBeGreaterThan(prefix.score);
  });

  it("ignores case", () => {
    expect(matchText("/GOAL", "goal")?.ranges).toEqual([[1, 5]]);
  });

  it("needs every space-separated word", () => {
    expect(matchText("切换到暗色", "切换 暗")?.ranges).toEqual([
      [0, 2],
      [3, 4],
    ]);
    expect(matchText("切换到暗色", "切换 亮")).toBeNull();
  });

  it("matches characters in order when they sit close together", () => {
    const hit = matchText("主题跟随系统", "主跟")!;
    expect(hit.ranges).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(hit.score).toBeLessThan(matchText("主题跟随系统", "主题")!.score);
  });

  it("does not stitch a query together from characters far apart", () => {
    expect(matchText("周一的会议纪要和下周的工作安排", "周排")).toBeNull();
    expect(matchText("笔记", "x")).toBeNull();
    expect(matchText("笔记", "  ")).toBeNull();
  });
});

describe("matchKeywords", () => {
  it("finds aliases, every word of the query", () => {
    expect(matchKeywords("主题 theme dark 深色 夜间", "深色")).toBe(true);
    expect(matchKeywords("主题 theme dark 深色 夜间", "Dark 主题")).toBe(true);
    expect(matchKeywords("主题 theme dark 深色 夜间", "浅色")).toBe(false);
    expect(matchKeywords(undefined, "深色")).toBe(false);
  });
});

describe("snippetAround", () => {
  const content =
    "# 秋季复盘\n\n这一次，我们没有把做得更多当作衡量标准。\n- [ ] 整理访谈中的高频语言";

  it("cuts the line around the first hit and marks it", () => {
    const snippet = snippetAround(content, "衡量")!;
    expect(snippet.text).toBe("…一次，我们没有把做得更多当作衡量标准。");
    expect(snippet.text.slice(...snippet.range)).toBe("衡量");
  });

  it("drops list and heading markers at the start of the line", () => {
    const task = snippetAround(content, "访谈")!;
    expect(task.text).toBe("整理访谈中的高频语言");
    expect(task.text.slice(...task.range)).toBe("访谈");
    expect(snippetAround(content, "秋季")!.text).toBe("秋季复盘");
  });

  it("adds an ellipsis where a long line is cut", () => {
    const long = `开头${"字".repeat(100)}目标${"尾".repeat(100)}`;
    const snippet = snippetAround(long, "目标", { before: 4, max: 12 })!;
    expect(snippet.text).toBe("…字字字字目标尾尾尾尾尾尾…");
    expect(snippet.text.slice(...snippet.range)).toBe("目标");
  });

  it("returns null when the text is not there", () => {
    expect(snippetAround(content, "不存在")).toBeNull();
  });
});
