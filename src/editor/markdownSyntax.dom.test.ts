// @vitest-environment happy-dom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { resolveImage, typoraDecorations } from "./MarkdownEditor";
import { linkTargetAt, wikiTargetAt } from "./links";
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
      extensions: [markdownSupport(), typoraDecorations],
    }),
  });
  views.push(view);
  return { parent, view };
}

const lines = (parent: HTMLElement) =>
  [...parent.querySelectorAll(".cm-line")].map((line) => line.textContent);
const text = (parent: HTMLElement) => parent.querySelector(".cm-content")?.textContent;

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

describe("行内小语法", () => {
  it("renders <sub> and ^superscript^ with hidden marks", () => {
    const { parent, view } = mount("H<sub>2</sub>O 和 x^2^ 完", 999);
    expect(parent.querySelector(".cm-otw-sub")?.textContent).toBe("2");
    expect(parent.querySelector(".cm-otw-sup")?.textContent).toBe("2");
    expect(text(parent)).toBe("H2O 和 x2 完");

    view.dispatch({ selection: { anchor: 2 } });
    expect(text(parent)).toBe("H<sub>2</sub>O 和 x2 完");
  });

  it("treats a single ~ as strikethrough, like GitHub", () => {
    const { parent } = mount("~a~ 和 ~~b~~ 完", 999);
    expect([...parent.querySelectorAll(".cm-otw-strike")].map((n) => n.textContent)).toEqual([
      "a",
      "b",
    ]);
    expect(text(parent)).toBe("a 和 b 完");
  });

  it("swaps known emoji shortcodes for the glyph and leaves unknown ones alone", () => {
    const { parent } = mount("好 :smile: :nope: 完", 999);
    expect(parent.querySelector(".cm-otw-glyph.is-emoji")?.textContent).toBe("😄");
    expect(text(parent)).toBe("好 😄 :nope: 完");
  });

  it("decodes entities and reveals the source when the cursor is inside", () => {
    const { parent, view } = mount("A &amp; B &#8212; C", 0);
    expect(text(parent)).toBe("A & B — C");
    view.dispatch({ selection: { anchor: 4 } });
    expect(text(parent)).toBe("A &amp; B — C");
  });

  it("hides the escape backslash only", () => {
    const { parent, view } = mount("不是\\*斜体\\* 完", 0);
    expect(text(parent)).toBe("不是*斜体* 完");
    view.dispatch({ selection: { anchor: 3 } });
    expect(text(parent)).toBe("不是\\*斜体* 完");
  });

  it("marks hard breaks with a glyph without merging lines", () => {
    const { parent } = mount("第一行  \n第二行\\\n第三行", 999);
    expect(parent.querySelectorAll(".cm-otw-hard-break")).toHaveLength(2);
    expect(lines(parent)).toEqual(["第一行↵", "第二行↵", "第三行"]);
  });

  it("keeps pairing ==highlight== after a Setext underline or code full of equals", () => {
    const source = "标题\n=====\n\n`a==b` 和 ==真高亮== 完\n\n==又一个== 尾";
    const { parent } = mount(source, source.length);
    expect([...parent.querySelectorAll(".cm-otw-highlight")].map((n) => n.textContent)).toEqual([
      "真高亮",
      "又一个",
    ]);
    expect(lines(parent)).toEqual(["标题", "", "a==b 和 真高亮 完", "", "又一个 尾"]);
  });

  it("highlights ==text== but not spaced equals", () => {
    const { parent } = mount("a ==重点== b 而 x == y == z 不算", 999);
    expect(parent.querySelector(".cm-otw-highlight")?.textContent).toBe("重点");
    expect(parent.querySelectorAll(".cm-otw-highlight")).toHaveLength(1);
    expect(text(parent)).toBe("a 重点 b 而 x == y == z 不算");
  });
});

