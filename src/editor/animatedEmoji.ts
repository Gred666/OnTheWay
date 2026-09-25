import { ANIMATED_EMOJI_FALLBACK } from "@/lib/emojiText";
import {
  ANIMATED_EMOJI_DESIGNS,
  type AnimatedEmojiDesign,
  EMOJI_HUES,
  type EmojiMotion,
  type Pose,
  type Step,
} from "./animatedEmojiSet";

/* ============================================================
   动态表情：`:otw_fire:` 这类短码 → 自己画的 SVG 动画。

   为什么不是 GIF / Lottie：这套图是我们自己画的线稿，SVG + Web Animations
   API 就够了 —— 矢量、任意缩放都清晰、颜色跟主题变量走、能精确控制
   「播一次 / 悬停重播 / 循环」、减少动效时停在静止帧，而且不用引 WASM、
   不用改 CSP。以后要接外部的彩色动画表情，再上 Lottie。

   Markdown 源文里始终只是短码。别的编辑器打开看到的是 `:otw_fire:`，
   摘要里换成对应的 Unicode 表情（lib/emojiText.ts）。

   这个文件不依赖 CodeMirror：选择器和编辑器替身（widgets.ts）共用它。
   ============================================================ */

export type AnimatedEmoji = AnimatedEmojiDesign & {
  /** 完整短码，带冒号：`:otw_fire:` */
  readonly shortcode: string;
  /** 对应的 Unicode 表情：摘要、纯文本、复制到别处时用它 */
  readonly fallback: string;
};

export const SHORTCODE_PREFIX = "otw_";

export const ANIMATED_EMOJIS: readonly AnimatedEmoji[] = ANIMATED_EMOJI_DESIGNS.map((design) => ({
  ...design,
  shortcode: `:${SHORTCODE_PREFIX}${design.id}:`,
  fallback: ANIMATED_EMOJI_FALLBACK[design.id] ?? "",
}));

const byName = new Map(ANIMATED_EMOJIS.map((emoji) => [`${SHORTCODE_PREFIX}${emoji.id}`, emoji]));

/** `:otw_fire:` / `otw_fire` → 表情；不是这套里的返回 null。大小写不敏感，和 emojiFor 一致。 */
export function animatedEmojiFor(shortcode: string): AnimatedEmoji | null {
  const name = shortcode.replace(/^:|:$/g, "").toLowerCase();
  return byName.get(name) ?? null;
}

/* ---------------- 关键帧 ---------------- */

const IDENTITY: Required<Pose> = { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1, kx: 0, ky: 0, o: 1, d: 0 };

const round = (value: number) => Math.round(value * 1000) / 1000;

/** 把 steps 展开成完整姿态：没写的量沿用上一帧，第一帧从静止态出发。 */
export function resolvePoses(steps: readonly Step[]): Array<Required<Pose>> {
  const poses: Array<Required<Pose>> = [];
  let current = { ...IDENTITY };
  for (const [, pose] of steps) {
    const next = { ...current, ...pose };
    // 只给 s 时它同时决定两个方向；单独给 sx / sy 时覆盖对应方向
    if (pose.s !== undefined) {
      next.sx = pose.sx ?? pose.s;
      next.sy = pose.sy ?? pose.s;
    }
    poses.push(next);
    current = next;
  }
  return poses;
}

/**
 * steps → Web Animations 关键帧。
 * transform 每一帧都写成同样的函数序列，浏览器就逐项插值，
 * 不会退化成矩阵分解（那样旋转和缩放一起动时会走弯路）。
 */
