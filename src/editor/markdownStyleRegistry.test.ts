import { markdownLanguage } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import {
  markdownSourceStyleRules,
  rulesByNode,
  selectionTouchesRange,
  widgetByNode,
} from "./markdownStyleRegistry";

const syntaxNames = (markdown: string) => {
  const names = new Set<string>();
  markdownLanguage.parser.parse(markdown).iterate({ enter: (node) => void names.add(node.name) });
  return names;
};

describe("Markdown style registry", () => {
  it.each([
    ["~~删除~~", "Strikethrough"],
    ["```ts\nconst value = 1\n```", "FencedCode"],
    ["| A | B |\n|---|---|\n| 1 | 2 |", "Table"],
    ["<kbd>Ctrl</kbd>", "HTMLTag"],
    ["[引用][id]\n\n[id]: https://example.com", "LinkReference"],
  ])("registers styles for %s", (markdown, node) => {
    expect(syntaxNames(markdown).has(node)).toBe(true);
    expect(rulesByNode.has(node)).toBe(true);
  });

  it.each([
    ["- [x] 完成", "TaskMarker"],
    ["---", "HorizontalRule"],
    ["![图片](https://example.com/a.png)", "Image"],
  ])("registers widgets for %s", (markdown, node) => {
    expect(syntaxNames(markdown).has(node)).toBe(true);
    expect(widgetByNode.has(node)).toBe(true);
  });

  it("registers Typora underline as an extensible source rule", () => {
    expect(markdownSourceStyleRules).toContainEqual({
      open: "<u>",
      close: "</u>",
      className: "cm-otw-underline",
    });
  });

  it("reveals markers only when the selection touches that styled span", () => {
    const cursor = (head: number) => [{ from: head, to: head, head, empty: true }];
    expect(selectionTouchesRange(cursor(2), 8, 16)).toBe(false);
    expect(selectionTouchesRange(cursor(10), 8, 16)).toBe(true);
    expect(selectionTouchesRange([{ from: 0, to: 5, head: 5, empty: false }], 8, 16)).toBe(false);
  });
});