describe("方括号家族", () => {
  it("styles [[wikilinks]], hides the brackets and honours aliases", () => {
    const { parent, view } = mount("看 [[我的笔记]] 和 [[目标|别名]] 完", 999);
    expect([...parent.querySelectorAll(".cm-otw-wikilink")].map((n) => n.textContent)).toEqual([
      "我的笔记",
      "别名",
    ]);
    expect(text(parent)).toBe("看 我的笔记 和 别名 完");
    expect(wikiTargetAt(view.state, 4)).toBe("我的笔记");
    expect(wikiTargetAt(view.state, 16)).toBe("目标");

    view.dispatch({ selection: { anchor: 4 } });
    expect(text(parent)).toBe("看 [[我的笔记]] 和 别名 完");
  });

  it("treats plain [brackets] as text unless a reference definition exists", () => {
    const plain = mount("见 [附录] 完", 999);
    expect(plain.parent.querySelector(".cm-otw-link")).toBeNull();
    expect(text(plain.parent)).toBe("见 [附录] 完");

    const defined = mount("见 [附录] 完\n\n[附录]: https://example.com", 999);
    expect(defined.parent.querySelector(".cm-otw-link")?.textContent).toBe("附录");
    expect(linkTargetAt(defined.view.state, 3)).toBe("https://example.com");
  });

  it("renders footnote references and definitions as badges", () => {
    const { parent, view } = mount("正文[^1] 完\n\n[^1]: 注释内容", 0);
    const badges = [...parent.querySelectorAll(".cm-otw-footnote")];
    expect(badges.map((n) => n.className)).toEqual([
      "cm-otw-footnote is-ref",
      "cm-otw-footnote is-def",
    ]);
    expect(lines(parent)).toEqual(["正文1 完", "", "1注释内容"]);
    expect(parent.querySelector(".cm-line.cm-otw-footnote-def")).not.toBeNull();

    view.dispatch({ selection: { anchor: 3 } });
    expect(lines(parent)[0]).toBe("正文[^1] 完");
  });

  it("renders back-to-back footnotes in Chinese prose as badges, not superscript", () => {
    const { parent } = mount("正文[^1]，接着写[^long]。\n\n[^1]: 甲\n[^long]: 乙", 0);
    const badges = [...parent.querySelectorAll(".cm-otw-footnote")];
    expect(badges.map((n) => n.className)).toEqual([
      "cm-otw-footnote is-ref",
      "cm-otw-footnote is-ref",
      "cm-otw-footnote is-def",
      "cm-otw-footnote is-def",
    ]);
    expect(parent.querySelector(".cm-otw-sup")).toBeNull();
    expect(lines(parent)).toEqual(["正文1，接着写long。", "", "1甲", "long乙"]);
  });

  it("hides the link title together with the destination", () => {
    const { parent, view } = mount('[官网](https://x.dev "标题") 完', 999);
    expect(text(parent)).toBe("官网 完");
    expect(parent.querySelector(".cm-otw-link")?.getAttribute("title")).toContain("https://x.dev");
    expect(linkTargetAt(view.state, 1)).toBe("https://x.dev");
  });
});

