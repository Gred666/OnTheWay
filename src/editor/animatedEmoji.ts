import { ANIMATED_EMOJI_FALLBACK } from "@/lib/emojiText";
import {
  ANIMATED_EMOJI_DESIGNS,
  type AnimatedEmojiDesign,
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

/* ---------------- SVG 模板 ---------------- */

const SVG_NS = "http://www.w3.org/2000/svg";
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
  root.setAttribute("viewBox", "0 0 24 24");
  root.setAttribute("class", `otw-ae-svg hue-${emoji.hue}`);
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

export class EmojiPlayer {
  readonly element: SVGSVGElement;
  private running: Animation[] = [];
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private looping = false;

  constructor(readonly emoji: AnimatedEmoji) {
    this.element = templateFor(emoji).cloneNode(true) as SVGSVGElement;
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
    if (motionReduced() || typeof this.element.animate !== "function") return Promise.resolve();
    const lead = options.intro ? INTRO_LEAD : 0;
    const frames = keyframesFor(this.emoji);
    if (options.intro) {
      const body = this.element.querySelector<SVGGElement>(".otw-ae-body");
      if (body) this.running.push(body.animate(INTRO_FRAMES, { duration: 420, fill: "backwards" }));
    }
    for (const part of this.element.querySelectorAll<SVGElement>("[data-a]")) {
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
    const finished = this.running.map((animation) => animation.finished);
    return Promise.all(finished).then(
      () => undefined,
      // cancel() 会让 finished 以 AbortError 拒绝：被打断不是错误
      () => undefined,
    );
  }

  /** 循环播放，两轮之间停 gap 毫秒。选择器里的当前项用它。 */
  loop(gap = 650): void {
    this.stop();
    if (motionReduced()) return;
    this.looping = true;
    const round = () => {
      if (!this.looping) return;
      void this.play().then(() => {
        if (!this.looping) return;
        this.loopTimer = setTimeout(round, gap);
      });
    };
    round();
  }

  /** 停下并回到静止态。 */
  stop(): void {
    this.looping = false;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    this.cancel();
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
  node.append(player.element, alt);
  node.addEventListener("pointerenter", () => {
    if (!player.playing) void player.play();
  });
  return node;
}
