// @vitest-environment happy-dom

import {
  SearchQuery,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
} from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  MATCH_COUNT_LIMIT,
  collectMatches,
  createSearchPanel,
  matchIndex,
  matchLabel,
  scrollToMatch,
} from "./searchPanel";

const views: EditorView[] = [];

function mount(doc: string, anchor = 0) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        search({ top: true, createPanel: createSearchPanel, scrollToMatch }),
        keymap.of(searchKeymap),
        EditorState.phrases.of({ "No results": "无结果", "Invalid regexp": "正则有误" }),
      ],
    }),
  });
  views.push(view);
  return { parent, view };
}

function open(view: EditorView) {
  openSearchPanel(view);
  const panel = view.dom.querySelector<HTMLElement>(".otw-search")!;
  const [find, replace] = panel.querySelectorAll<HTMLInputElement>(".otw-search-input");
  return { panel, find: find!, replace: replace! };
}

const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
};

const press = (target: EventTarget, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

const count = (panel: HTMLElement) => panel.querySelector(".otw-search-count")?.textContent;
const selected = (view: EditorView) => {
  const { from, to } = view.state.selection.main;
  return [from, to];
};

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

describe("计数", () => {
  const state = EditorState.create({ doc: "猫 狗 猫 鱼 猫" });
  const query = new SearchQuery({ search: "猫" });

  it("collects every match and finds which one the selection sits on", () => {
    const matches = collectMatches(state, query);
    expect(matches).toEqual([
      { from: 0, to: 1 },
      { from: 4, to: 5 },
      { from: 8, to: 9 },
    ]);
    expect(matchIndex(matches, EditorSelection.range(4, 5))).toBe(2);
    expect(matchIndex(matches, EditorSelection.range(4, 4))).toBe(0);
    expect(matchIndex(matches, EditorSelection.cursor(3))).toBe(0);
  });

  it("labels the count, the empty case and a broken regexp", () => {
    const phrases = EditorState.create({
      extensions: EditorState.phrases.of({ "No results": "无结果", "Invalid regexp": "正则有误" }),
    });
    const matches = collectMatches(state, query);
    expect(matchLabel(phrases, query, matches, 2)).toEqual({ text: "2/3", empty: false });
    expect(matchLabel(phrases, query, matches, 0)).toEqual({ text: "3", empty: false });
    expect(matchLabel(phrases, new SearchQuery({ search: "" }), [], 0).text).toBe("");
    expect(matchLabel(phrases, new SearchQuery({ search: "虎" }), [], 0)).toEqual({
      text: "无结果",
      empty: true,
    });
    const broken = new SearchQuery({ search: "(", regexp: true });
    expect(matchLabel(phrases, broken, [], 0)).toEqual({ text: "正则有误", empty: true });
  });

  it("stops counting past the limit", () => {
    const many = EditorState.create({ doc: "a".repeat(MATCH_COUNT_LIMIT + 50) });
    const matches = collectMatches(many, new SearchQuery({ search: "a" }));
    expect(matches).toHaveLength(MATCH_COUNT_LIMIT + 1);
    expect(matchLabel(many, new SearchQuery({ search: "a" }), matches, 1).text).toBe(
      `1/${MATCH_COUNT_LIMIT}+`,
    );
  });
});

describe("查找面板", () => {
  it("opens as a floating panel with the query field focused", () => {
    const { view } = mount("一段文字");
    const { panel, find } = open(view);
    expect(searchPanelOpen(view.state)).toBe(true);
    expect(panel.getAttribute("role")).toBe("search");
    expect(find.hasAttribute("main-field")).toBe(true);
    expect(document.activeElement).toBe(find);
    // 替换默认折起来
    expect(panel.querySelector<HTMLElement>(".otw-search-replace")!.hidden).toBe(true);
  });

  it("searches as you type and counts the matches", () => {
    const { view } = mount("猫 狗 猫 鱼 猫");
    const { panel, find } = open(view);
    type(find, "猫");
    expect(count(panel)).toBe("3");
    type(find, "虎");
    expect(count(panel)).toBe("无结果");
    expect(panel.querySelector(".otw-search-box")!.classList.contains("is-empty")).toBe(true);
  });

  it("waits for the input method to finish composing", () => {
    const { view } = mount("猫 狗 猫");
    const { panel, find } = open(view);
    find.value = "mao";
    find.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    expect(count(panel)).toBe("");
    find.value = "猫";
    find.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(count(panel)).toBe("2");
  });

  it("steps through matches with Enter / Shift+Enter and shows where it is", () => {
    const { view } = mount("猫 狗 猫 鱼 猫");
    const { panel, find } = open(view);
    type(find, "猫");
    press(find, { key: "Enter" });
    expect(selected(view)).toEqual([0, 1]);
    expect(count(panel)).toBe("1/3");
    press(find, { key: "Enter" });
    expect(selected(view)).toEqual([4, 5]);
    expect(count(panel)).toBe("2/3");
    press(find, { key: "Enter", shiftKey: true });
    expect(selected(view)).toEqual([0, 1]);
    // 跳完光标还在原处，接着打字是补字而不是把整个关键词换掉
    expect([find.selectionStart, find.selectionEnd]).toEqual([1, 1]);
  });

  it("ignores Enter while the input method is composing", () => {
    const { view } = mount("猫 狗 猫");
    const { find } = open(view);
    type(find, "猫");
    press(find, { key: "Enter", isComposing: true });
    expect(selected(view)).toEqual([0, 0]);
  });

  it("toggles case, whole word and regexp from the buttons and with Alt+C / W / R", () => {
    const { view } = mount("Cat cat category");
    const { panel, find } = open(view);
    type(find, "cat");
    expect(count(panel)).toBe("3");
    const toggle = (option: string) =>
      panel.querySelector<HTMLButtonElement>(`[data-option="${option}"]`)!;
    toggle("caseSensitive").click();
    expect(toggle("caseSensitive").getAttribute("aria-pressed")).toBe("true");
    expect(count(panel)).toBe("2");
    press(find, { key: "w", code: "KeyW", altKey: true });
    expect(toggle("wholeWord").getAttribute("aria-pressed")).toBe("true");
    expect(count(panel)).toBe("1");
    press(find, { key: "r", code: "KeyR", altKey: true });
    expect(toggle("regexp").getAttribute("aria-pressed")).toBe("true");
    type(find, "c.t");
    expect(count(panel)).toBe("1");
  });

  it("replaces one or all from the replace row", () => {
    const { view } = mount("猫 狗 猫");
    const { panel, find, replace } = open(view);
    panel.querySelector<HTMLButtonElement>(".otw-search-expand")!.click();
    expect(panel.querySelector<HTMLElement>(".otw-search-replace")!.hidden).toBe(false);
    expect(document.activeElement).toBe(replace);
    type(find, "猫");
    type(replace, "虎");
    press(replace, { key: "Enter" });
    press(replace, { key: "Enter" });
    expect(view.state.doc.toString()).toBe("虎 狗 猫");
    press(replace, { key: "Enter", ctrlKey: true });
    expect(view.state.doc.toString()).toBe("虎 狗 虎");
  });

  it("closes with Escape and hands focus back to the text", () => {
    const { view } = mount("一段文字");
    const { find } = open(view);
    press(find, { key: "Escape" });
    expect(searchPanelOpen(view.state)).toBe(false);
    expect(view.dom.querySelector(".otw-search")).toBeNull();
  });

  it("follows a query set from outside (Mod-F on a selection)", () => {
    const { view } = mount("甲 乙 甲", 0);
    const { panel, find } = open(view);
    view.dispatch({ selection: { anchor: 2, head: 3 } });
    // 焦点回到了别处，再按 Mod-F：用选中的字当关键词
    find.blur();
    openSearchPanel(view);
    expect(find.value).toBe("乙");
    expect(count(panel)).toBe("1/1");
  });
});
