export type TableAlignment = "left" | "center" | "right" | null;

export interface MarkdownTableModel {
  header: string[];
  rows: string[][];
  alignments: TableAlignment[];
}

/** 解析 GFM 表格供预览 Widget 使用；始终用 textContent 渲染，避免 HTML 注入。 */
export function parseMarkdownTable(source: string): MarkdownTableModel | null {
  const lines = source.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]!);
  const delimiters = splitRow(lines[1]!);
  if (
    header.length === 0 ||
    header.length !== delimiters.length ||
    !delimiters.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  ) {
    return null;
  }

  const alignments = delimiters.map<TableAlignment>((cell) => {
    const value = cell.trim();
    if (value.startsWith(":") && value.endsWith(":")) return "center";
    if (value.endsWith(":")) return "right";
    if (value.startsWith(":")) return "left";
    return null;
  });
  const rows = lines.slice(2).map((line) => {
    const cells = splitRow(line);
    return Array.from({ length: header.length }, (_, index) => cells[index] ?? "");
  });
  return { header, rows, alignments };
}

function splitRow(line: string): string[] {
  const source = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  let inCode = false;
  for (const char of source) {
    if (escaped) {
      cell += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "`") {
      inCode = !inCode;
      cell += char;
    } else if (char === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
}
