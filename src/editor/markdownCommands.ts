import {
  type ChangeSpec,
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";

interface CommandTarget {
  state: EditorView["state"];
  dispatch: (transaction: TransactionSpec) => void;
}

/** `**`、`~~` 这类由同一个字符重复构成的标记取它的字符；`<u>` 这类返回 null。 */
function repeatedMarkerChar(marker: string): string | null {
  return /^(.)\1*$/.test(marker) ? marker[0]! : null;
}

export function wrapMarkdown(open: string, close = open): Command {
  return (view) => {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);

    // 无选区：只插入一对标记并把光标放中间，不要往正文里塞占位文字。
    if (!selected) {
      view.dispatch({
        changes: { from, insert: `${open}${close}` },
        selection: { anchor: from + open.length },
      });
      return true;
    }

    const before = from >= open.length ? view.state.sliceDoc(from - open.length, from) : "";
    const after = view.state.sliceDoc(to, to + close.length);
    // 选中 `**粗体**` 里的「粗体」再按 Ctrl+I，两侧看起来也像 `*…*`。
    // 必须确认外面没有同种标记字符继续延伸，否则会把加粗吃成斜体。
    const openChar = repeatedMarkerChar(open);
    const closeChar = repeatedMarkerChar(close);
    const outerBefore =
      from - open.length > 0 ? view.state.sliceDoc(from - open.length - 1, from - open.length) : "";
    const outerAfter = view.state.sliceDoc(to + close.length, to + close.length + 1);
    const exactWrap =
      before === open &&
      after === close &&
      (openChar === null || outerBefore !== openChar) &&
      (closeChar === null || outerAfter !== closeChar);

    if (exactWrap) {
      view.dispatch({
        changes: [
          { from: from - open.length, to: from },
          { from: to, to: to + close.length },
        ],
        selection: { anchor: from - open.length, head: to - open.length },
      });
      return true;
    }

    if (selected.includes("\n")) {
      const lines = selected.split("\n");
      const nonEmpty = lines.filter(Boolean);
      const unwrap =
        nonEmpty.length > 0 &&
        nonEmpty.every(
          (line) =>
            line.length >= open.length + close.length &&
            line.startsWith(open) &&
            line.endsWith(close),
        );
      const content = lines
        .map((line) => {
          if (!line) return line;
          return unwrap
            ? line.slice(open.length, -close.length || undefined)
            : `${open}${line}${close}`;
        })
        .join("\n");
      view.dispatch({
        changes: { from, to, insert: content },
        selection: { anchor: from, head: from + content.length },
      });
      return true;
    }

    view.dispatch({
      changes: { from, to, insert: `${open}${selected}${close}` },
      selection: {
        anchor: from + open.length,
        head: from + open.length + selected.length,
      },
    });
    return true;
  };
}

/** 行首块级标记：标题号、引用号、有序/无序列表（含任务勾选框）。 */
const LINE_PREFIX_RE = /^(\s{0,3})(?:#{1,6}\s+|>\s?|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/;

export function setHeading(level: number): Command {
  return (view) =>
    transformSelectedLines(view, (line) => {
      const match = LINE_PREFIX_RE.exec(line)!;
      const indent = match[1] ?? "";
      const content = line.slice(match[0].length);
      return level === 0 ? `${indent}${content}` : `${indent}${"#".repeat(level)} ${content}`;
    });
}

export function changeHeadingLevel(delta: 1 | -1): Command {
  return (view) =>
    transformSelectedLines(view, (line) => {
      const match = /^(\s{0,3})(#{1,6})\s+(.*)$/.exec(line);
      const indent = match?.[1] ?? "";
      const current = match?.[2]?.length ?? 0;
      const next = Math.max(0, Math.min(6, current + delta));
      const content = match?.[3] ?? line.trimStart();
      return next === 0 ? `${indent}${content}` : `${indent}${"#".repeat(next)} ${content}`;
    });
}

export function toggleLinePrefix(prefix: string, pattern: RegExp): Command {
  return (view) => {
    const lines = selectedLines(view);
    // 空行不参与判断也不加前缀 —— 否则选中带空行的一段切列表会凭空多出空条目。
    const filled = lines.filter((line) => line.text.trim());
    const targets = filled.length > 0 ? filled : lines;
    const allPrefixed = targets.every((line) => pattern.test(line.text));
    return replaceLines(
      view,
      targets.map((line) => ({
        from: line.from,
        to: line.to,
        insert: allPrefixed ? line.text.replace(pattern, "") : `${prefix}${line.text}`,
      })),
    );
  };
}

export function insertFencedBlock(): Command {
  return (view) => {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || "代码";
    // 围栏必须独占一行；光标停在行中间时补换行，否则生成的是坏 Markdown。
    const prefix = from > view.state.doc.lineAt(from).from ? "\n" : "";
    const suffix = to < view.state.doc.lineAt(to).to ? "\n" : "";
    const bodyStart = from + prefix.length + 4;
    view.dispatch({
      changes: { from, to, insert: `${prefix}\`\`\`\n${selected}\n\`\`\`${suffix}` },
      selection: { anchor: bodyStart, head: bodyStart + selected.length },
    });
    return true;
  };
}

const TABLE_TEMPLATE = "| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |";

export function insertTable(): Command {
  return insertTemplate(TABLE_TEMPLATE, TABLE_TEMPLATE.indexOf("标题"), "标题".length);
}

export function insertLink(image = false): Command {
  return (view) => {
    const { from, to } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const relativeFrom = from - line.from;
    const relativeTo = to - line.from;
    const links = [...line.text.matchAll(/!?\[([^\]]*)\]\(([^)]*)\)/g)];
    const existing = links.find((match) => {
      const start = match.index!;
      const end = start + match[0].length;
      return relativeFrom >= start && relativeTo <= end;
    });
    if (existing) {
      const url = existing[2]!;
      // url 为空时 lastIndexOf("") 会返回串尾，得单独定位到右括号之前。
      const urlStart = url
        ? line.from + existing.index! + existing[0].lastIndexOf(url)
        : line.from + existing.index! + existing[0].length - 1;
      view.dispatch({ selection: { anchor: urlStart, head: urlStart + url.length } });
      return true;
    }

    const selected = view.state.sliceDoc(from, to);
    if (selected.includes("\n")) {
      const prefix = image ? "![" : "[";
      const content = selected
        .split("\n")
        .map((value) => (value ? `${prefix}${value}](url)` : value))
        .join("\n");
      view.dispatch({ changes: { from, to, insert: content } });
      return true;
    }
    const label = selected || (image ? "图片说明" : "链接文字");
    const prefix = image ? "![" : "[";
    const insert = `${prefix}${label}](url)`;
    view.dispatch({
      changes: { from, to, insert },
      selection: {
        anchor: from + prefix.length + label.length + 2,
        head: from + insert.length - 1,
      },
    });
    return true;
  };
}

