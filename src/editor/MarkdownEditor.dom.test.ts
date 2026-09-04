// @vitest-environment happy-dom

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { typoraDecorations } from "./MarkdownEditor";
import { markdownKeymap } from "./markdownKeymap";

const views: EditorView[] = [];

function mount(doc: string, anchor: number) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        markdown({ base: markdownLanguage }),
        typoraDecorations,
        keymap.of(markdownKeymap),
      ],
    }),
  });
  views.push(view);
  return { parent, view };
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

describe("Typora DOM decorations", () => {
  it("reveals strike markers only inside the styled span", () => {
    const { parent, view } = mount("开头 ~~删除~~ 结尾", 1);
    expect(parent.querySelectorAll(".cm-otw-syntax-marker")).toHaveLength(0);
    expect(parent.querySelector(".cm-content")?.textContent).toBe("开头 删除 结尾");

    view.dispatch({ selection: { anchor: 7 } });
    expect(parent.querySelectorAll(".cm-otw-syntax-marker")).toHaveLength(2);
    expect(parent.querySelector(".cm-content")?.textContent).toBe("开头 ~~删除~~ 结尾");
  });

  it("makes hidden markers atomic without making styled text unclickable", () => {
    const { view } = mount("前 **粗体** 后", 0);
    const atomic: [number, number][] = [];
    view.state.field(typoraDecorations).atomic.between(0, view.state.doc.length, (from, to) => {
      atomic.push([from, to]);
    });
    expect(atomic).toEqual([
      [2, 4],
      [6, 8],
    ]);
    expect(atomic).not.toContainEqual([4, 6]);
  });

  it("folds inactive heading marks without reserving progressively wider gaps", () => {
    const source = "# 一级\n## 二级\n### 三级";
    const { parent, view } = mount(source, source.length);
    expect([...parent.querySelectorAll(".cm-line")].map((line) => line.textContent)).toEqual([
      "一级",
      "二级",
      "### 三级",
    ]);

    view.dispatch({ selection: { anchor: 0 } });
    expect(parent.querySelector(".cm-otw-syntax-marker")?.textContent).toBe("# ");
  });

  it("renders list markers and task markers without duplicate markdown bullets", () => {
    const source = "- 普通\n1. 有序\n- [x] 完成\n\n尾部";
    const { parent, view } = mount(source, source.length);
    expect(
      [...parent.querySelectorAll(".cm-otw-list-marker")].map((node) => node.textContent),
    ).toEqual(["•", "1."]);
    expect(parent.querySelector(".cm-otw-task")?.textContent).toBe("✓");
    expect(parent.querySelectorAll(".cm-line")[2]?.textContent).not.toContain("-");

    parent
      .querySelector(".cm-otw-task")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.state.doc.toString()).toContain("- [ ] 完成");
  });

  it("shows fenced code language as a compact inactive label", () => {
    const source = "```ts\nconst value = 1;\n```\n\n之后";
    const { parent } = mount(source, source.length);
    expect(parent.querySelector(".cm-otw-code-info")?.textContent).toBe("ts");
    expect(parent.querySelectorAll(".cm-otw-code-block")[0]?.textContent).toBe("ts");
  });

  it("renders an inactive GFM table as a real table", () => {
    const source = "| 左 | 右 |\n| --- | ---: |\n| A | B |\n\n表格之后";
    const { parent } = mount(source, source.length);
    const table = parent.querySelector<HTMLTableElement>(".cm-otw-table-widget");
    expect(table).not.toBeNull();
    expect([...table!.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual([
      "左",
      "右",
    ]);
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(1);

    table!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(parent.querySelector(".cm-otw-table-widget")).toBeNull();
    expect(parent.querySelector(".cm-content")?.textContent).toContain("| 左 | 右 |");
  });

  it("runs clear-format and repeated-link shortcuts through the DOM keymap", () => {
    const formatted = mount("**粗体**", 3).view;
    formatted.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "\\", ctrlKey: true, bubbles: true }),
    );
    expect(formatted.state.doc.toString()).toBe("粗体");

    const link = mount("官网", 0).view;
    link.dispatch({ selection: { anchor: 0, head: 2 } });
    for (let index = 0; index < 3; index += 1) {
      link.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      );
    }
    expect(link.state.doc.toString()).toBe("[官网](url)");
  });

  it("applies inline shortcuts safely across lines", () => {
    const { view } = mount("第一行\n第二行", 0);
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true }),
    );
    expect(view.state.doc.toString()).toBe("**第一行**\n**第二行**");
  });
});