export function keyframesOf(steps: readonly Step[]): Keyframe[] {
  const poses = resolvePoses(steps);
  const uses = (keys: Array<keyof Pose>) =>
    steps.some(([, pose]) => keys.some((key) => key in pose));
  const moves = uses(["x", "y", "r", "s", "sx", "sy", "kx", "ky"]);
  const fades = uses(["o"]);
  const draws = uses(["d"]);
  // 最后一步不在 1 上时补一帧原地停住。不补的话浏览器会拿静止值当隐含的末帧，
  // 从最后一步一路插值回去 —— 转了 72° 的星星又会慢慢转回来。
  const last = steps.at(-1);
  const padded: readonly Step[] =
    last && last[0] < 1 ? [...steps.slice(0, -1), [last[0], last[1]], [1, {}]] : steps;
  const held = last && last[0] < 1 ? [...poses, poses.at(-1)!] : poses;
  return padded.map(([offset, , easing], index) => {
    const pose = held[index]!;
    const frame: Keyframe = { offset };
    if (moves) {
      frame.transform =
        `translate(${round(pose.x)}px, ${round(pose.y)}px) rotate(${round(pose.r)}deg) ` +
        `skewX(${round(pose.kx)}deg) skewY(${round(pose.ky)}deg) scale(${round(pose.sx)}, ${round(pose.sy)})`;
    }
    if (fades) frame.opacity = round(pose.o);
    if (draws) frame.strokeDashoffset = String(round(pose.d));
    if (easing) frame.easing = easing;
    return frame;
  });
}

/** 一个表情播完一轮要多久（含各部件的延迟和重复），循环时据此排下一轮。 */
export function motionLength(emoji: AnimatedEmojiDesign): number {
  return Math.max(
    0,
    ...Object.values(emoji.motion).map(
      (motion: EmojiMotion) => (motion.delay ?? 0) + motion.duration * (motion.iterations ?? 1),
    ),
  );
}

const keyframeCache = new Map<string, Map<string, Keyframe[]>>();

function keyframesFor(emoji: AnimatedEmoji): Map<string, Keyframe[]> {
  let frames = keyframeCache.get(emoji.id);
  if (!frames) {
    frames = new Map(
      Object.entries(emoji.motion).map(([part, motion]) => [part, keyframesOf(motion.steps)]),
    );
    keyframeCache.set(emoji.id, frames);
  }
  return frames;
}

/* ---------------- 部件样式 ----------------
   配色类的样式放在这里而不是 globals.css：同一份规则要用两次 —— 注入到页面给
   动起来的 SVG 用，再原样嵌进静止帧的图片里（图片是独立文档，看不到页面的样式表）。
   色相变量 --ae-* 和纸色、墨色仍然是 globals.css 里的主题 token。 */

export const EMOJI_PART_CSS = [
  ".otw-ae-svg{--h:var(--ae-amber)}",
  ...EMOJI_HUES.map(
    (hue) => `.otw-ae-svg.hue-${hue},.otw-ae-svg .hue-${hue}{--h:var(--ae-${hue})}`,
  ),
  ".otw-ae-svg .o{fill:none;stroke:var(--h)}",
  ".otw-ae-svg .t{fill:color-mix(in srgb,var(--h) 22%,var(--ae-paper));stroke:var(--h)}",
  // 笑脸的底色要更「黄」一点，不然看着是米色
  ".otw-ae-svg .t.face{fill:color-mix(in srgb,var(--h) 34%,var(--ae-paper))}",
  // 更浓的一档：西瓜瓤、柠檬这种本身颜色就饱满的东西
  ".otw-ae-svg .t.rich{fill:color-mix(in srgb,var(--h) 48%,var(--ae-paper))}",
  ".otw-ae-svg .k{fill:var(--h);stroke:none}",
  ".otw-ae-svg .p{fill:var(--ae-paper);stroke:var(--h)}",
  // 五官：色相混进墨色，亮色下偏深、暗色下偏亮
  ".otw-ae-svg .i{fill:none;stroke:color-mix(in srgb,var(--h) 45%,var(--color-ink))}",
  ".otw-ae-svg .ik{fill:color-mix(in srgb,var(--h) 45%,var(--color-ink));stroke:none}",
  ".otw-ae-svg .blush{fill:var(--ae-pink);stroke:none;opacity:.32}",
  ".otw-ae-svg .shine{fill:none;stroke:var(--ae-paper);stroke-width:1.4;opacity:.85}",
  ".otw-ae-svg .shade{fill:var(--h);stroke:none;opacity:.28}",
  ".otw-ae-svg .road{fill:none;stroke:color-mix(in srgb,var(--h) 22%,var(--ae-paper));stroke-width:4.2}",
  ".otw-ae-svg .bold{stroke-width:2.1}",
  ".otw-ae-svg .thin{stroke-width:1.3}",
  ".otw-ae-svg .draw{stroke-dasharray:1 1}",
  ".otw-ae-svg .dash{stroke-dasharray:.1 .08}",
  ".otw-ae-svg .fx{opacity:0}",
  ".otw-ae-svg [data-a],.otw-ae-svg .otw-ae-body{transform-box:fill-box;transform-origin:center}",
].join("\n");

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.dataset.otwAnimatedEmoji = "";
  style.textContent = EMOJI_PART_CSS;
  document.head.append(style);
}

