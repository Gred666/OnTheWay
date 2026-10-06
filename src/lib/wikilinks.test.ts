import { describe, expect, it } from "vitest";
import {
  contextLine,
  findWikiLinks,
  sameTitle,
  splitWikiSegments,
  wikiDisplayText,
  wikiTargetTitle,
} from "./wikilinks";

/* 和 Rust 侧 src-tauri/src/vault/links.rs 的测试同一组用例：两边认的双链必须一样 */
describe("双链", () => {
  const titles = (body: string) => findWikiLinks(body).map((hit) => hit.title);

  it("finds every form of wikilink", () => {
    const body =
      "看 [[周报]] 和 [[周报|上周的]]，跳到 [[周报#结论]]、[[周报^abc]]\n第二行 [[ 京都书店清单 ]]";
    expect(titles(body)).toEqual(["周报", "周报", "周报", "周报", "京都书店清单"]);
    expect(findWikiLinks(body)[4]!.line).toBe(1);
  });

  it("skips code and escapes", () => {
    const body =
      "```\n[[代码里的]]\n```\n`[[行内代码]]` 真的 [[链接]]\n\\[[转义]]\n~~~md\n[[也是代码]]\n~~~";
    expect(titles(body)).toEqual(["链接"]);
  });

  it("ignores broken brackets", () => {
    expect(titles("[[没有结尾")).toEqual([]);
    expect(titles("[[a [b] c]]")).toEqual([]);
    expect(titles("[[]] [[|别名]]")).toEqual([]);
  });

  it("splits target, alias and display text", () => {
    expect(wikiTargetTitle("周报|上周的")).toBe("周报");
    expect(wikiTargetTitle("周报#结论")).toBe("周报");
    expect(wikiDisplayText("周报|上周的")).toBe("上周的");
    expect(wikiDisplayText("周报#结论")).toBe("周报#结论");
    expect(sameTitle(" Weekly Notes ", "weekly notes")).toBe(true);
    expect(sameTitle("周报", "周报 2")).toBe(false);
  });

  it("splits a line into text and links", () => {
    expect(splitWikiSegments("回看 [[周报|上周的]] 的结论")).toEqual([
      { kind: "text", text: "回看 " },
      { kind: "link", inner: "周报|上周的" },
      { kind: "text", text: " 的结论" },
    ]);
  });

  it("trims list markers, task boxes, quotes and headings from context lines", () => {
    expect(contextLine("- [ ] 回看 [[周报]] 的结论")).toBe("回看 [[周报]] 的结论");
    expect(contextLine("> ## 参考 [[周报]]")).toBe("参考 [[周报]]");
    expect(contextLine("3. 见 [[周报]]")).toBe("见 [[周报]]");
  });
});