export function clearMarkdownFormat(): Command {
  return (view) => {
    let { from, to } = view.state.selection.main;
    if (from === to) {
      const line = view.state.doc.lineAt(from);
      from = line.from;
      to = line.to;
    }
    const source = view.state.sliceDoc(from, to);
    const clean = stripMarkdownFormatting(source);
    view.dispatch({
      changes: { from, to, insert: clean },
      selection: { anchor: from, head: from + clean.length },
    });
    return true;
  };
}

/**
 * 只去标记，不动段落结构。
 * 这里刻意不删空行 —— 段落之间的空行是内容的一部分，
 * 清除格式把几段正文粘成一段是数据损坏，不是「清干净了」。
 */
export function stripMarkdownFormatting(source: string): string {
  return source
    .replace(/^[ \t]*(?:`{3,}|~{3,})\w*[ \t]*(?:\n|$)/gm, "")
    // 这里必须用 [ \t] 而不是 \s：\s 含换行，`\s*[-+*]\s+` 会从空行开头
    // 一路吃掉换行，把段落之间的空行连带列表符号一起删掉。
    .replace(
      /^(?:[ \t]{0,3}#{1,6}[ \t]+|[ \t]*>[ \t]?|[ \t]*[-+*][ \t]+(?:\[[ xX]\][ \t]+)?|[ \t]*\d+[.)][ \t]+)/gm,
      "",
    )
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<\/?u>/gi, "")
    .replace(/(\*\*|__|~~|`)(.*?)\1/g, "$2")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1");
}

function insertTemplate(text: string, selectionOffset: number, selectionLength: number): Command {
  return (view) => {
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + selectionOffset, head: from + selectionOffset + selectionLength },
    });
    return true;
  };
}

function transformSelectedLines(view: CommandTarget, transform: (line: string) => string): boolean {
  const changes = selectedLines(view).map((line) => ({
    from: line.from,
    to: line.to,
    insert: transform(line.text),
  }));
  return replaceLines(view, changes);
}

function selectedLines(view: CommandTarget) {
  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from).number;
  const lastPosition = to > from && view.state.doc.lineAt(to).from === to ? to - 1 : to;
  const last = view.state.doc.lineAt(lastPosition).number;
  return Array.from({ length: last - first + 1 }, (_, index) => view.state.doc.line(first + index));
}

function replaceLines(view: CommandTarget, changes: ChangeSpec[]): boolean {
  view.dispatch({ changes });
  return true;
}

export function commandTarget(
  doc: string,
  selection?: { anchor: number; head?: number },
): CommandTarget & {
  result: () => string;
} {
  // 仅供无 DOM 单元测试复用与编辑器相同的命令实现。
  let state = EditorState.create({
    doc,
    selection: selection ? EditorSelection.single(selection.anchor, selection.head) : undefined,
  });
  return {
    get state() {
      return state;
    },
    dispatch(transaction) {
      state = state.update(transaction).state;
    },
    result: () => state.doc.toString(),
  };
}
