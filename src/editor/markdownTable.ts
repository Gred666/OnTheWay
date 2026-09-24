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

/**
 * ```csv / ```tsv 围栏里的表格。第一行是表头。
 * 按 RFC 4180 的规矩处理引号：`"a, b"` 是一个格，`""` 是一个引号；
 * 空行跳过，短行用空格补齐。
 */
export function parseDelimitedTable(
  source: string,
  delimiter: "," | "\t",
): MarkdownTableModel | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = source.replace(/\r\n?/g, "\n");

  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      endRow();
    } else {
      cell += char;
    }
  }
  if (cell || row.length) endRow();

  const [header, ...body] = rows;
  if (!header || header.length === 0) return null;
  return {
    header: header.map((value) => value.trim()),
    rows: body.map((line) =>
      Array.from({ length: header.length }, (_, index) => (line[index] ?? "").trim()),
    ),
    alignments: header.map(() => null),
  };
}