/* ---------------- SVG 模板 ---------------- */

const SVG_NS = "http://www.w3.org/2000/svg";
/** 画布：24×24。活的 SVG 和静止帧的外框都用它，和优化前逐像素一致。 */
export const EMOJI_VIEWBOX = "0 0 24 24";
/**
 * 静止帧那张图自己的画布：四周各多留 3 个单位。图片会裁掉自身 viewBox 以外的
 * 部分，留出余量才装得下贴边的描边；这张图在外框里放在 (-3, -3)，大小 30，
 * 外框 overflow: visible，画出来和活的 SVG 落在同一套坐标上。
 */
const STILL_VIEWBOX = "-3 -3 30 30";
const templates = new Map<string, SVGSVGElement>();

/** 解析一次设计稿，之后每个实例 cloneNode —— 一屏几十个表情也只解析一遍。 */
function templateFor(emoji: AnimatedEmoji): SVGSVGElement {
  const cached = templates.get(emoji.id);
  if (cached) return cached;
  // 标签之间的换行缩进会变成空白文本节点，混进 textContent（目录、复制）里，先去掉
  const markup = emoji.svg.replace(/>\s+</g, "><").trim();
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${markup}</svg>`,
    "image/svg+xml",
  ).documentElement;
  const root = document.createElementNS(SVG_NS, "svg");
  root.setAttribute("viewBox", EMOJI_VIEWBOX);
  root.setAttribute("class", `otw-ae-svg otw-ae-live hue-${emoji.hue}`);
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  root.setAttribute("fill", "none");
  root.setAttribute("stroke-width", "1.7");
  root.setAttribute("stroke-linecap", "round");
  root.setAttribute("stroke-linejoin", "round");
  // 外面再包一层：插入时整个表情「啵」地弹出来，动的是这一层
  const body = document.createElementNS(SVG_NS, "g");
  body.setAttribute("class", "otw-ae-body");
  for (const child of Array.from(parsed.childNodes)) body.append(document.importNode(child, true));
  root.append(body);
  for (const part of root.querySelectorAll<SVGElement>("[data-a]")) {
    const motion = emoji.motion[part.dataset.a ?? ""];
    if (!motion) continue;
    if (motion.box === "view") part.style.setProperty("transform-box", "view-box");
    if (motion.origin) part.style.setProperty("transform-origin", motion.origin);
  }
  templates.set(emoji.id, root);
  return root;
}

/* ---------------- 静止帧：一张图 ----------------
   绝大多数时候表情是静止的。一个活的 SVG 大约 10 个元素，每个都要算样式；
   一屏几百个时光样式重算就上百毫秒。静止时换成一张图：同一份 SVG 连同
   当前主题解析好的颜色序列化成 data: 图片，每个表情每套主题只生成一次，
   同一张图在页面里画多少遍都只解析一次。动起来的时候才把活的 SVG 叠上去。

   图不用 <img> 画，而是放进一个和活的 SVG 同框同 viewBox 的小 <svg> 里用
   <image> 画：<img> 的落点会被吸附到整设备像素，而行内 SVG 按亚像素位置
   绘制，表情在一行字里的位置几乎总是小数 —— 用 <img> 的话静止帧和动起来
   的第一帧会差出半个像素，一播放就「抖」一下。外框也保持优化前的尺寸和
   viewBox：换了框（哪怕数学上等价），浏览器的像素吸附会让整个表情挪一个
   设备像素。 */

/** 静止帧要用到的主题变量：色相、纸色（画布）、墨色 */
const PALETTE_VARS = [
  ...EMOJI_HUES.map((hue) => `--ae-${hue}`),
  "--color-canvas",
  "--color-ink",
] as const;

let palette: string | null = null;
const stillUrls = new Map<string, string>();
let themeWatcher: MutationObserver | null = null;

/**
 * 当前主题下的颜色声明。样式表还没加载（或者在没有样式的测试环境里）时拿不到
 * 颜色，返回 null —— 那就不用图片，静止帧直接用活的 SVG；null 不缓存，
 * 样式表一到下一个表情就能用上图片。
 */
function currentPalette(): string | null {
  if (palette) return palette;
  watchTheme();
  const style = getComputedStyle(document.documentElement);
  const values = PALETTE_VARS.map((name) => [name, style.getPropertyValue(name).trim()] as const);
  palette = values.every(([, value]) => value)
    ? `${values.map(([name, value]) => `${name}:${value}`).join(";")};--ae-paper:var(--color-canvas)`
    : null;
  return palette;
}

/** 切换主题：重新取颜色，页面上所有静止帧换成新主题下的图 */
function watchTheme(): void {
  if (themeWatcher || typeof MutationObserver === "undefined") return;
  themeWatcher = new MutationObserver(() => {
    const before = palette;
    palette = null;
    if (currentPalette() === before) return;
    stillUrls.clear();
    for (const still of document.querySelectorAll<SVGSVGElement>("svg.otw-ae-still")) {
      const emoji = byName.get(`${SHORTCODE_PREFIX}${still.dataset.emoji}`);
      const url = emoji && stillUrl(emoji);
      if (url) still.firstElementChild?.setAttribute("href", url);
    }
  });
  themeWatcher.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

function stillUrl(emoji: AnimatedEmoji): string | null {
  const colors = currentPalette();
  if (!colors) return null;
  let url = stillUrls.get(emoji.id);
  if (!url) {
    const svg = templateFor(emoji).cloneNode(true) as SVGSVGElement;
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("viewBox", STILL_VIEWBOX);
    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = `svg{${colors}}\n${EMOJI_PART_CSS}`;
    svg.prepend(style);
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    stillUrls.set(emoji.id, url);
  }
  return url;
}

/** 静止帧：<svg viewBox="0 0 24 24"><image x=-3 y=-3 30×30/></svg>，和活的 SVG 同框同坐标 */
function stillElement(emoji: AnimatedEmoji, url: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", EMOJI_VIEWBOX);
  svg.setAttribute("class", "otw-ae-still");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.dataset.emoji = emoji.id;
  const image = document.createElementNS(SVG_NS, "image");
  const [x, y, size] = STILL_VIEWBOX.split(" ");
  image.setAttribute("x", x!);
  image.setAttribute("y", y!);
  image.setAttribute("width", size!);
  image.setAttribute("height", size!);
  image.setAttribute("href", url);
  svg.append(image);
  return svg;
}

/* ---------------- 播放 ---------------- */

/** 应用内开关或系统偏好要求减少动效。 */
export function motionReduced(): boolean {
  if (document.documentElement.dataset.reduceMotion === "true") return true;
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 插入时整个表情先弹出来，本体动作晚这么多再开始。 */
const INTRO_LEAD = 180;
const INTRO_FRAMES: Keyframe[] = [
  { transform: "scale(0.2) rotate(-18deg)", opacity: 0, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  { transform: "scale(1.14) rotate(4deg)", opacity: 1, offset: 0.6, easing: "ease-in-out" },
  { transform: "scale(1) rotate(0deg)", opacity: 1 },
];

/**
 * 一个表情实例。静止时宿主里只有一张图（拿不到主题颜色时退回活的 SVG）；
 * 播放时把活的 SVG 叠上去、把图藏起来（display: none，不卸载，图片资源还在，换回来不会闪），
 * 播完再摘掉。两者同一个 viewBox、同一个框，静止帧像素一致。
 */
export class EmojiPlayer {
  private host: HTMLElement | null = null;
  private still: SVGSVGElement | null = null;
  private live: SVGSVGElement | null = null;
  private running: Animation[] = [];
  /** 每次 play 递增：被打断的那一轮播完时不该去摘新一轮的 SVG */
  private round = 0;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private looping = false;

  constructor(readonly emoji: AnimatedEmoji) {}

  /** 放进宿主（一个 .otw-ae 框） */
  mount(host: HTMLElement): void {
    injectStyles();
    this.host = host;
    const url = stillUrl(this.emoji);
    this.still = url ? stillElement(this.emoji, url) : this.liveElement();
    host.prepend(this.still);
  }

  /** 当前显示的活 SVG（没在播时为 null，退回模式下就是静止帧本身） */
  get liveSvg(): SVGSVGElement | null {
    return this.live?.isConnected ? this.live : null;
  }

  get playing(): boolean {
    return this.running.some((animation) => animation.playState === "running");
  }

  /**
   * 从头播一遍。intro：先整个弹出来再做动作（刚插入时用）。
   * 减少动效时什么也不做 —— 静止态本身就是一张完整的图。
   */
  play(options: { intro?: boolean } = {}): Promise<void> {
    this.cancel();
    const round = ++this.round;
    if (motionReduced() || !this.host) return Promise.resolve();
    const svg = this.showLive();
    if (typeof svg.animate !== "function") {
      this.hideLive();
      return Promise.resolve();
    }
    const lead = options.intro ? INTRO_LEAD : 0;
    const frames = keyframesFor(this.emoji);
    if (options.intro) {
      const body = svg.querySelector<SVGGElement>(".otw-ae-body");
      if (body) this.running.push(body.animate(INTRO_FRAMES, { duration: 420, fill: "backwards" }));
    }
    for (const part of svg.querySelectorAll<SVGElement>("[data-a]")) {
      const name = part.dataset.a ?? "";
      const motion = this.emoji.motion[name];
      const keyframes = frames.get(name);
      if (!motion || !keyframes) continue;
      this.running.push(
        part.animate(keyframes, {
          duration: motion.duration,
          delay: lead + (motion.delay ?? 0),
          iterations: motion.iterations ?? 1,
          // 带延迟的部件（彩纸、泪滴）在开始前就得处于第一帧，不然会先闪一下静止态
          fill: "backwards",
        }),
      );
    }
    const settle = () => {
      // 播完（或被 stop 打断）后摘掉活的 SVG；被新一轮 play 打断的不管，交给新一轮
      if (round === this.round && !this.looping) this.hideLive();
    };
    // cancel() 会让 finished 以 AbortError 拒绝：被打断不是错误
    return Promise.all(this.running.map((animation) => animation.finished)).then(settle, settle);
  }

  /** 循环播放，两轮之间停 gap 毫秒。选择器里的当前项用它。 */
  loop(gap = 650): void {
    this.stop();
    if (motionReduced()) return;
    this.looping = true;
    const next = () => {
      if (!this.looping) return;
      void this.play().then(() => {
        if (!this.looping) return;
        this.loopTimer = setTimeout(next, gap);
      });
    };
    next();
  }

  /** 停下并回到静止态。 */
  stop(): void {
    this.looping = false;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    this.round += 1;
    this.cancel();
    this.hideLive();
  }

  private liveElement(): SVGSVGElement {
    this.live ??= templateFor(this.emoji).cloneNode(true) as SVGSVGElement;
    return this.live;
  }

  private showLive(): SVGSVGElement {
    const svg = this.liveElement();
    if (svg === this.still) return svg;
    if (!svg.isConnected) this.host?.prepend(svg);
    // display: none：播放期间静止帧不参与布局和绘制；元素和图片资源都留着，换回来不用重新加载
    if (this.still) this.still.style.display = "none";
    return svg;
  }

  private hideLive(): void {
    if (!this.live || this.live === this.still) return;
    this.live.remove();
    if (this.still) this.still.style.display = "";
  }

  private cancel(): void {
    const running = this.running;
    this.running = [];
    for (const animation of running) animation.cancel();
  }
}

/* ---------------- 进入视口才播 ----------------
   CodeMirror 会把视口上下一段距离内的行都渲染出来，挂载 ≠ 看得见。
   全编辑器共用一个 IntersectionObserver，第一次露出来时播一遍。 */

const onVisible = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | null = null;

function visibilityObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const callback = onVisible.get(entry.target);
      observer?.unobserve(entry.target);
      onVisible.delete(entry.target);
      callback?.();
    }
  });
  return observer;
}

export function whenVisible(element: Element, callback: () => void): void {
  const io = visibilityObserver();
  if (!io) {
    callback();
    return;
  }
  onVisible.set(element, callback);
  io.observe(element);
}

export function forgetVisibility(element: Element): void {
  onVisible.delete(element);
  observer?.unobserve(element);
}

/* ---------------- 自动播放的预算 ----------------
   一屏几百个表情同时动，每个表情几个部件、每个部件一条 SVG 动画，软件渲染下
   能掉到十几帧。「出现时播一遍」这种自动播放同一时刻最多放行这么多个，
   其余的保持静止帧；悬停、点击、刚插入这些用户自己触发的不受限。 */

export const AUTO_PLAY_LIMIT = 12;
let autoPlaying = 0;

/** 预算内就播一遍，超了就不播。返回是否真的播了。 */
export function autoPlay(player: EmojiPlayer): boolean {
  if (autoPlaying >= AUTO_PLAY_LIMIT || motionReduced()) return false;
  autoPlaying += 1;
  // 被打断（重播、销毁）时 play() 同样会 resolve，名额一定会还回来
  void player.play().then(() => {
    autoPlaying -= 1;
  });
  return true;
}

/* ---------------- 刚从选择器插入的那一个 ----------------
   插入时想要「啵」地弹出来，但 widget 只看得到自己的短码。选择器插入前
   在这里记一笔，接下来一小段时间里第一个挂载的同名 widget 把它领走。 */

let primed: { id: string; until: number } | null = null;

export function primeIntro(emoji: AnimatedEmoji): void {
  primed = { id: emoji.id, until: Date.now() + 1000 };
}

export function takeIntro(emoji: AnimatedEmoji): boolean {
  if (!primed || primed.id !== emoji.id || Date.now() > primed.until) return false;
  primed = null;
  return true;
}

/**
 * 表格单元格、[TOC] 这类自己画 DOM 的地方用的静态版本：悬停时播一遍。
 * 里面藏一个 Unicode 替身，textContent / 复制都能拿到正常的表情。
 */
export function inlineAnimatedEmoji(emoji: AnimatedEmoji): HTMLElement {
  const node = document.createElement("span");
  node.className = "otw-ae";
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", emoji.name);
  node.title = emoji.name;
  const player = new EmojiPlayer(emoji);
  const alt = document.createElement("span");
  alt.className = "otw-ae-alt";
  alt.textContent = emoji.fallback;
  node.append(alt);
  player.mount(node);
  node.addEventListener("pointerenter", () => {
    if (!player.playing) void player.play();
  });
  return node;
}
