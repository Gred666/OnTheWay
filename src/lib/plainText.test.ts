import { describe, expect, it } from "vitest";
import { countWords, makeExcerpt } from "./plainText";

// 和 src-tauri/src/domain/search.rs 里的测试是同一张表：两边算出来的摘要要一模一样。
describe("makeExcerpt", () => {
  it.each([
    ["- [x] 已完成的任务\n- [ ] 待办事项", "已完成的任务 待办事项"],
    ["1. 第一步\n2) 第二步", "第一步 第二步"],
    ["见 [官网](https://example.com/a_(b)) 说明", "见 官网 说明"],
    ["![截图|300x200](C:/img/a.png) 和 ![](b.png)", "截图 和"],
    ["[[目标笔记|别名]] 与 [[另一篇#小节]]", "别名 与 另一篇#小节"],
    [
      "<b>粗体</b>第一行<br>第二行 <https://x.dev> <!-- 备注 -->",
      "粗体第一行 第二行 https://x.dev",
    ],
    ["**强调** ==高亮== ~~删除~~ __粗__ `a == b` \\*字面\\*", "强调 高亮 删除 粗 a == b *字面*"],
    ["正文[^1]\n\n[^1]: 脚注内容", "正文 脚注内容"],
    ["## 标题 ##\n## C#\n#话题", "标题 C# #话题"],
    ["> > 嵌套引用\n> - [ ] 引用里的任务", "嵌套引用 引用里的任务"],
    ["| 名称 | 数量 |\n|---|:-:|\n| 苹果 | 3 |", "名称 数量 苹果 3"],
    ["[草稿] 方括号只是文字 a < b", "[草稿] 方括号只是文字 a < b"],
    ["## 标题\n\n> [!核心判断]\n> 结论在这里\n\n正文第一句。", "标题 结论在这里 正文第一句。"],
  ])("%j", (markdown, expected) => {
    expect(makeExcerpt(markdown, 200)).toBe(expected);
  });

  it("skips markup-only lines", () => {
    const markdown =
      "---\ntitle: 周报\ntags: [a]\n---\n[TOC]\n\n```rust\nfn main() {}\n```\n\n" +
      "***\n\n标题\n===\n\n[官网]: https://example.com\n*[HTML]: HyperText\n\n" +
      "<!--\n多行注释\n-->\n正文";
    expect(makeExcerpt(markdown, 200)).toBe("fn main() {} 标题 正文");
  });

  it("does not treat a leading rule as front matter", () => {
    expect(makeExcerpt("---\n正文\n---\n后面", 200)).toBe("正文 后面");
  });

  it("truncates with an ellipsis without splitting emoji", () => {
    expect(makeExcerpt("一二三四五六七八九十", 5)).toBe("一二三四五…");
    expect(makeExcerpt("😀😀😀", 2)).toBe("😀😀…");
  });
});

describe("countWords", () => {
  it("counts CJK characters and English words, not link targets", () => {
    expect(countWords("今天写了 code review")).toBe(6);
    expect(countWords("[官网](https://example.com/a/b/c)")).toBe(2);
    expect(countWords("裸网址 https://example.com/a/b/c")).toBe(4);
    expect(countWords("- [x] done task")).toBe(2);
  });
});
