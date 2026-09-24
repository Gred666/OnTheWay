import { type EditorView, WidgetType } from "@codemirror/view";
import type katex from "katex";
import { positionOf } from "./widgets";

/* ============================================================
   `$…$` / `$$…$$` 的 KaTeX 替身。

   KaTeX 连字体有 300KB 多，只在文档里真的出现公式时才拉；拉到之前替身
   显示原始 TeX（等宽、淡色），拉到后原地渲染再让 CodeMirror 重新量高。
   ============================================================ */

type Katex = typeof katex;

let loaded: Katex | null = null;
let loading: Promise<Katex> | null = null;

export function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => {
      loaded = module.default;
      return loaded;
    },
  );
  return loading;
}

/**
 * 把 TeX 渲染进节点。KaTeX 的输出是它自己生成的标记（用户原文都经过了转义），
 * 所以可以走 innerHTML —— katex.render 内部也是这么做的，只是多了一个
 * 「不在 quirks 模式」的检查，测试用的 happy-dom 没有 doctype 会被它拦下。
 */
function render(engine: Katex, node: HTMLElement, tex: string, display: boolean): void {
  try {
    node.innerHTML = engine.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
    });
    node.classList.remove("is-loading");
  } catch {
    node.textContent = tex;
    node.classList.add("is-error");
    node.title = "公式无法渲染";
  }
}

export class MathWidget extends WidgetType {
  constructor(
    private readonly tex: string,
    private readonly display: boolean,
  ) {
    super();
  }

  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }

  toDOM(view: EditorView) {
    // 块级公式外面再套一层，留白用 padding（见 widgets.ts 文件头的规矩）
    const node = document.createElement(this.display ? "div" : "span");
    node.className = `cm-otw-math is-${this.display ? "block" : "inline"}`;
    node.title = "点击编辑公式";
    node.addEventListener("mousedown", (event) => {
      event.preventDefault();
      // 光标放到开头的 `$` 后面：块级是整行替身，行内是 `$…$` 本身
      const open = this.display ? 2 : 1;
      view.dispatch({ selection: { anchor: positionOf(view, node) + open } });
      view.focus();
    });

    if (loaded) {
      render(loaded, node, this.tex, this.display);
    } else {
      node.classList.add("is-loading");
      node.textContent = this.tex;
      void loadKatex().then((engine) => {
        if (!node.isConnected) return;
        render(engine, node, this.tex, this.display);
        view.requestMeasure();
      });
    }

    if (!this.display) return node;
    const block = document.createElement("div");
    block.className = "cm-otw-math-block";
    block.append(node);
    return block;
  }
}
