// @vitest-environment happy-dom

import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { typoraDecorations } from "./MarkdownEditor";
import { markdownKeymap } from "./markdownKeymap";
import { markdownSupport } from "./markdownParser";

const views: EditorView[] = [];

function mount(doc: string, anchor: number) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: Math.min(anchor, doc.length) },
      extensions: [
        markdownSupport(),
        typoraDecorations,
        keymap.of(markdownKeymap),
      ],
    }),
  });
  views.push(view);
  return { parent, view };
}

const lines = (parent: HTMLElement) =>
  [...parent.querySelectorAll(".cm-line")].map((line) => line.textContent);

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
    // 原子区间现在由两层共同提供（块级 StateField + 行内 ViewPlugin），
    // 从 facet 读才能看到用户实际感受到的那一份。
    const atomic: [number, number][] = [];
    for (const source of view.state.facet(EditorView.atomicRanges)) {
      source(view).between(0, view.state.doc.length, (from, to) => {
        atomic.push([from, to]);
      });
    }
    atomic.sort((a, b) => a[0] - b[0]);
    expect(atomic).toEqual([
      [2, 4],
      [6, 8],
    ]);
    expect(atomic).not.toContainEqual([4, 6]);
  });

  it("folds inactive heading marks without reserving progressively wider gaps", () => {
    const source = "# 一级\n## 二级\n### 三级";
    const { parent, view } = mount(source, source.length);
    expect(lines(parent)).toEqual(["一级", "二级", "### 三级"]);

    view.dispatch({ selection: { anchor: 0 } });
    expect(parent.querySelector(".cm-otw-syntax-marker")?.textContent).toBe("# ");
  });

  it("renders list markers and task markers without duplicate markdown bullets", () => {
    const source = "- 普通\n1. 有序\n- [x] 完成\n\n尾部";
    const { parent, view } = mount(source, source.length);
    expect(
      [...parent.querySelectorAll(".cm-otw-list-marker")].map((node) => node.textContent),
    ).toEqual(["•", "1."]);
    // 对勾现在是一条 SVG 路径，不再是 ✓ 字符
    expect(parent.querySelector(".cm-otw-task")?.getAttribute("aria-checked")).toBe("true");
    expect(parent.querySelector(".cm-otw-task.is-checked .cm-otw-task-check")).not.toBeNull();
    expect(parent.querySelectorAll(".cm-line")[2]?.textContent).not.toContain("-");

    parent
      .querySelector(".cm-otw-task")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.state.doc.toString()).toContain("- [ ] 完成");
  });

  it("does not leave an indent gap in front of a task checkbox", () => {
    // 「- 」整段藏掉，勾选框应该顶在行首，而不是被列表符号留下的空格顶开。
    const { parent } = mount("- [x] 完成\n\n尾部", 999);
    expect(parent.querySelectorAll(".cm-line")[0]?.textContent).toBe(" 完成");
    expect(parent.querySelectorAll(".cm-line")[0]?.querySelector(".cm-otw-task")).not.toBeNull();
  });

  it("folds both fence lines and keeps the language as a compact label", () => {
    // 以前只藏 ``` 三个字符，代码块上下各留一条莫名其妙的空行。
    const source = "```ts\nconst value = 1;\n```\n\n之后";
    const { parent } = mount(source, source.length);
    expect(lines(parent)).toEqual(["const value = 1;", "", "之后"]);
    expect(parent.querySelector(".cm-otw-code-lang")?.textContent).toBe("ts");
    expect(parent.querySelectorAll(".cm-otw-code-fence")).toHaveLength(2);
  });

  it("keeps an empty fence reachable instead of folding it out of existence", () => {
    const { parent } = mount("```\n```\n\n后", 999);
    expect(parent.querySelectorAll(".cm-otw-code-fence")).toHaveLength(0);
  });

  it("folds the Setext underline row instead of leaving a blank line", () => {
    const { parent } = mount("标题\n===\n\n正文", 999);
    expect(lines(parent)).toEqual(["标题", "", "正文"]);
    expect(parent.querySelectorAll(".cm-otw-h1")).toHaveLength(1);
  });

  it("replaces a horizontal rule row without leaving the source line behind", () => {
    const { parent } = mount("上\n\n---\n\n下", 0);
    expect(parent.querySelectorAll(".cm-otw-hr")).toHaveLength(1);
    expect(lines(parent)).toEqual(["上", "", "", "下"]);
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

  it("underlines <u> only inside one block", () => {
    const { parent } = mount("前 <u>下划线</u> 后", 0);
    expect(parent.querySelector(".cm-otw-underline")?.textContent).toBe("下划线");
    expect(lines(parent)).toEqual(["前 下划线 后"]);
  });

  it("never pairs <u> across a blank line", () => {
    // 以前是全文 indexOf，两个不相干段落里的 <u> 和 </u> 会被配成一对，
    // 两个标签双双消失，中间整段被画上下划线。
    const { parent } = mount("段落一 <u>下划线\n\n段落二 </u> 结束", 0);
    expect(parent.querySelectorAll(".cm-otw-underline")).toHaveLength(0);
    expect(lines(parent)).toEqual(["段落一 <u>下划线", "", "段落二 </u> 结束"]);
  });

  it("leaves <u> inside code untouched", () => {
    const fenced = mount("```html\n<u>x</u>\n```\n\n之后", 999);
    expect(fenced.parent.querySelectorAll(".cm-otw-underline")).toHaveLength(0);
    expect(lines(fenced.parent)).toEqual(["<u>x</u>", "", "之后"]);

    const inline = mount("看 `<u>x</u>` 结束", 0);
    expect(inline.parent.querySelectorAll(".cm-otw-underline")).toHaveLength(0);
    expect(lines(inline.parent)).toEqual(["看 <u>x</u> 结束"]);
  });

  it("runs clear-format and repeated-link shortcuts through the DOM keymap", () => {
    const formatted = mount("**粗体**", 3).view;
    formatted.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "\\", ctrlKey: true, bubbles: true }),
    );
    expect(formatted.state.doc.toString()).toBe("粗体");

    // 插入链接从 Mod-K 挪到了 Shift-Mod-K —— Mod-K 要留给全局命令面板。
    const link = mount("官网", 0).view;
    link.dispatch({ selection: { anchor: 0, head: 2 } });
    for (let index = 0; index < 3; index += 1) {
      link.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, shiftKey: true, bubbles: true }),
      );
    }
    expect(link.state.doc.toString()).toBe("[官网](url)");
  });

  it("lets Mod-K through to the window so the command palette still opens", () => {
    const view = mount("正文", 1).view;
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true });
    view.contentDOM.dispatchEvent(event);
    expect(view.state.doc.toString()).toBe("正文");
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
