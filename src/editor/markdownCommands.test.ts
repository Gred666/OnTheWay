import type { Command, EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  changeHeadingLevel,
  clearMarkdownFormat,
  commandTarget,
  insertFencedBlock,
  insertLink,
  insertTable,
  setHeading,
  toggleLinePrefix,
  wrapMarkdown,
} from "./markdownCommands";
import { markdownKeymap } from "./markdownKeymap";

function run(command: Command, doc: string, anchor = 0, head = doc.length) {
  const target = commandTarget(doc, { anchor, head });
  expect(command(target as unknown as EditorView)).toBe(true);
  return target.result();
}

describe("Typora-compatible Markdown commands", () => {
  it("wraps and unwraps inline formatting", () => {
    expect(run(wrapMarkdown("**"), "文字")).toBe("**文字**");
    expect(run(wrapMarkdown("**"), "**文字**", 2, 4)).toBe("文字");
    expect(run(wrapMarkdown("<u>", "</u>"), "下划线")).toBe("<u>下划线</u>");
    expect(run(wrapMarkdown("~~"), "第一行\n第二行")).toBe("~~第一行~~\n~~第二行~~");
  });

  it("changes headings across selected lines without touching the next line", () => {
    expect(run(setHeading(3), "一\n二\n三", 0, 4)).toBe("### 一\n### 二\n三");
    expect(run(changeHeadingLevel(-1), "## 标题")).toBe("# 标题");
    expect(run(setHeading(0), "###### 标题")).toBe("标题");
  });

  it("toggles quote and list prefixes", () => {
    const quote = toggleLinePrefix("> ", /^\s*>\s?/);
    expect(run(quote, "一\n二")).toBe("> 一\n> 二");
    expect(run(quote, "> 一\n> 二")).toBe("一\n二");
  });

  it("inserts links, images, code fences and tables", () => {
    expect(run(insertLink(), "官网")).toBe("[官网](url)");
    expect(run(insertLink(true), "封面")).toBe("![封面](url)");
    expect(run(insertFencedBlock(), "const x = 1")).toBe("```\nconst x = 1\n```");
    expect(run(insertTable(), "")).toContain("| --- | --- |");
  });

  it("keeps repeated link shortcuts idempotent", () => {
    const target = commandTarget("官网", { anchor: 0, head: 2 });
    const link = insertLink();
    link(target as unknown as EditorView);
    link(target as unknown as EditorView);
    link(target as unknown as EditorView);
    expect(target.result()).toBe("[官网](url)");
  });

  it("clears common inline and block formatting", () => {
    expect(run(clearMarkdownFormat(), "## **标题**\n> ~~正文~~")).toBe("标题\n正文");
    expect(run(clearMarkdownFormat(), "**粗体**", 3, 3)).toBe("粗体");
    expect(run(clearMarkdownFormat(), "[官网](https://example.com)")).toBe("官网");
    expect(run(clearMarkdownFormat(), "- [x] 完成")).toBe("完成");
  });

  it("registers the documented Typora formatting shortcuts", () => {
    const keys = new Set(markdownKeymap.map((binding) => binding.key));
    for (const key of [
      "Mod-0",
      "Mod-1",
      "Mod-6",
      "Mod-b",
      "Mod-i",
      "Mod-u",
      "Mod-k",
      "Mod-l",
      "Shift-Mod-k",
      "Shift-Mod-q",
      "Shift-Mod-[",
      "Shift-Mod-]",
      "Mod-t",
      "Mod-[",
      "Mod-]",
      "Mod-\\",
    ]) {
      expect(keys.has(key), `${key} 未注册`).toBe(true);
    }
  });
});
