/**
 * HTML 实体 → 字符。
 *
 * 数字实体（`&#8212;` / `&#x2014;`）直接算；命名实体只收常用的一批 ——
 * 完整表有两千多条，笔记里用得到的不到五十个。查不到返回 null，原样显示。
 */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  para: "¶",
  sect: "§",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  micro: "µ",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  lArr: "⇐",
  rArr: "⇒",
  ne: "≠",
  le: "≤",
  ge: "≥",
  asymp: "≈",
  equiv: "≡",
  infin: "∞",
  sum: "∑",
  prod: "∏",
  radic: "√",
  minus: "−",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  sigma: "σ",
  omega: "ω",
  Delta: "Δ",
  Sigma: "Σ",
  Omega: "Ω",
  hearts: "♥",
  spades: "♠",
  clubs: "♣",
  diams: "♦",
  check: "✓",
  cross: "✗",
  star: "☆",
  starf: "★",
};

export function decodeEntity(entity: string): string | null {
  const match = /^&(#x([0-9a-f]+)|#(\d+)|([a-z][a-z0-9]*));$/i.exec(entity);
  if (!match) return null;
  const [, , hex, dec, name] = match;
  if (hex || dec) {
    const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec!, 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
    // 控制字符和代理区解码出来也显示不出东西，不如保留源码。
    if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) return null;
    return String.fromCodePoint(code);
  }
  return NAMED[name!] ?? null;
}
