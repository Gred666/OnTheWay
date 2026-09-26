// @vitest-environment happy-dom

import { undo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { MotionGlobalConfig } from "motion/react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, clearEditorStateCache } from "./MarkdownEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
MotionGlobalConfig.skipAnimations = true;

/*
 * 按文档缓存编辑器状态：切走再切回来，直接用上次的 EditorState（解析好的语法树、
 * 装饰、撤销历史），不再重新解析全文。
 */

let container: HTMLDivElement;
let root: Root;
const onOutlineHandle = () => {};

beforeEach(() => {
  clearEditorStateCache();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function show(
  markdown: string | null,
  props: {
    cacheKey?: string;
    externalRevision?: number;
    onExternalConflict?: () => void;
    onSave?: (markdown: string) => Promise<void>;
  } = {},
) {
  act(() =>
    root.render(
      markdown === null ? null : (
        <MarkdownEditor
          key={props.cacheKey}
          initialMarkdown={markdown}
          onSave={props.onSave ?? (async () => {})}
          outlineItems={[]}
          onOutlineHandle={onOutlineHandle}
          cacheKey={props.cacheKey}
          externalRevision={props.externalRevision}
          onExternalConflict={props.onExternalConflict}
        />
      ),
    ),
  );
}

const view = () => {
  const editor = container.querySelector<HTMLElement>(".cm-editor");
  expect(editor).not.toBeNull();
  return EditorView.findFromDOM(editor!)!;
};

const type = (text: string) => {
  const current = view();
  current.dispatch({
    changes: { from: current.state.doc.length, insert: text },
    userEvent: "input.type",
  });
};

describe("编辑器状态缓存", () => {
  it("brings back the parsed tree and the undo history for the same document", () => {
    show("# 标题\n\n正文", { cacheKey: "note:a" });
    type("，又写了一句");
    const tree = syntaxTree(view().state);
    const edited = view().state.doc.toString();

    show(null);
    show(edited, { cacheKey: "note:a" });
    expect(view().state.doc.toString()).toBe(edited);
    expect(syntaxTree(view().state)).toBe(tree);
    // 光标回到开头（切换文档时正文也回到顶部）
    expect(view().state.selection.main.head).toBe(0);
    // 撤销历史还在：能撤回切走之前打的字
    expect(undo(view())).toBe(true);
    expect(view().state.doc.toString()).toBe("# 标题\n\n正文");
  });

  it("starts fresh when the text changed while it was away", () => {
    show("原来的", { cacheKey: "note:a" });
    type("，改了");
    show(null);

    show("别处改成了这样", { cacheKey: "note:a" });
    expect(view().state.doc.toString()).toBe("别处改成了这样");
    expect(undo(view())).toBe(false);
  });

  it("keeps each document's state apart", () => {
    show("甲", { cacheKey: "note:a" });
    type("甲");
    show("乙", { cacheKey: "note:b" });
    expect(undo(view())).toBe(false);

    show("甲甲", { cacheKey: "note:a" });
    expect(undo(view())).toBe(true);
    expect(view().state.doc.toString()).toBe("甲");
  });

  it("saves through the new editor, not the one that was cached", async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    show("正文", { cacheKey: "note:a", onSave: first });
    show(null);
    show("正文", { cacheKey: "note:a", onSave: second });

    type("，新的");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(second).toHaveBeenCalledWith("正文，新的");
    expect(first).not.toHaveBeenCalled();
  });
});

describe("外部改动", () => {
  it("applies an external change when there are no local edits", () => {
    const conflict = vi.fn();
    show("原来的", { externalRevision: 0, onExternalConflict: conflict });
    show("别处改的", { externalRevision: 1, onExternalConflict: conflict });
    expect(view().state.doc.toString()).toBe("别处改的");
    expect(conflict).not.toHaveBeenCalled();
  });

  it("keeps local edits and reports a conflict when both sides changed", () => {
    const conflict = vi.fn();
    show("原来的", { externalRevision: 0, onExternalConflict: conflict });
    type("，我在写");
    show("别处改的", { externalRevision: 1, onExternalConflict: conflict });
    expect(view().state.doc.toString()).toBe("原来的，我在写");
    expect(conflict).toHaveBeenCalledTimes(1);
  });

  it("does not mistake its own save coming back for an external change", () => {
    const conflict = vi.fn();
    show("原来的", { externalRevision: 0, onExternalConflict: conflict });
    type("，第一句");
    type("，第二句");
    // 保存了「第一句」那一版，store 回填过来时编辑器里已经多了「第二句」
    show("原来的，第一句", { externalRevision: 0, onExternalConflict: conflict });
    expect(view().state.doc.toString()).toBe("原来的，第一句，第二句");
    expect(conflict).not.toHaveBeenCalled();
  });
});
