/**
 * 手写 Logo。
 *
 * 九段笔画按真实书写顺序一段段描出来（stroke-dashoffset 1 → 0），整词停一拍，
 * 再沿同方向收回去，无限循环 —— 像有人一直在把这个词重新写一遍。
 *
 * 两个实现要点：
 * - pathLength="1" 把每段路径的长度归一化成 1，dasharray / dashoffset 就能直接
 *   写常数，省掉 JS 量 getTotalLength() 那一步，也不用等布局。
 * - 描边走 currentColor，暗色模式跟着 text-* 走就行，不再需要 invert 滤镜
 *   （老的 PNG 素材是 53760×11528 的巨图，缩到 22px 自然糊，这里一并换成矢量）。
 *
 * 停止态（减少动效时）是「写完」而不是「没写」，见 globals.css 里的兜底。
 */

/** 每段笔画的 d，顺序 = 书写顺序。T 是横、竖两笔，所以一共九段。 */
const STROKES = [
  // O
  "M43 25 C 39 15, 27 11, 18 19 C 9 27, 7 46, 15 55 C 23 64, 38 60, 43 47 C 46 39, 45 30, 42 24 C 40 20, 37 17, 34 15",
  // n
  "M56 61 C 55 52, 55 41, 57 35 C 61 30, 69 30, 72 36 C 74 40, 74 47, 74 52 C 74 56, 74 59, 75 61",
  // T 的横
  "M83 18 C 93 14, 108 14, 117 17",
  // T 的竖
  "M101 16 C 100 28, 99 43, 99 54 C 99 59, 102 60, 106 57",
  // h
  "M123 12 C 120 26, 119 44, 119 61 C 119 51, 120 41, 122 36 C 126 31, 133 31, 136 37 C 138 41, 138 48, 138 53 C 138 57, 138 59, 139 61",
  // e
  "M146 48 C 152 46, 160 44, 165 42 C 167 37, 163 33, 158 34 C 152 35, 147 41, 147 48 C 147 55, 152 62, 160 61 C 164 60, 167 57, 169 54",
  // W
  "M176 15 C 179 30, 184 48, 189 59 C 193 48, 196 35, 199 26 C 202 36, 206 49, 210 59 C 214 47, 217 29, 219 15",
  // a
  "M241 37 C 236 32, 227 32, 223 39 C 219 46, 221 56, 228 59 C 234 61, 239 55, 240 47 C 241 41, 241 37, 241 35 C 240 44, 240 53, 241 61",
  // y
  "M247 35 C 247 43, 249 52, 253 57 C 256 60, 260 58, 262 52 C 264 45, 266 38, 267 35 C 265 46, 262 59, 259 68 C 256 76, 251 79, 246 75",
];

/** 单段笔画的描出时长占整轮的 9%，起笔间隔 0.22s，节奏见 globals.css。 */
const STEP = 0.22;

export function Logo() {
  return (
    <svg
      viewBox="3 5 268 78"
      className="h-[38px] w-[131px] shrink-0 overflow-visible text-ink"
      role="img"
      aria-label="OnTheWay"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {STROKES.map((d, i) => (
          <path
            // 笔画顺序即身份，数组是常量、不会重排
            // biome-ignore lint/suspicious/noArrayIndexKey: 静态常量数组
            key={i}
            d={d}
            pathLength="1"
            className="otw-logo-stroke"
            style={{ animationDelay: `${(i * STEP).toFixed(2)}s` }}
          />
        ))}
      </g>
    </svg>
  );
}
