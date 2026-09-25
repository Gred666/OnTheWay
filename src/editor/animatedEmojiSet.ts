/* ============================================================
   OnTheWay 动态表情 · 设计稿

   一套自己画的表情，跟应用的气质走：
   - 线稿 + 淡彩（duotone）：1.7 的圆头描边是主色，里面铺一层同色系的淡彩，
     和 lucide 图标、手写 Logo 是一家人。颜色全部走 CSS 变量，暗色主题下
     淡彩自动和画布混成深色调，不会像 GIF 那样带白边。
   - 静止态就是一张完整的图：动画从静止态出发、回到静止态，播完不跳。
   - 只动 transform / opacity / stroke-dashoffset（技术方案 §10.1、§11.4.1）。

   画布是 24×24。每个表情由若干部件组成，要动的部件带 `data-a="名字"`，
   对应 motion 里同名的一段关键帧。规矩：
   - 带 data-a 的元素身上不能写 transform 属性 —— CSS transform 会把它整个覆盖掉。
     需要摆角度的，在外面再包一层 <g transform>。
   - 平时看不见、只在动画里出现的部件（粒子、泪滴）加 `fx` 类，静止透明度为 0，
     它的最后一帧也必须回到透明。
   - 最后一帧必须等于静止态（单测守着）；只有转一圈回到对称位置的（太阳、星星）
     用 `seamless` 声明例外。

   配色类（见 globals.css 的 .otw-ae-svg 一节）：
   o 纯描边 · t 描边 + 淡彩 · k 实心 · p 描边 + 纸色（挖空） · i / ik 五官的深色
   描边 / 实心 · hue-* 局部换色 · draw 描边可画出（配合 pathLength="1"）
   ============================================================ */

/** 一帧里的姿态。没写的量沿用上一帧，第一帧默认是静止态。 */
export interface Pose {
  /** 平移，viewBox 单位 */
  x?: number;
  y?: number;
  /** 旋转，度 */
  r?: number;
  /** 等比缩放；sx / sy 单独给时覆盖它 */
  s?: number;
  sx?: number;
  sy?: number;
  /** 斜切，度 */
  kx?: number;
  ky?: number;
  /** 透明度 */
  o?: number;
  /** stroke-dashoffset（路径长度按 pathLength="1" 归一化） */
  d?: number;
}

/** [进度 0–1, 姿态, 这一段往下一帧走的缓动] */
export type Step = readonly [offset: number, pose: Pose, easing?: string];

export interface EmojiMotion {
  steps: readonly Step[];
  /** 一轮的时长，毫秒 */
  duration: number;
  delay?: number;
  iterations?: number;
  /** transform-origin；默认按部件自身的包围盒居中 */
  origin?: string;
  /** "view"：origin 按 viewBox 坐标写（如 "12px 12px"）；默认按部件包围盒 */
  box?: "fill" | "view";
  /** 结束姿态和静止态不同、但画面一样（对称图形转了一个周期） */
  seamless?: boolean;
}

export type EmojiGroup = "mood" | "drive" | "way" | "daily";

export type EmojiHue =
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "blue"
  | "sky"
  | "purple"
  | "pink"
  | "brown"
  | "slate";

export interface AnimatedEmojiDesign {
  /** 短码里 `otw_` 后面那段 */
  id: string;
  /** 中文名，选择器和悬停提示里显示 */
  name: string;
  group: EmojiGroup;
  /** 搜索用：中文近义词、拼音、英文，空格隔开 */
  keywords: string;
  /** 主色；部件可以用 hue-* 类局部换色 */
  hue: EmojiHue;
  svg: string;
  motion: Readonly<Record<string, EmojiMotion>>;
}

export const EMOJI_GROUPS: ReadonlyArray<{ id: EmojiGroup; label: string }> = [
  { id: "mood", label: "心情" },
  { id: "drive", label: "干劲" },
  { id: "way", label: "在路上" },
  { id: "daily", label: "日常" },
];

/* ---------------- 缓动 ---------------- */

/** ease-out-quint，和 --ease-out-quint 同一条 */
const OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
/** 加速落下：掉落、撞击前 */
const IN = "cubic-bezier(0.55, 0, 0.8, 0.3)";
const SOFT = "cubic-bezier(0.37, 0, 0.63, 1)";

/** 彩纸从拉炮口（10.4, 13.6）飞到自己的位置，落定后轻轻飘一下。 */
function burst(x: number, y: number): readonly Step[] {
  return [
    [0, { x: 10.4 - x, y: 13.6 - y, s: 0, o: 0 }],
    [0.08, { o: 1 }, OUT],
    [0.46, { x: 0, y: 0, s: 1.15 }, SOFT],
    [0.74, { y: 0.7, s: 1, r: 25 }, SOFT],
    [1, { y: 0, r: 0 }],
  ];
}

/** 笑脸的底：一张淡黄色的圆脸。 */
const FACE = '<circle class="t face" cx="12" cy="12" r="9"/>';