describe("块级构造", () => {
  it("turns `> [!TIP]` into a callout with a badge and coloured lines", () => {
    const source = "> [!TIP]\n> 多喝水\n\n之后";
    const { parent, view } = mount(source, source.length);
    expect(parent.querySelector(".cm-otw-callout-badge.is-tip")?.textContent).toBe("TIP");
    expect(parent.querySelectorAll(".cm-line.cm-otw-callout.is-tip")).toHaveLength(2);
    expect(parent.querySelector(".cm-line.cm-otw-callout-head")).not.toBeNull();
    expect(parent.querySelector(".cm-line.cm-otw-callout-tail")).not.toBeNull();
    expect(parent.querySelector(".cm-line.cm-otw-quote")).toBeNull();
    expect(lines(parent)).toEqual(["TIP", "多喝水", "", "之后"]);

    view.dispatch({ selection: { anchor: 3 } });
    expect(parent.querySelector(".cm-otw-callout-badge")).toBeNull();
    expect(lines(parent)[0]).toBe("> [!TIP]");
  });

  it("maps Chinese labels to the generic callout", () => {
    const { parent } = mount("> [!核心判断]\n> 结论", 999);
    expect(parent.querySelector(".cm-otw-callout-badge.is-generic")?.textContent).toBe("核心判断");
  });

  it("indents nested blockquotes by depth", () => {
    const { parent } = mount("> 一层\n> > 两层\n> > > 三层\n\n后", 999);
    expect(parent.querySelectorAll(".cm-line.cm-otw-quote-d1")).toHaveLength(3);
    expect(parent.querySelectorAll(".cm-line.cm-otw-quote-d2")).toHaveLength(2);
    expect(parent.querySelectorAll(".cm-line.cm-otw-quote-d3")).toHaveLength(1);
    expect(lines(parent)).toEqual(["一层", "两层", "三层", "", "后"]);
  });

  it("folds front matter fences and never treats its keys as headings", () => {
    const source = "---\ntitle: 笔记\ntags: [a]\n---\n\n# 正文";
    const { parent, view } = mount(source, source.length);
    expect(parent.querySelectorAll(".cm-otw-frontmatter-fence")).toHaveLength(2);
    expect(parent.querySelector(".cm-otw-frontmatter-label")?.textContent).toBe("属性");
    expect(parent.querySelectorAll(".cm-line.cm-otw-frontmatter")).toHaveLength(2);
    expect(parent.querySelector(".cm-otw-h2")).toBeNull();
    expect(parent.querySelector(".cm-otw-hr")).toBeNull();
    expect(parent.querySelectorAll(".cm-otw-h1")).toHaveLength(1);

    view.dispatch({ selection: { anchor: 6 } });
    expect(parent.querySelectorAll(".cm-otw-frontmatter-fence")).toHaveLength(0);
    expect(lines(parent).slice(0, 4)).toEqual(["---", "title: 笔记", "tags: [a]", "---"]);
    // 露出来的 `---` 和封口一样高（globals.css），点进属性块时正文不跳
    expect(parent.querySelector(".cm-otw-frontmatter-fence-line.is-open")?.textContent).toBe("---");
    expect(parent.querySelector(".cm-otw-frontmatter-fence-line.is-close")?.textContent).toBe(
      "---",
    );
  });

  it("keeps front matter folded when a fresh editor sits at position 0", () => {
    // 新挂载的编辑器光标停在 0，不能算「点进了属性块」
    const { parent } = mount("---\ntitle: 笔记\n---\n\n正文", 0);
    expect(parent.querySelectorAll(".cm-otw-frontmatter-fence")).toHaveLength(2);
  });

  it("does not mistake a leading horizontal rule for front matter", () => {
    const { parent } = mount("---\n\n正文", 999);
    expect(parent.querySelector(".cm-otw-frontmatter-fence")).toBeNull();
    expect(parent.querySelector(".cm-otw-hr")).not.toBeNull();
  });

  it("replaces [TOC] with a clickable table of contents", () => {
    const source = "[TOC]\n\n# 一\n\n## 二 **粗**\n\n### 三";
    const { parent, view } = mount(source, source.length);
    const items = [...parent.querySelectorAll(".cm-otw-toc-item button")];
    expect(items.map((n) => n.textContent)).toEqual(["一", "二 粗", "三"]);
    expect(
      [...parent.querySelectorAll<HTMLElement>(".cm-otw-toc-item")].map((n) =>
        n.style.getPropertyValue("--depth"),
      ),
    ).toEqual(["0", "1", "2"]);

    items[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("## 二 **粗**");

    view.dispatch({ selection: { anchor: 0 } });
    expect(parent.querySelector(".cm-otw-toc")).toBeNull();
    expect(lines(parent)[0]).toBe("[TOC]");
  });

  it("renders inline formatting inside table cells", () => {
    const source = "| A | B |\n|---|---|\n| **粗** `x` | [[双链]] ==高== |\n\n后";
    const { parent } = mount(source, source.length);
    const table = parent.querySelector(".cm-otw-table-widget")!;
    expect(table.querySelector("td strong")?.textContent).toBe("粗");
    expect(table.querySelector("td code")?.textContent).toBe("x");
    expect(table.querySelector("td .cm-otw-wikilink")?.textContent).toBe("双链");
    expect(table.querySelector("td mark")?.textContent).toBe("高");
    expect(table.querySelector("td")?.textContent).toBe("粗 x");
  });

  it("gives the copy button the code text", () => {
    const source = "```ts\nconst a = 1;\nconst b = 2;\n```\n\n后";
    const { parent } = mount(source, source.length);
    expect(parent.querySelector(".cm-otw-code-copy")?.getAttribute("aria-label")).toBe("复制代码");
    expect(parent.querySelector(".cm-otw-code-lang")?.textContent).toBe("ts");
  });

  it("renders html blocks as sanitized DOM and shows the source when active", () => {
    const { parent, view } = mount("<div>\n<u>x</u>\n</div>\n\n后", 999);
    const widget = parent.querySelector(".cm-otw-html-widget");
    expect(widget?.querySelector("div > u")?.textContent).toBe("x");
    expect(lines(parent)).toEqual(["", "后"]);

    view.dispatch({ selection: { anchor: 8 } });
    expect(parent.querySelector(".cm-otw-html-widget")).toBeNull();
    expect(parent.querySelectorAll(".cm-line.cm-otw-html-block")).toHaveLength(3);
  });
});

describe("resolveImage", () => {
  it("parses title and Obsidian-style sizes", () => {
    expect(resolveImage("", '![图|300x200](a.png "说明")')).toEqual({
      alt: "图",
      source: "a.png",
      title: "说明",
      width: 300,
      height: 200,
    });
    expect(resolveImage("", "![图|480](a.png)")).toMatchObject({ width: 480, height: null });
    expect(resolveImage('[ref]: <b.png> "t"', "![x][ref]")).toMatchObject({
      source: "b.png",
      title: "t",
    });
  });
});
