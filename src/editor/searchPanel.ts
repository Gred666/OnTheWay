import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorState, SelectionRange } from "@codemirror/state";
import { EditorView, type Panel, type ViewUpdate, runScopeHandlers } from "@codemirror/view";

/* ============================================================
   查找 / 替换面板（Mod-F）。

   CodeMirror 自带的面板是一排原生复选框和按钮，挤在编辑器顶上、占着文档流：
   一打开整篇正文往下推一百来像素，关掉再弹回去；控件换行也没有规律，
   「全部」选中所有匹配项在不允许多选区的编辑器里只剩一个，匹配到的位置常常
   贴着视口边缘。这里换成自己的面板：

   - 浮在正文右上角，不占文档流（外层 .cm-panels 高度为 0、sticky 贴顶），开关不推正文
   - 一行：输入框（带「第几个 / 共几个」）、大小写 / 全词 / 正则三个开关、上一个 / 下一个、
     展开替换、关闭；替换是折叠的第二行
   - 边打边搜（输入法组字期间不搜，组完再搜）；没有结果、正则写错了都有提示
   - 回车下一个、Shift+回车上一个；替换框里回车替换一个、Mod+回车全部替换；
     Alt+C / Alt+W / Alt+R 切换三个开关（和 VS Code 一样）；Esc 关闭并回到正文
   - 匹配项已经在视口里就不滚；不在的话滚到视口中间，不会再贴着边、也不会被面板挡住
   ============================================================ */

/** 计数的上限：超过就显示「999+」，长文档里搜一个「的」也不会卡 */
export const MATCH_COUNT_LIMIT = 999;

/** 所有匹配项的位置（最多 limit + 1 个，多出来的那一个只用来判断「还有更多」）。 */
export function collectMatches(
  state: EditorState,
  query: SearchQuery,
  limit = MATCH_COUNT_LIMIT,
): Array<{ from: number; to: number }> {
  const matches: Array<{ from: number; to: number }> = [];
  if (!query.valid || !query.search) return matches;
  const cursor = query.getCursor(state);
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    matches.push({ from: step.value.from, to: step.value.to });
    if (matches.length > limit) break;
  }
  return matches;
}

/** 选区正好是第几个匹配（从 1 数）；不是任何一个时为 0。 */
export function matchIndex(
  matches: ReadonlyArray<{ from: number; to: number }>,
  selection: SelectionRange,
): number {
  let low = 0;
  let high = matches.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const match = matches[middle]!;
    if (match.from < selection.from) low = middle + 1;
    else if (match.from > selection.from) high = middle - 1;
    else return match.to === selection.to ? middle + 1 : 0;
  }
  return 0;
}

/** 计数那一格的文字 */
export function matchLabel(
  state: EditorState,
  query: SearchQuery,
  matches: ReadonlyArray<{ from: number; to: number }>,
  current: number,
): { text: string; empty: boolean } {
  if (!query.search) return { text: "", empty: false };
  if (!query.valid) return { text: state.phrase("Invalid regexp"), empty: true };
  if (matches.length === 0) return { text: state.phrase("No results"), empty: true };
  const total = matches.length > MATCH_COUNT_LIMIT ? `${MATCH_COUNT_LIMIT}+` : `${matches.length}`;
  return { text: current ? `${current}/${total}` : total, empty: false };
}

/**
 * 找到匹配项时怎么滚：已经在视口里（且不在面板底下）就不动，否则滚到正中。
 * 编辑器自己不滚（外层的文档视图在滚），所以这里按窗口量。
 */
export function scrollToMatch(range: SelectionRange, view: EditorView) {
  const coords = view.coordsAtPos(range.from);
  const panel = view.dom.querySelector(".otw-search");
  const top = Math.max(0, panel?.getBoundingClientRect().bottom ?? 0) + 8;
  const bottom = view.dom.ownerDocument.documentElement.clientHeight - 24;
  const visible = !!coords && coords.top >= top && coords.bottom <= bottom;
  return EditorView.scrollIntoView(range.from, { y: visible ? "nearest" : "center" });
}

const SVG_NS = "http://www.w3.org/2000/svg";

function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const ICONS = {
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-3.5-3.5"],
  up: ["M18 15l-6-6-6 6"],
  down: ["M6 9l6 6 6-6"],
  chevron: ["M9 18l6-6-6-6"],
  close: ["M18 6L6 18", "M6 6l12 12"],
};