export const ANIMATED_EMOJI_DESIGNS: readonly AnimatedEmojiDesign[] = [
  /* ============================ 心情 ============================ */
  {
    id: "smile",
    name: "开心",
    group: "mood",
    keywords: "笑 微笑 高兴 愉快 kaixin xiao smile happy",
    hue: "amber",
    svg: `<g data-a="face">${FACE}
      <ellipse class="blush" cx="6.9" cy="13.6" rx="1.5" ry="0.9"/>
      <ellipse class="blush" cx="17.1" cy="13.6" rx="1.5" ry="0.9"/>
      <g data-a="eyes">
        <ellipse class="ik" cx="9" cy="10" rx="1.1" ry="1.45"/>
        <ellipse class="ik" cx="15" cy="10" rx="1.1" ry="1.45"/>
      </g>
      <path class="i" d="M8.4 13.9c.9 1.5 2.1 2.2 3.6 2.2s2.7-.7 3.6-2.2"/>
    </g>`,
    motion: {
      face: {
        steps: [
          [0, {}, OUT],
          [0.16, { y: -1.3, r: -7 }, SOFT],
          [0.38, { y: 0, r: 5 }, SOFT],
          [0.56, { r: -2.5 }, SOFT],
          [0.74, { r: 0 }],
        ],
        duration: 1300,
        origin: "50% 92%",
      },
      eyes: {
        steps: [
          [0, {}],
          [0.62, {}, IN_OUT],
          [0.68, { sy: 0.12 }, IN_OUT],
          [0.76, { sy: 1 }],
        ],
        duration: 1300,
      },
    },
  },
  {
    id: "laugh",
    name: "笑出声",
    group: "mood",
    keywords: "大笑 哈哈 笑死 开怀 daxiao haha laugh lol",
    hue: "amber",
    svg: `<g data-a="face">${FACE}
      <path class="i" d="M7.2 10.4c.7-1.1 2.3-1.1 3 0M13.8 10.4c.7-1.1 2.3-1.1 3 0"/>
      <path class="ik" d="M7.5 13.1h9c0 2.7-2 4.7-4.5 4.7s-4.5-2-4.5-4.7z"/>
      <path class="k hue-red" d="M9.6 16.8c.6-.7 1.4-1 2.4-1s1.8.3 2.4 1c-.7.6-1.5 1-2.4 1s-1.7-.4-2.4-1z"/>
    </g>
    <path data-a="tearL" class="t hue-sky fx" d="M3.4 8.6c-.9 1.1-1.3 1.9-1.3 2.5a1.3 1.3 0 0 0 2.6 0c0-.6-.4-1.4-1.3-2.5z"/>
    <path data-a="tearR" class="t hue-sky fx" d="M20.6 8.6c-.9 1.1-1.3 1.9-1.3 2.5a1.3 1.3 0 0 0 2.6 0c0-.6-.4-1.4-1.3-2.5z"/>`,
    motion: {
      face: {
        steps: [
          [0, {}, SOFT],
          [0.09, { r: -8, y: -0.7 }, SOFT],
          [0.18, { r: 7, y: 0 }, SOFT],
          [0.27, { r: -7, y: -0.7 }, SOFT],
          [0.36, { r: 6, y: 0 }, SOFT],
          [0.45, { r: -5, y: -0.5 }, SOFT],
          [0.54, { r: 4, y: 0 }, SOFT],
          [0.66, { r: -2 }, SOFT],
          [0.8, { r: 0 }],
        ],
        duration: 1400,
        origin: "50% 80%",
      },
      tearL: {
        steps: [
          [0, { o: 0, s: 0.3, x: 1.5 }, OUT],
          [0.14, { o: 1, s: 1, x: 0 }, SOFT],
          [0.5, { x: -0.6, y: 1.6 }, IN],
          [0.68, { o: 0, x: -0.9, y: 3.4 }],
        ],
        duration: 1400,
        delay: 80,
      },
      tearR: {
        steps: [
          [0, { o: 0, s: 0.3, x: -1.5 }, OUT],
          [0.14, { o: 1, s: 1, x: 0 }, SOFT],
          [0.5, { x: 0.6, y: 1.6 }, IN],
          [0.68, { o: 0, x: 0.9, y: 3.4 }],
        ],
        duration: 1400,
        delay: 140,
      },
    },
  },
  {
    id: "love",
    name: "喜欢",
    group: "mood",
    keywords: "爱 心 爱心 喜爱 比心 xihuan ai xin love heart",
    hue: "red",
    svg: `<g data-a="heart">
      <path class="t" d="M12 20.3c-.4 0-8.4-4.7-8.4-10.6 0-2.9 2.1-5.1 4.8-5.1 1.6 0 2.9.8 3.6 2 .7-1.2 2-2 3.6-2 2.7 0 4.8 2.2 4.8 5.1 0 5.9-8 10.6-8.4 10.6z"/>
      <path class="shine" d="M6.6 9.4c.1-1.2.9-2.2 2.1-2.4"/>
    </g>
    <g transform="translate(19.6 4.6)"><path data-a="mini1" class="k fx" d="M0 2C-.1 2-2.2.8-2.2-.8c0-.8.6-1.3 1.2-1.3.5 0 .8.2 1 .6.2-.4.5-.6 1-.6.6 0 1.2.5 1.2 1.3C2.2.8.1 2 0 2z"/></g>
    <g transform="translate(4.4 4.2) scale(.72)"><path data-a="mini2" class="k fx" d="M0 2C-.1 2-2.2.8-2.2-.8c0-.8.6-1.3 1.2-1.3.5 0 .8.2 1 .6.2-.4.5-.6 1-.6.6 0 1.2.5 1.2 1.3C2.2.8.1 2 0 2z"/></g>`,
    motion: {
      heart: {
        steps: [
          [0, { s: 1 }, OUT],
          [0.11, { s: 1.2 }, IN_OUT],
          [0.22, { s: 0.95 }, OUT],
          [0.32, { s: 1.13 }, IN_OUT],
          [0.46, { s: 0.99 }, SOFT],
          [0.58, { s: 1 }],
        ],
        duration: 1150,
      },
      mini1: {
        steps: [
          [0, { o: 0, s: 0.2, y: 3 }, OUT],
          [0.24, { o: 1, s: 1, y: 0 }, SOFT],
          [0.62, { y: -2.2, x: 0.8, r: 12 }, SOFT],
          [0.82, { o: 0, y: -3.4, x: 1.1 }],
        ],
        duration: 1150,
        delay: 60,
      },
      mini2: {
        steps: [
          [0, { o: 0, s: 0.2, y: 3 }, OUT],
          [0.24, { o: 1, s: 1, y: 0 }, SOFT],
          [0.62, { y: -2.4, x: -0.8, r: -12 }, SOFT],
          [0.82, { o: 0, y: -3.6, x: -1.1 }],
        ],
        duration: 1150,
        delay: 220,
      },
    },
  },
  {
    id: "sad",
    name: "难过",
    group: "mood",
    keywords: "哭 伤心 委屈 失落 nanguo ku sad cry",
    hue: "amber",
    svg: `<g data-a="face">${FACE}
      <path class="i" d="M6.9 8.5l2.6-1.3M17.1 8.5l-2.6-1.3"/>
      <ellipse class="ik" cx="9" cy="11" rx="1.05" ry="1.3"/>
      <ellipse class="ik" cx="15" cy="11" rx="1.05" ry="1.3"/>
      <path class="i" d="M9.2 16.7c.8-1 1.7-1.5 2.8-1.5s2 .5 2.8 1.5"/>
    </g>
    <path data-a="tear" class="t hue-sky fx" d="M8.7 12.4c-.9 1.2-1.4 2.1-1.4 2.7a1.4 1.4 0 0 0 2.8 0c0-.6-.5-1.5-1.4-2.7z"/>`,
    motion: {
      face: {
        steps: [
          [0, {}, OUT],
          [0.2, { y: 0.7, r: -3 }, SOFT],
          [0.72, { y: 0.7, r: -3 }, SOFT],
          [0.92, { y: 0, r: 0 }],
        ],
        duration: 1700,
        origin: "50% 100%",
      },
      tear: {
        steps: [
          [0, { o: 0, s: 0.2 }, OUT],
          [0.16, { o: 1, s: 1 }],
          [0.34, { y: 0 }, IN],
          [0.7, { y: 5.2 }],
          [0.8, { o: 0, y: 6, sy: 0.7 }],
        ],
        duration: 1700,
        delay: 120,
        origin: "50% 0%",
      },
    },
  },
  {
    id: "think",
    name: "想一想",
    group: "mood",
    keywords: "思考 想 琢磨 嗯 考虑 sikao xiang think hmm",
    hue: "purple",
    svg: `<g data-a="bubble">
      <path class="t" d="M7.1 16.3c-2.4 0-4.1-1.7-4.1-3.9 0-1.9 1.3-3.4 3.1-3.8.5-2.3 2.5-3.9 4.9-3.9 1.9 0 3.6 1 4.4 2.6 2.9-.3 5.6 1.6 5.6 4.5 0 2.5-2 4.5-4.6 4.5z"/>
      <circle class="t" cx="5.3" cy="19.4" r="1.25"/>
      <circle class="t" cx="2.9" cy="21.6" r=".7"/>
    </g>
    <circle data-a="dot1" class="k" cx="8.5" cy="11.4" r="1.1"/>
    <circle data-a="dot2" class="k" cx="12.2" cy="11.4" r="1.1"/>
    <circle data-a="dot3" class="k" cx="15.9" cy="11.4" r="1.1"/>`,
    motion: {
      bubble: {
        steps: [
          [0, {}, OUT],
          [0.12, { s: 1.06 }, SOFT],
          [0.28, { s: 1 }],
        ],
        duration: 1500,
        origin: "20% 95%",
      },
      dot1: {
        steps: [
          [0, {}, OUT],
          [0.14, { y: -1.8 }, IN],
          [0.3, { y: 0 }],
          [1, {}],
        ],
        duration: 750,
        iterations: 2,
      },
      dot2: {
        steps: [
          [0, {}, OUT],
          [0.14, { y: -1.8 }, IN],
          [0.3, { y: 0 }],
          [1, {}],
        ],
        duration: 750,
        delay: 110,
        iterations: 2,
      },
      dot3: {
        steps: [
          [0, {}, OUT],
          [0.14, { y: -1.8 }, IN],
          [0.3, { y: 0 }],
          [1, {}],
        ],
        duration: 750,
        delay: 220,
        iterations: 2,
      },
    },
  },
  {
    id: "wow",
    name: "哇",
    group: "mood",
    keywords: "惊讶 吃惊 震惊 天哪 jingya wa wow omg",
    hue: "amber",
    svg: `<g data-a="face">${FACE}
      <path data-a="brows" class="i" d="M7.2 7.6c.7-.7 1.6-1 2.6-.9M16.8 7.6c-.7-.7-1.6-1-2.6-.9"/>
      <circle class="ik" cx="9" cy="10.4" r="1.3"/>
      <circle class="ik" cx="15" cy="10.4" r="1.3"/>
      <ellipse data-a="mouth" class="ik" cx="12" cy="15.7" rx="1.9" ry="2.3"/>
    </g>`,
    motion: {
      face: {
        steps: [
          [0, {}, OUT],
          [0.13, { y: -2, s: 1.06 }, IN],
          [0.3, { y: 0, s: 1 }, OUT],
          [0.37, { sy: 0.94, sx: 1.04 }, SOFT],
          [0.5, { sx: 1, sy: 1 }],
        ],
        duration: 1200,
        origin: "50% 100%",
      },
      brows: {
        steps: [
          [0, {}, OUT],
          [0.12, { y: -1.3 }],
          [0.62, { y: -1.3 }, SOFT],
          [0.8, { y: 0 }],
        ],
        duration: 1200,
      },
      mouth: {
        steps: [
          [0, {}, IN_OUT],
          [0.08, { s: 0.55 }, OUT],
          [0.26, { s: 1.25 }, SOFT],
          [0.44, { s: 1 }],
        ],
        duration: 1200,
      },
    },
  },

  /* ============================ 干劲 ============================ */
  {
    id: "done",
    name: "搞定",
    group: "drive",
    keywords: "完成 对勾 好了 通过 gaoding wancheng done check ok",
    hue: "green",
    svg: `<circle data-a="ring" class="o fx" cx="12" cy="12" r="9"/>
    <g data-a="badge">
      <circle class="t" cx="12" cy="12" r="9"/>
      <path data-a="check" class="o draw bold" pathLength="1" d="M7.7 12.4l3 3 5.6-6.1"/>
    </g>`,
    motion: {
      badge: {
        steps: [
          [0, {}, OUT],
          [0.1, { s: 0.82 }, OUT],
          [0.28, { s: 1.1 }, SOFT],
          [0.44, { s: 1 }],
        ],
        duration: 1100,
      },
      check: {
        steps: [
          [0, { d: 1 }],
          [0.16, { d: 1 }, OUT],
          [0.46, { d: 0 }],
        ],
        duration: 1100,
      },
      ring: {
        steps: [
          [0, { o: 0 }],
          [0.26, { o: 0.8, s: 1 }, OUT],
          [0.7, { o: 0, s: 1.5 }],
        ],
        duration: 1100,
      },
    },
  },
  {
    id: "fire",
    name: "冲",
    group: "drive",
    keywords: "火 燃 热 拼 火力全开 chong huo fire hot lit",
    hue: "orange",
    svg: `<path data-a="outer" class="t" d="M12 21.3c-3.9 0-6.7-2.7-6.7-6.4 0-2.6 1.4-4.6 3-6.1.3 1.6 1.1 2.6 2.3 3-.4-3.3 1-6.2 3.9-8.4.3 2.8 1.7 4.5 3.1 6 1.3 1.4 2.1 3.1 2.1 5.4 0 3.8-3.1 6.5-7.7 6.5z"/>
    <path data-a="inner" class="t hue-amber" d="M12 21.3c-1.9 0-3.3-1.3-3.3-3.1 0-1.5.8-2.6 1.9-3.4.2 1 .7 1.6 1.4 1.8-.1-1.4.5-2.6 1.6-3.6.3 1.4 1 2.3 1.6 3.1.4.6.6 1.3.6 2.1 0 1.8-1.5 3.1-3.8 3.1z"/>
    <circle data-a="spark1" class="k hue-amber fx" cx="7.4" cy="6.4" r=".85"/>
    <circle data-a="spark2" class="k fx" cx="18.2" cy="5.2" r=".75"/>`,
    motion: {
      outer: {
        steps: [
          [0, {}, IN_OUT],
          [0.14, { sy: 1.08, sx: 0.96, kx: -3 }, IN_OUT],
          [0.3, { sy: 0.96, sx: 1.03, kx: 2.5 }, IN_OUT],
          [0.46, { sy: 1.06, sx: 0.97, kx: -2 }, IN_OUT],
          [0.62, { sy: 0.98, sx: 1.01, kx: 1.5 }, IN_OUT],
          [0.8, { sy: 1.03, sx: 1, kx: -0.8 }, IN_OUT],
          [1, { sy: 1, kx: 0 }],
        ],
        duration: 1400,
        origin: "50% 100%",
      },
      inner: {
        steps: [
          [0, {}, IN_OUT],
          [0.18, { sy: 0.88, kx: 4 }, IN_OUT],
          [0.36, { sy: 1.12, kx: -4 }, IN_OUT],
          [0.56, { sy: 0.93, kx: 2.5 }, IN_OUT],
          [0.76, { sy: 1.05, kx: -1 }, IN_OUT],
          [1, { sy: 1, kx: 0 }],
        ],
        duration: 1400,
        origin: "50% 100%",
      },
      spark1: {
        steps: [
          [0, { o: 0, y: 3, s: 0.5 }, OUT],
          [0.3, { o: 1, y: 0, s: 1 }, SOFT],
          [0.75, { o: 0, y: -3.2, x: -0.8, s: 0.6 }],
        ],
        duration: 1400,
        delay: 100,
      },
      spark2: {
        steps: [
          [0, { o: 0, y: 3, s: 0.5 }, OUT],
          [0.3, { o: 1, y: 0, s: 1 }, SOFT],
          [0.75, { o: 0, y: -3, x: 0.8, s: 0.6 }],
        ],
        duration: 1400,
        delay: 380,
      },
    },
  },
  {
    id: "rocket",
    name: "起飞",
    group: "drive",
    keywords: "火箭 出发 上线 发布 加速 qifei huojian rocket launch ship",
    hue: "blue",
    svg: `<circle data-a="puff1" class="t hue-slate fx" cx="5.2" cy="19" r="1.7"/>
    <circle data-a="puff2" class="t hue-slate fx" cx="3" cy="21.2" r="1.1"/>
    <g data-a="rocket"><g transform="rotate(45 12 12)">
      <path data-a="flame" class="t hue-orange" d="M10.2 16.3h3.6c0 2-.8 3.6-1.8 4.6-1-1-1.8-2.6-1.8-4.6z"/>
      <path class="t" d="M8 12.2l-2.5 2.4v3L8 16.2zM16 12.2l2.5 2.4v3L16 16.2z"/>
      <path class="t" d="M12 2.8c2.7 2.1 4 5.1 4 8.9v4.6H8v-4.6c0-3.8 1.3-6.8 4-8.9z"/>
      <circle class="p" cx="12" cy="9.6" r="1.75"/>
    </g></g>`,
    motion: {
      rocket: {
        steps: [
          [0, {}, SOFT],
          [0.05, { x: -0.35, y: 0.35 }, SOFT],
          [0.1, { x: 0.35, y: -0.2 }, SOFT],
          [0.15, { x: -0.3, y: 0.3 }, SOFT],
          [0.2, { x: 0.3, y: -0.3 }, SOFT],
          [0.25, { x: 0, y: 0 }, IN],
          [0.48, { x: 7, y: -7, o: 0 }],
          [0.5, { x: -7, y: 7, o: 0 }, OUT],
          [0.8, { x: 0, y: 0, o: 1 }],
        ],
        duration: 1600,
      },
      flame: {
        steps: [
          [0, {}, IN_OUT],
          [0.25, { sy: 1.35, sx: 0.9 }, IN_OUT],
          [0.5, { sy: 0.9, sx: 1 }, IN_OUT],
          [0.75, { sy: 1.4, sx: 0.88 }, IN_OUT],
          [1, { sy: 1, sx: 1 }],
        ],
        duration: 320,
        iterations: 5,
        origin: "50% 0%",
      },
      puff1: {
        steps: [
          [0, { o: 0, s: 0.3 }],
          [0.2, { o: 0, s: 0.3 }, OUT],
          [0.32, { o: 0.9, s: 1 }, SOFT],
          [0.56, { o: 0, s: 1.6, x: -1, y: 1 }],
        ],
        duration: 1600,
      },
      puff2: {
        steps: [
          [0, { o: 0, s: 0.3 }],
          [0.24, { o: 0, s: 0.3 }, OUT],
          [0.36, { o: 0.9, s: 1 }, SOFT],
          [0.6, { o: 0, s: 1.7, x: -1, y: 1 }],
        ],
        duration: 1600,
      },
    },
  },
  {
    id: "target",
    name: "命中",
    group: "drive",
    keywords: "目标 靶子 瞄准 中了 mingzhong mubiao target goal bullseye",
    hue: "red",
    svg: `<g data-a="board">
      <circle class="t" cx="10.5" cy="13.5" r="8.2"/>
      <circle class="o" cx="10.5" cy="13.5" r="4.8"/>
      <circle class="k" cx="10.5" cy="13.5" r="1.8"/>
    </g>
    <g data-a="arrow">
      <path class="o hue-slate" d="M10.5 13.5l9-9"/>
      <path class="o hue-slate" d="M19.5 4.5V1.9M19.5 4.5h2.6M17.8 6.2V3.6M17.8 6.2h2.6"/>
    </g>`,
    motion: {
      arrow: {
        steps: [
          [0, { x: 6, y: -6, o: 0 }, IN],
          [0.08, { o: 1 }, IN],
          [0.28, { x: 0, y: 0 }, SOFT],
          [0.35, { r: -6 }, SOFT],
          [0.43, { r: 4.5 }, SOFT],
          [0.51, { r: -2.5 }, SOFT],
          [0.6, { r: 0 }],
        ],
        duration: 1300,
        box: "view",
        origin: "10.5px 13.5px",
      },
      board: {
        steps: [
          [0, {}],
          [0.28, {}, OUT],
          [0.33, { x: -0.7, y: 0.7, s: 0.97 }, SOFT],
          [0.46, { x: 0, y: 0, s: 1 }],
        ],
        duration: 1300,
      },
    },
  },
  {
    id: "idea",
    name: "灵感",
    group: "drive",
    keywords: "想法 点子 灯泡 主意 启发 linggan dengpao idea bulb",
    hue: "amber",
    svg: `<circle data-a="halo" class="k fx" cx="12" cy="9.6" r="7"/>
    <g data-a="rays" class="o">
      <path d="M12 1.2v1.5M5.4 3.6l1 1M18.6 3.6l-1 1M2.8 9.6h1.5M21.2 9.6h-1.5"/>
    </g>
    <g data-a="bulb">
      <path class="t" d="M12 4.3a5.3 5.3 0 0 0-3.3 9.5c.6.5.9 1.2.9 2v.7h4.8v-.7c0-.8.3-1.5.9-2A5.3 5.3 0 0 0 12 4.3z"/>
      <path data-a="filament" class="o draw thin" pathLength="1" d="M10.4 13.4l.8-2.1.8 1.2.8-1.2.8 2.1"/>
      <path class="o hue-slate" d="M10 18.8h4M10.8 20.9h2.4"/>
    </g>`,
    motion: {
      bulb: {
        steps: [
          [0, {}, OUT],
          [0.16, { s: 0.92 }, OUT],
          [0.32, { s: 1.1 }, SOFT],
          [0.48, { s: 1 }],
        ],
        duration: 1300,
        origin: "50% 75%",
      },
      filament: {
        steps: [
          [0, { d: 1 }],
          [0.18, { d: 1 }, OUT],
          [0.42, { d: 0 }],
        ],
        duration: 1300,
      },
      rays: {
        steps: [
          [0, { o: 0, s: 0.6 }],
          [0.26, { o: 0, s: 0.6 }, OUT],
          [0.44, { o: 1, s: 1.14 }, SOFT],
          [0.6, { s: 1 }],
        ],
        duration: 1300,
        box: "view",
        origin: "12px 9.6px",
      },
      halo: {
        steps: [
          [0, { o: 0, s: 0.6 }],
          [0.26, { o: 0, s: 0.6 }, OUT],
          [0.42, { o: 0.32, s: 1.08 }, SOFT],
          [0.9, { o: 0, s: 1.3 }],
        ],
        duration: 1300,
      },
    },
  },
  {
    id: "coffee",
    name: "续命",
    group: "drive",
    keywords: "咖啡 专注 提神 休息 喝 xuming kafei coffee focus break",
    hue: "brown",
    svg: `<path data-a="steam1" class="o hue-slate thin" d="M8.2 7.9c-.8-.9-.8-1.8 0-2.7s.8-1.8 0-2.7"/>
    <path data-a="steam2" class="o hue-slate thin" d="M10.8 7.9c-.8-.9-.8-1.8 0-2.7s.8-1.8 0-2.7"/>
    <path data-a="steam3" class="o hue-slate thin" d="M13.4 7.9c-.8-.9-.8-1.8 0-2.7s.8-1.8 0-2.7"/>
    <g data-a="cup">
      <path class="o" d="M16.4 11.6h1.2a2.5 2.5 0 0 1 0 5h-1.2"/>
      <path class="t" d="M4.8 10.2h11.6v5.1a4.5 4.5 0 0 1-4.5 4.5H9.3a4.5 4.5 0 0 1-4.5-4.5z"/>
      <path class="o" d="M3.4 21.6h15.2"/>
    </g>`,
    motion: {
      cup: {
        steps: [
          [0, {}, SOFT],
          [0.14, { r: -5 }, SOFT],
          [0.32, { r: 3 }, SOFT],
          [0.46, { r: -1 }, SOFT],
          [0.58, { r: 0 }],
        ],
        duration: 1500,
        origin: "45% 100%",
      },
      steam1: {
        steps: [
          [0, {}, IN],
          [0.3, { o: 0, y: -1.6 }],
          [0.31, { o: 0, y: 1.4 }, OUT],
          [0.62, { o: 1, y: 0 }],
        ],
        duration: 1500,
      },
      steam2: {
        steps: [
          [0, {}, IN],
          [0.3, { o: 0, y: -1.6 }],
          [0.31, { o: 0, y: 1.4 }, OUT],
          [0.62, { o: 1, y: 0 }],
        ],
        duration: 1500,
        delay: 140,
      },
      steam3: {
        steps: [
          [0, {}, IN],
          [0.3, { o: 0, y: -1.6 }],
          [0.31, { o: 0, y: 1.4 }, OUT],
          [0.62, { o: 1, y: 0 }],
        ],
        duration: 1500,
        delay: 280,
      },
    },
  },

  /* ============================ 在路上 ============================ */
  {
    id: "way",
    name: "在路上",
    group: "way",
    keywords: "路 出发 前进 旅程 进行中 zailushang lu onthway ontheway road",
    hue: "blue",
    svg: `<path class="road" d="M3.4 21c3.4-.3 5.9-1.7 6.6-4.3.8-2.9-1.2-4.6 1.1-6.6 1.9-1.6 4.7-.8 6.6-2.1"/>
    <path data-a="lane" class="o dash thin" pathLength="1" d="M3.4 21c3.4-.3 5.9-1.7 6.6-4.3.8-2.9-1.2-4.6 1.1-6.6 1.9-1.6 4.7-.8 6.6-2.1"/>
    <g data-a="pin">
      <path class="t hue-red" d="M18.6 8.9s-3.3-3-3.3-5.6a3.3 3.3 0 0 1 6.6 0c0 2.6-3.3 5.6-3.3 5.6z"/>
      <circle class="p hue-red" cx="18.6" cy="3.4" r="1.1"/>
    </g>`,
    motion: {
      lane: {
        steps: [
          [0, { d: 0 }],
          [1, { d: -0.36 }],
        ],
        duration: 1800,
        seamless: true,
      },
      pin: {
        steps: [
          [0, {}, OUT],
          [0.12, { y: -2.2 }, IN],
          [0.26, { y: 0 }, OUT],
          [0.31, { sy: 0.84, sx: 1.12 }, SOFT],
          [0.4, { sx: 1, sy: 1 }, OUT],
          [0.5, { y: -1 }, IN],
          [0.6, { y: 0 }],
        ],
        duration: 1800,
        origin: "50% 100%",
      },
    },
  },
  {
    id: "flag",
    name: "里程碑",
    group: "way",
    keywords: "旗 旗帜 目标 达成 节点 lichengbei qi flag milestone",
    hue: "blue",
    svg: `<path class="o hue-slate" d="M6 21.4V3.4"/>
    <path data-a="flag" class="t" d="M6 4.2c2.3-1.2 4.4-1.2 6.4 0s4.1 1.2 6.4 0v8.4c-2.3 1.2-4.4 1.2-6.4 0s-4.1-1.2-6.4 0z"/>
    <circle class="k hue-slate" cx="6" cy="2.8" r="1.05"/>`,
    motion: {
      flag: {
        steps: [
          [0, {}, SOFT],
          [0.14, { ky: -9, sx: 0.93 }, SOFT],
          [0.32, { ky: 7, sx: 1 }, SOFT],
          [0.5, { ky: -5, sx: 0.96 }, SOFT],
          [0.68, { ky: 3, sx: 1 }, SOFT],
          [0.84, { ky: -1 }, SOFT],
          [1, { ky: 0 }],
        ],
        duration: 1500,
        origin: "0% 50%",
      },
    },
  },
  {
    id: "pin",
    name: "记一下",
    group: "way",
    keywords: "标记 位置 定位 重点 钉 jiyixia biaoji pin location mark",
    hue: "red",
    svg: `<ellipse data-a="shadow" class="shade hue-slate" cx="12" cy="21.3" rx="3.4" ry=".95"/>
    <g data-a="pin">
      <path class="t" d="M12 20.4s-6.4-5.8-6.4-10.9a6.4 6.4 0 0 1 12.8 0c0 5.1-6.4 10.9-6.4 10.9z"/>
      <circle class="p" cx="12" cy="9.5" r="2.4"/>
    </g>`,
    motion: {
      pin: {
        steps: [
          [0, { y: -7, o: 0 }, IN],
          [0.08, { o: 1 }, IN],
          [0.3, { y: 0 }, OUT],
          [0.36, { sy: 0.84, sx: 1.12 }, OUT],
          [0.48, { y: -2.2, sx: 1, sy: 1 }, IN],
          [0.6, { y: 0 }, OUT],
          [0.65, { sy: 0.94, sx: 1.05 }, SOFT],
          [0.74, { sx: 1, sy: 1 }],
        ],
        duration: 1250,
        origin: "50% 100%",
      },
      shadow: {
        steps: [
          [0, { s: 0.3 }, IN],
          [0.3, { s: 1.12 }, OUT],
          [0.48, { s: 0.75 }, IN],
          [0.6, { s: 1.05 }, SOFT],
          [0.74, { s: 1 }],
        ],
        duration: 1250,
      },
    },
  },
  {
    id: "bell",
    name: "提醒",
    group: "way",
    keywords: "铃铛 闹钟 通知 别忘了 叮 tixing lingdang bell remind",
    hue: "amber",
    svg: `<path data-a="waveL" class="o fx" d="M3.6 6.6c-1 1.2-1.4 2.6-1.4 4"/>
    <path data-a="waveR" class="o fx" d="M20.4 6.6c1 1.2 1.4 2.6 1.4 4"/>
    <path data-a="clapper" class="k" d="M10.1 17.6a1.9 1.9 0 0 0 3.8 0z"/>
    <g data-a="bell">
      <path class="o" d="M12 2.2v1.4"/>
      <path class="t" d="M12 3.6c-3.1 0-5.2 2.4-5.2 5.6v3.3L5 15.9h14l-1.8-3.4V9.2c0-3.2-2.1-5.6-5.2-5.6z"/>
    </g>`,
    motion: {
      bell: {
        steps: [
          [0, {}, SOFT],
          [0.09, { r: 16 }, SOFT],
          [0.2, { r: -14 }, SOFT],
          [0.31, { r: 10 }, SOFT],
          [0.42, { r: -7 }, SOFT],
          [0.53, { r: 4 }, SOFT],
          [0.64, { r: -2 }, SOFT],
          [0.75, { r: 0 }],
        ],
        duration: 1400,
        box: "view",
        origin: "12px 2.4px",
      },
      clapper: {
        steps: [
          [0, {}, SOFT],
          [0.13, { x: -1.5 }, SOFT],
          [0.24, { x: 1.4 }, SOFT],
          [0.35, { x: -1 }, SOFT],
          [0.46, { x: 0.7 }, SOFT],
          [0.57, { x: -0.4 }, SOFT],
          [0.7, { x: 0 }],
        ],
        duration: 1400,
      },
      waveL: {
        steps: [
          [0, { o: 0, x: 1 }, OUT],
          [0.12, { o: 1, x: 0 }, SOFT],
          [0.45, { o: 0, x: -1 }],
        ],
        duration: 1400,
        delay: 60,
      },
      waveR: {
        steps: [
          [0, { o: 0, x: -1 }, OUT],
          [0.12, { o: 1, x: 0 }, SOFT],
          [0.45, { o: 0, x: 1 }],
        ],
        duration: 1400,
        delay: 180,
      },
    },
  },
  {
    id: "hourglass",
    name: "等等",
    group: "way",
    keywords: "沙漏 时间 稍后 等待 进行中 dengdeng shalou hourglass wait later",
    hue: "amber",
    svg: `<path data-a="sandTop" class="k" d="M9.2 6.4h5.6c-.6 1.5-2 2.6-2.8 3.4-.8-.8-2.2-1.9-2.8-3.4z"/>
    <path data-a="sandBottom" class="k" d="M9.4 20.1h5.2c-.4-1.3-1.5-2-2.6-2.4-1.1.4-2.2 1.1-2.6 2.4z"/>
    <path data-a="stream" class="o fx thin" d="M12 11.2v6"/>
    <g data-a="frame" class="hue-slate">
      <path class="o" d="M5.8 2.8h12.4M5.8 21.2h12.4"/>
      <path class="o" d="M7.6 2.8c0 4.1 4.4 6 4.4 9.2s-4.4 5.1-4.4 9.2M16.4 2.8c0 4.1-4.4 6-4.4 9.2s4.4 5.1 4.4 9.2"/>
    </g>`,
    // 沙子不跟着翻：翻转前淡出、翻完（框是中心对称的，转 180° 看不出来）再以静止态淡入
    motion: {
      sandTop: {
        steps: [
          [0, {}, SOFT],
          [0.52, { s: 0.25 }, OUT],
          [0.58, { o: 0 }],
          [0.84, { s: 1 }, OUT],
          [0.96, { o: 1 }],
        ],
        duration: 1800,
        origin: "50% 100%",
      },
      sandBottom: {
        steps: [
          [0, {}, SOFT],
          [0.52, { sy: 1.9, sx: 1.2 }, OUT],
          [0.58, { o: 0 }],
          [0.84, { sx: 1, sy: 1 }, OUT],
          [0.96, { o: 1 }],
        ],
        duration: 1800,
        origin: "50% 100%",
      },
      stream: {
        steps: [
          [0, { o: 0 }, OUT],
          [0.06, { o: 1 }],
          [0.48, { o: 1 }, OUT],
          [0.54, { o: 0 }],
        ],
        duration: 1800,
      },
      frame: {
        steps: [
          [0, {}],
          [0.54, { r: 0 }, IN_OUT],
          [0.86, { r: 180 }],
        ],
        duration: 1800,
        box: "view",
        origin: "12px 12px",
        seamless: true,
      },
    },
  },
  {
    id: "write",
    name: "记下来",
    group: "way",
    keywords: "写 记录 笔记 铅笔 日记 jixialai xie biji write note pencil",
    hue: "amber",
    svg: `<path data-a="line" class="o draw hue-slate" pathLength="1" d="M2.6 20.4c1.2-1.3 2.1-1.3 3 0s1.8 1.3 3 0 2.1-1.3 3 0"/>
    <g data-a="pencil"><g transform="translate(11.8 20.2) rotate(40) translate(-12 -18.6)">
      <path class="t" d="M10.3 4.6h3.4v10.6L12 18.6l-1.7-3.4z"/>
      <path class="o" d="M10.3 15.2h3.4"/>
      <path class="k hue-slate" d="M11.4 17.4l.6 1.2.6-1.2z"/>
      <path class="t hue-pink" d="M10.3 4.6V3.3a1.7 1.7 0 0 1 3.4 0v1.3z"/>
    </g></g>`,
    motion: {
      pencil: {
        steps: [
          [0, { x: -9, y: 0 }, SOFT],
          [0.12, { x: -7.5, y: -1.2 }, SOFT],
          [0.24, { x: -6, y: 0 }, SOFT],
          [0.36, { x: -4.5, y: -1.2 }, SOFT],
          [0.48, { x: -3, y: 0 }, SOFT],
          [0.6, { x: -1.5, y: -1.2 }, SOFT],
          [0.72, { x: 0, y: 0 }, OUT],
          [0.8, { r: -8 }, SOFT],
          [0.9, { r: 0 }],
        ],
        duration: 1500,
        box: "view",
        origin: "11.8px 20.2px",
      },
      line: {
        steps: [
          [0, { d: 1 }],
          [0.72, { d: 0 }],
        ],
        duration: 1500,
      },
    },
  },

  /* ============================ 日常 ============================ */
  {
    id: "sun",
    name: "晴天",
    group: "daily",
    keywords: "太阳 晴 早安 阳光 好天气 qingtian taiyang sun sunny morning",
    hue: "amber",
    svg: `<g data-a="rays" class="o">
      <path d="M12 1.6v2.2M12 20.2v2.2M1.6 12h2.2M20.2 12h2.2M4.6 4.6l1.5 1.5M17.9 17.9l1.5 1.5M4.6 19.4l1.5-1.5M17.9 6.1l1.5-1.5"/>
    </g>
    <circle data-a="core" class="t" cx="12" cy="12" r="4.8"/>`,
    motion: {
      rays: {
        steps: [
          [0, { r: 0, s: 1 }, SOFT],
          [0.5, { r: 22.5, s: 0.82 }, SOFT],
          [1, { r: 45, s: 1 }],
        ],
        duration: 1700,
        box: "view",
        origin: "12px 12px",
        seamless: true,
      },
      core: {
        steps: [
          [0, {}, OUT],
          [0.22, { s: 1.14 }, SOFT],
          [0.46, { s: 0.96 }, SOFT],
          [0.66, { s: 1 }],
        ],
        duration: 1700,
      },
    },
  },
  {
    id: "rain",
    name: "下雨",
    group: "daily",
    keywords: "雨 阴天 低落 天气 xiayu yu rain rainy",
    hue: "sky",
    svg: `<path data-a="drop1" class="o" d="M8.4 18.3l-.8 2"/>
    <path data-a="drop2" class="o" d="M12.2 18.3l-.8 2"/>
    <path data-a="drop3" class="o" d="M16 18.3l-.8 2"/>
    <path data-a="cloud" class="t" d="M7.2 15.5a4.2 4.2 0 0 1-.6-8.4 5.6 5.6 0 0 1 10.7 1.5 3.5 3.5 0 0 1 .2 6.9z"/>`,
    motion: {
      cloud: {
        steps: [
          [0, {}, SOFT],
          [0.3, { y: -0.7 }, SOFT],
          [0.6, { y: 0.3 }, SOFT],
          [0.8, { y: 0 }],
        ],
        duration: 1600,
      },
      drop1: {
        steps: [
          [0, {}, IN],
          [0.44, { o: 0, x: -0.9, y: 2.6 }],
          [0.45, { o: 0, x: 0.5, y: -1.4 }, OUT],
          [1, { o: 1, x: 0, y: 0 }],
        ],
        duration: 800,
        iterations: 2,
      },
      drop2: {
        steps: [
          [0, {}, IN],
          [0.44, { o: 0, x: -0.9, y: 2.6 }],
          [0.45, { o: 0, x: 0.5, y: -1.4 }, OUT],
          [1, { o: 1, x: 0, y: 0 }],
        ],
        duration: 800,
        delay: 160,
        iterations: 2,
      },
      drop3: {
        steps: [
          [0, {}, IN],
          [0.44, { o: 0, x: -0.9, y: 2.6 }],
          [0.45, { o: 0, x: 0.5, y: -1.4 }, OUT],
          [1, { o: 1, x: 0, y: 0 }],
        ],
        duration: 800,
        delay: 320,
        iterations: 2,
      },
    },
  },
  {
    id: "moon",
    name: "晚安",
    group: "daily",
    keywords: "月亮 夜 睡觉 休息 困 wanan yueliang moon night sleep",
    hue: "purple",
    svg: `<path data-a="moon" class="t" d="M19.6 14.9A8 8 0 1 1 9.1 4.4a6.3 6.3 0 0 0 10.5 10.5z"/>
    <path data-a="star1" class="k hue-amber" d="M17.4 2.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z"/>
    <path data-a="star2" class="k hue-amber" d="M21 8.6l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"/>`,
    motion: {
      moon: {
        steps: [
          [0, {}, SOFT],
          [0.3, { r: -12 }, SOFT],
          [0.62, { r: 5 }, SOFT],
          [0.84, { r: 0 }],
        ],
        duration: 1700,
      },
      star1: {
        steps: [
          [0, {}, IN_OUT],
          [0.18, { s: 0.2, o: 0.3 }, OUT],
          [0.38, { s: 1.3, o: 1, r: 45 }, SOFT],
          [0.54, { s: 1, r: 90 }],
        ],
        duration: 1700,
        seamless: true,
      },
      star2: {
        steps: [
          [0, {}, IN_OUT],
          [0.18, { s: 0.2, o: 0.3 }, OUT],
          [0.38, { s: 1.35, o: 1, r: 45 }, SOFT],
          [0.54, { s: 1, r: 90 }],
        ],
        duration: 1700,
        delay: 300,
        seamless: true,
      },
    },
  },
  {
    id: "sprout",
    name: "成长",
    group: "daily",
    keywords: "发芽 长大 进步 植物 新开始 chengzhang faya sprout grow plant",
    hue: "green",
    svg: `<path class="o hue-brown" d="M5.4 20.6h13.2"/>
    <g data-a="plant">
      <path class="o" d="M12 20.6v-8.8"/>
      <path data-a="leafL" class="t" d="M12 14.4c-3.9.3-6.5-1.8-6.7-5.6 3.9-.2 6.4 1.8 6.7 5.6z"/>
      <path data-a="leafR" class="t" d="M12 11.9c.2-4 2.8-6.3 6.9-6.2-.1 3.9-2.7 6.2-6.9 6.2z"/>
    </g>`,
    motion: {
      plant: {
        steps: [
          [0, { sy: 0.3 }, OUT],
          [0.3, { sy: 1.06 }, SOFT],
          [0.44, { sy: 1 }, SOFT],
          [0.6, { r: -5 }, SOFT],
          [0.76, { r: 3 }, SOFT],
          [0.9, { r: 0 }],
        ],
        duration: 1600,
        origin: "50% 100%",
      },
      leafL: {
        steps: [
          [0, { s: 0, r: 35 }],
          [0.16, { s: 0, r: 35 }, OUT],
          [0.42, { s: 1.1, r: -5 }, SOFT],
          [0.56, { s: 1, r: 0 }],
        ],
        duration: 1600,
        origin: "100% 100%",
      },
      leafR: {
        steps: [
          [0, { s: 0, r: -35 }],
          [0.24, { s: 0, r: -35 }, OUT],
          [0.5, { s: 1.1, r: 5 }, SOFT],
          [0.64, { s: 1, r: 0 }],
        ],
        duration: 1600,
        origin: "0% 100%",
      },
    },
  },
  {
    id: "star",
    name: "闪亮",
    group: "daily",
    keywords: "星星 收藏 优秀 棒 亮点 shanliang xingxing star great",
    hue: "amber",
    svg: `<path data-a="star" class="t" d="M12 3.6l2.5 5.6 6.1.6-4.6 4.1 1.3 6-5.3-3.1-5.3 3.1 1.3-6-4.6-4.1 6.1-.6z"/>
    <path data-a="glintA" class="k fx" d="M20.2 1.6l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"/>
    <path data-a="glintB" class="k fx" d="M3.6 16.8l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"/>`,
    motion: {
      star: {
        steps: [
          [0, { r: 0, s: 1 }, OUT],
          [0.14, { s: 0.8, r: -14 }, OUT],
          [0.46, { s: 1.14, r: 72 }, SOFT],
          [0.62, { s: 1, r: 72 }],
        ],
        duration: 1300,
        box: "view",
        origin: "12px 12.6px",
        seamless: true,
      },
      glintA: {
        steps: [
          [0, { o: 0, s: 0 }],
          [0.36, { o: 0, s: 0 }, OUT],
          [0.52, { o: 1, s: 1.2, r: 45 }, SOFT],
          [0.74, { o: 0, s: 0.5, r: 90 }],
        ],
        duration: 1300,
      },
      glintB: {
        steps: [
          [0, { o: 0, s: 0 }],
          [0.44, { o: 0, s: 0 }, OUT],
          [0.6, { o: 1, s: 1.2, r: 45 }, SOFT],
          [0.82, { o: 0, s: 0.5, r: 90 }],
        ],
        duration: 1300,
      },
    },
  },
  {
    id: "party",
    name: "庆祝",
    group: "daily",
    keywords: "派对 撒花 恭喜 耶 成功 qingzhu sahua gongxi party tada yay",
    hue: "purple",
    svg: `<g data-a="cone">
      <path class="t" d="M3.4 20.6l3.7-11 7.3 7.3z"/>
      <path class="o thin" d="M5.4 14.7l3.9 3.9M6.4 11.7l5.9 5.9"/>
    </g>
    <circle data-a="c1" class="k hue-red" cx="14.6" cy="5.4" r="1.05"/>
    <path data-a="c2" class="o hue-blue" d="M18.6 9.6l1.8-.8"/>
    <circle data-a="c3" class="k hue-amber" cx="19.9" cy="14.3" r="1"/>
    <path data-a="c4" class="o hue-green" d="M10.1 4.4l.5-1.8"/>
    <circle data-a="c5" class="k hue-sky" cx="20.9" cy="4.3" r=".8"/>
    <path data-a="streamer" class="o draw hue-pink" pathLength="1" d="M11.2 11.4c.9-2.3 2.9-2.3 3.4-4.2"/>`,
    motion: {
      cone: {
        steps: [
          [0, {}, OUT],
          [0.08, { r: -10, s: 0.9 }, OUT],
          [0.24, { r: 4, s: 1.05 }, SOFT],
          [0.4, { r: 0, s: 1 }],
        ],
        duration: 1400,
        origin: "0% 100%",
      },
      c1: { steps: burst(14.6, 5.4), duration: 1400, delay: 60 },
      c2: { steps: burst(19.5, 9.2), duration: 1400, delay: 40 },
      c3: { steps: burst(19.9, 14.3), duration: 1400, delay: 90 },
      c4: { steps: burst(10.4, 3.5), duration: 1400, delay: 20 },
      c5: { steps: burst(20.9, 4.3), duration: 1400, delay: 120 },
      streamer: {
        steps: [
          [0, { d: 1 }],
          [0.08, { d: 1 }, OUT],
          [0.46, { d: 0 }],
        ],
        duration: 1400,
      },
    },
  },
];
