// @vitest-environment happy-dom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

// 桌面端才会把本机路径转成 asset 协议；这个文件整体按 Tauri 环境跑。
vi.mock("@/lib/tauri", () => ({ isTauri: true }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

const { resolveImageSource } = await import("./html");
const { typoraDecorations } = await import("./MarkdownEditor");
const { markdownSupport } = await import("./markdownParser");

afterEach(() => {
  document.body.replaceChildren();
});

describe("本机图片（桌面端）", () => {
  it("decodes escaped file:// paths", () => {
    expect(resolveImageSource("file:///C:/pics/a%20b.png")).toBe(
      `asset://localhost/${encodeURIComponent("C:/pics/a b.png")}`,
    );
  });

  it("keeps the leading slash of macOS / Linux file:// paths", () => {
    const asset = (path: string) => `asset://localhost/${encodeURIComponent(path)}`;
    expect(resolveImageSource("file:///Users/me/a.png")).toBe(asset("/Users/me/a.png"));
    expect(resolveImageSource("file://localhost/home/me/a.png")).toBe(asset("/home/me/a.png"));
    expect(resolveImageSource("file://C:/pics/a.png")).toBe(asset("C:/pics/a.png"));
    expect(resolveImageSource("/Users/me/a.png")).toBe(asset("/Users/me/a.png"));
  });

  it("keeps a bare % in a file:// path instead of throwing", () => {
    expect(resolveImageSource("file:///C:/pics/100%.png")).toBe(
      `asset://localhost/${encodeURIComponent("C:/pics/100%.png")}`,
    );
  });

  it("does not crash inline decorations for the whole note", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const doc = "**粗体**\n\n![图](file:///C:/pics/100%.png)\n\n*斜体*";
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [markdownSupport(), typoraDecorations],
      }),
    });
    expect(parent.querySelector(".cm-otw-strong")?.textContent).toBe("粗体");
    expect(parent.querySelector("img.cm-otw-image")).not.toBeNull();
    view.destroy();
  });
});