function button(
  className: string,
  label: string,
  content: Node | string,
  onClick: () => void,
): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.title = label;
  node.setAttribute("aria-label", label);
  node.append(content);
  // 点按钮不抢输入框的焦点：点完开关、上一个下一个，接着打字、回车都还在输入框里
  node.addEventListener("mousedown", (event) => event.preventDefault());
  node.addEventListener("click", onClick);
  return node;
}

function field(placeholder: string, value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "otw-search-input";
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  input.spellcheck = false;
  input.autocomplete = "off";
  return input;
}

class SearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private query: SearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly searchBox: HTMLElement;
  private readonly toggles: Record<"caseSensitive" | "wholeWord" | "regexp", HTMLButtonElement>;
  private readonly replaceToggle: HTMLButtonElement;
  private readonly replaceRow: HTMLElement;
  private matches: Array<{ from: number; to: number }> = [];
  private recount: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly view: EditorView) {
    const { state } = view;
    this.query = getSearchQuery(state);

    this.searchField = field(state.phrase("Find"), this.query.search);
    // openSearchPanel / Mod-F 找的是带 main-field 的输入框：聚焦并全选
    this.searchField.setAttribute("main-field", "true");
    this.replaceField = field(state.phrase("Replace"), this.query.replace);
    for (const input of [this.searchField, this.replaceField]) {
      input.addEventListener("input", (event) => {
        // 输入法组字期间不搜，组完（compositionend）再搜
        if (!(event as InputEvent).isComposing) this.commit();
      });
      input.addEventListener("compositionend", () => this.commit());
      input.addEventListener("change", () => this.commit());
    }

    this.count = document.createElement("span");
    this.count.className = "otw-search-count";
    this.count.setAttribute("aria-live", "polite");

    const toggle = (
      key: "caseSensitive" | "wholeWord" | "regexp",
      phrase: string,
      text: string,
    ) => {
      const node = button("otw-search-toggle", `${state.phrase(phrase)}`, text, () => {
        this.flip(key);
      });
      node.dataset.option = key;
      return node;
    };
    this.toggles = {
      caseSensitive: toggle("caseSensitive", "match case", "Aa"),
      wholeWord: toggle("wholeWord", "by word", "ab"),
      regexp: toggle("regexp", "regexp", ".*"),
    };

    this.searchBox = document.createElement("div");
    this.searchBox.className = "otw-search-box";
    const lens = icon(ICONS.search);
    lens.classList.add("otw-search-lens");
    this.searchBox.append(
      lens,
      this.searchField,
      this.count,
      this.toggles.caseSensitive,
      this.toggles.wholeWord,
      this.toggles.regexp,
    );

    const readOnly = state.readOnly;
    this.replaceToggle = button(
      "otw-search-icon otw-search-expand",
      state.phrase("Toggle replace"),
      icon(ICONS.chevron),
      () => this.showReplace(this.replaceRow.hidden),
    );
    this.replaceToggle.hidden = readOnly;

    const findRow = document.createElement("div");
    findRow.className = "otw-search-row";
    findRow.append(
      this.replaceToggle,
      this.searchBox,
      button("otw-search-icon", `${state.phrase("previous")} (Shift+Enter)`, icon(ICONS.up), () =>
        this.go(findPrevious),
      ),
      button("otw-search-icon", `${state.phrase("next")} (Enter)`, icon(ICONS.down), () =>
        this.go(findNext),
      ),
      button("otw-search-icon", `${state.phrase("close")} (Esc)`, icon(ICONS.close), () =>
        closeSearchPanel(view),
      ),
    );

    const replaceBox = document.createElement("div");
    replaceBox.className = "otw-search-box";
    replaceBox.append(this.replaceField);
    this.replaceRow = document.createElement("div");
    this.replaceRow.className = "otw-search-row otw-search-replace";
    this.replaceRow.append(
      replaceBox,
      button("otw-search-text", `${state.phrase("replace")} (Enter)`, state.phrase("replace"), () =>
        replaceNext(view),
      ),
      button("otw-search-text", state.phrase("replace all"), state.phrase("replace all"), () =>
        replaceAll(view),
      ),
    );
    // 上次展开过替换（替换框里还有字）就接着展开
    this.replaceRow.hidden = readOnly || !this.query.replace;

    this.dom = document.createElement("div");
    this.dom.className = "otw-search";
    this.dom.setAttribute("role", "search");
    this.dom.addEventListener("keydown", (event) => this.keydown(event));
    this.dom.append(findRow, this.replaceRow);

    this.syncOptions();
    this.refresh();
  }

  mount() {
    // Chromium 里 select() 顺带会聚焦，别的引擎不一定
    this.searchField.focus({ preventScroll: true });
    this.searchField.select();
  }

  update(update: ViewUpdate) {
    let queryChanged = false;
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
          queryChanged = true;
        }
      }
    }
    if (queryChanged) {
      this.refresh();
    } else if (update.docChanged) {
      // 在正文里边改边看：数一遍要扫全文，打字时攒一攒再数
      if (this.recount) clearTimeout(this.recount);
      this.recount = setTimeout(() => {
        this.recount = null;
        this.refresh();
      }, 150);
    } else if (update.selectionSet) {
      this.renderCount();
    }
  }

  destroy() {
    if (this.recount) clearTimeout(this.recount);
  }

  private keydown(event: KeyboardEvent) {
    // Esc、Mod-F、F3 / Mod-G 这些和正文共用的快捷键
    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
      return;
    }
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      if (event.target === this.searchField) {
        event.preventDefault();
        this.go(event.shiftKey ? findPrevious : findNext);
      } else if (event.target === this.replaceField) {
        event.preventDefault();
        (event.ctrlKey || event.metaKey ? replaceAll : replaceNext)(this.view);
      }
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      const key = { KeyC: "caseSensitive", KeyW: "wholeWord", KeyR: "regexp" }[event.code] as
        | "caseSensitive"
        | "wholeWord"
        | "regexp"
        | undefined;
      if (key) {
        event.preventDefault();
        this.flip(key);
      }
    }
  }

  /**
   * 上一个 / 下一个。CodeMirror 跳完会把查找框里的字全选上 —— 回车之后想接着补一个字，
   * 结果整个关键词被替换掉了。这里把光标放回原处。
   */
  private go(command: (view: EditorView) => boolean) {
    const { selectionStart, selectionEnd, selectionDirection } = this.searchField;
    command(this.view);
    if (this.searchField.ownerDocument.activeElement === this.searchField) {
      this.searchField.setSelectionRange(
        selectionStart,
        selectionEnd,
        selectionDirection ?? undefined,
      );
    }
  }

  private flip(key: "caseSensitive" | "wholeWord" | "regexp") {
    const next = new SearchQuery({ ...this.spec(), [key]: !this.query[key] });
    this.query = next;
    this.syncOptions();
    this.view.dispatch({ effects: setSearchQuery.of(next) });
    this.refresh();
  }

  private spec() {
    return {
      search: this.searchField.value,
      caseSensitive: this.query.caseSensitive,
      regexp: this.query.regexp,
      wholeWord: this.query.wholeWord,
      replace: this.replaceField.value,
    };
  }

  private commit() {
    const query = new SearchQuery(this.spec());
    if (query.eq(this.query)) return;
    this.query = query;
    this.view.dispatch({ effects: setSearchQuery.of(query) });
    this.refresh();
  }

  private setQuery(query: SearchQuery) {
    this.query = query;
    if (this.searchField.value !== query.search) this.searchField.value = query.search;
    if (this.replaceField.value !== query.replace) this.replaceField.value = query.replace;
    this.syncOptions();
  }

  private syncOptions() {
    for (const [key, node] of Object.entries(this.toggles)) {
      const on = this.query[key as keyof typeof this.toggles];
      node.classList.toggle("is-on", on);
      node.setAttribute("aria-pressed", String(on));
    }
  }

  private showReplace(show: boolean) {
    this.replaceRow.hidden = !show;
    this.replaceToggle.classList.toggle("is-open", show);
    this.replaceToggle.setAttribute("aria-expanded", String(show));
    (show ? this.replaceField : this.searchField).focus();
  }

  /** 重新数一遍匹配项并刷新计数 */
  private refresh() {
    this.matches = collectMatches(this.view.state, this.query);
    this.replaceToggle.classList.toggle("is-open", !this.replaceRow.hidden);
    this.replaceToggle.setAttribute("aria-expanded", String(!this.replaceRow.hidden));
    this.renderCount();
  }

  private renderCount() {
    const current = matchIndex(this.matches, this.view.state.selection.main);
    const label = matchLabel(this.view.state, this.query, this.matches, current);
    this.count.textContent = label.text;
    this.searchBox.classList.toggle("is-empty", label.empty);
  }
}

export function createSearchPanel(view: EditorView): Panel {
  return new SearchPanel(view);
}
