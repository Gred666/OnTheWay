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

export function wrapMarkdown(open: string, close = open, placeholder = "文字"): Command {
  return (view) => {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    const before = from >= open.length ? view.state.sliceDoc(from - open.length, from) : "";
    const after = view.state.sliceDoc(to, to + close.length);

    if (selected && before === open && after === close) {
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
        nonEmpty.every((line) => line.startsWith(open) && line.endsWith(close));
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

    const content = selected || placeholder;
    view.dispatch({
      changes: { from, to, insert: `${open}${content}${close}` },
      selection: {
        anchor: from + open.length,
        head: from + open.length + content.length,
      },
    });
    return true;
  };
}

export function setHeading(level: number): Command {
  return (view) =>
    transformSelectedLines(view, (line) => {
      const content = line.replace(/^\s{0,3}#{1,6}\s+/, "");
      return level === 0 ? content : `${"#".repeat(level)} ${content}`;
    });
}

export function changeHeadingLevel(delta: 1 | -1): Command {
  return (view) =>
    transformSelectedLines(view, (line) => {
      const match = /^(\s{0,3})(#{1,6})\s+(.*)$/.exec(line);
      const current = match?.[2]?.length ?? 0;
      const next = Math.max(0, Math.min(6, current + delta));
      const content = match?.[3] ?? line;
      return next === 0 ? content : `${"#".repeat(next)} ${content}`;
    });
}

export function toggleLinePrefix(prefix: string, pattern: RegExp): Command {
  return (view) => {
    const lines = selectedLines(view);
    const allPrefixed = lines.every((line) => pattern.test(line.text));
    return replaceLines(
      view,
      lines.map((line) => ({
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
    view.dispatch({
      changes: { from, to, insert: `\`\`\`\n${selected}\n\`\`\`` },
      selection: { anchor: from + 4, head: from + 4 + selected.length },
    });
    return true;
  };
}

export function insertTable(): Command {
  return insertTemplate("| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |", 2, 4);
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
      const urlStart = line.from + existing.index! + existing[0].lastIndexOf(url);
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

export function stripMarkdownFormatting(source: string): string {
  return source
    .replace(/^\s*(```+|~~~+)\w*\s*$/gm, "")
    .replace(/^(?:\s{0,3}#{1,6}\s+|\s*>\s?|\s*[-+*]\s+(?:\[[ xX]\]\s+)?|\s*\d+[.)]\s+)/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<\/?u>/gi, "")
    .replace(/(\*\*|__|~~|`)(.*?)\1/g, "$2")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")
    .replace(/^\s*$\n/gm, "");
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
