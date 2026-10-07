import { animate, cubicBezier, motion, useMotionValue, useTransform } from "motion/react";
import type { MotionValue } from "motion/react";
import { useLayoutEffect, useRef } from "react";

/**
 * 手写 Logo。
 *
 * 展开时：九段笔画按真实书写顺序一段段描出来（stroke-dashoffset 1 → 0），整词停一拍，
 * 再沿同方向收回去，无限循环 —— 像有人一直在把这个词重新写一遍。
 *
 * 收起时只剩「O」，变成应用图标的样子：O 的两头各收回去一截，右上角留出缺口，
 * 缺口里一个蓝点（design/logo/）。这个「O」从头到尾不消失、只变形：
 * - 收起：其余字母淡出；O 从字标此刻的笔迹接手（写到一半就从一半开始），两头沿路径收开，
 *   右上角起笔和收笔交叉的那个结散开。收笔那头退过结的时候，原地留下一滴蓝 —— 蓝点长出来
 * - 展开：倒过来。收笔那头往前伸，伸到蓝点那里正好把它吞掉，O 合上，再交还给字标接着写
 *
 * 两个 O 是两条 path：字标里那条跟着 CSS 循环，另一条（变形用）由 motion value 驱动。
 * 同一时刻只显示一条，交接的那一帧两条的笔迹完全一样，所以没有交叉淡化 —— 交叉淡化两个
 * 一样的形状，中间那一下墨色会掉到七成五。
 *
 * 实现要点：
 * - pathLength="1" 把每段路径的长度归一化成 1，dasharray / dashoffset 就能直接写常数，
 *   省掉 JS 量 getTotalLength() 那一步，也不用等布局
 * - 描边走 currentColor，蓝点走 accent，暗色模式跟着 token 走
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
/**
 * 从这一刻接着写：整轮 6.6s 里，最后一笔 1.76s 起笔、2.35s 写完，第一笔 3.63s 开始收 ——
 * 2.4s 时九笔都在。导航栏展开时从这里开始，淡进来的是一个写好的完整 Logo，
 * 而不是停在收起那一刻、写到一半的样子。O 要到 1.2s 之后才开始收，变形用的 O 在那之前合上、交回来
 */
const WRITTEN_AT = 2.4;

/* ---------------- 收起后的「O」 ----------------
   位置都是沿 O 那条路径的比例（0 = 起笔，1 = 收笔）。缺口、蓝点的方向和大小照应用图标：
   缺口在一点半方向，蓝点直径约为笔画宽的 1.4 倍。 */

/** 起笔收到正上方稍偏右 */
const OPEN_HEAD = 0.118;
/** 收笔停在右侧偏上 */
const OPEN_TAIL = 0.896;
/** 蓝点：起笔和收笔交叉的那个结，即最后一段 C 的中点 */
const DOT = { cx: 38.4, cy: 18.8, r: 3.5 } as const;
/** 收笔那段经过蓝点圆心的位置 */
const DOT_AT = 0.959;
/**
 * 收起后整个标记往左挪的量（viewBox 单位，约 2px）：O 在字标里的位置让它的外框中心落在 34px，
 * 64px 窄栏里图标那一列的中线是 32。跟着变形一起挪，展开时交回字标之前挪回来
 */
const MARK_SHIFT = -4.1;

/** 收起：和导航栏底板同一条缓入缓出，略早一点停 */
const OPEN_EASE = [0.4, 0, 0.2, 1] as const;
const OPEN_DURATION = 0.46;
/**
 * 蓝点长出来：阻尼比 0.68，冲过头约 5%（直径 3.4px 的点多出不到 0.2px）—— 看不出弹，
 * 只是收尾是「落定」而不是「刹住」。阻尼 22 那一版冲过头 13%，慢放里那几帧明显大一圈
 */
const DOT_IN = { type: "spring", stiffness: 420, damping: 28, restDelta: 0.001 } as const;
/** 展开：要赶在字母淡进来（LABEL_IN 0.2s 起）前后合上，交还给字标 */
const CLOSE_DURATION = 0.3;

const openEase = cubicBezier(...OPEN_EASE);

/** 缓动曲线走到 progress 时，时间过去了几成（二分） */
function timeAt(progress: number) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (openEase(mid) < progress) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * 字标里那条 O 此刻画出来的区间 [起, 止]。它的 dasharray 是「1 3」：
 * dashoffset 为正 = 正在写，画出 [0, 1 - d]；为负 = 正在收，画出 [-d, 1]。
 * 一点都没画（整轮里那一段空白）时返回 null。
 */
function writtenInterval(path: SVGPathElement | null): [number, number] | null {
  if (!path) return [0, 1];
  const d = Number.parseFloat(getComputedStyle(path).strokeDashoffset) || 0;
  const [start, end] = d >= 0 ? [0, 1 - d] : [-d, 1];
  return end - start > 0.01 ? [start, end] : null;
}

export function Logo({
  collapsed,
  reduce,
  fade,
}: {
  collapsed: boolean;
  reduce: boolean;
  /** O 以外那八笔的不透明度（和导航文字同一个值） */
  fade: MotionValue<number>;
}) {
  // 停过一次之后再放开：笔画重新挂上，从「写好了」那一刻接着走。
  // 在渲染里算，不放进 effect：展开那一下不为它再多提交一次（动画头一帧本来就最忙）
  const resumes = useRef(0);
  const wasPaused = useRef(collapsed);
  if (wasPaused.current && !collapsed) resumes.current += 1;
  wasPaused.current = collapsed;
  const offset = resumes.current > 0 ? WRITTEN_AT : 0;

  // 变形用的 O 画出的区间、蓝点的大小、现在是不是字标自己的 O 在显示
  const head = useMotionValue(collapsed ? OPEN_HEAD : 0);
  const tail = useMotionValue(collapsed ? OPEN_TAIL : 1);
  const dot = useMotionValue(collapsed ? 1 : 0);
  const live = useMotionValue(collapsed ? 0 : 1);
  const shift = useMotionValue(collapsed ? MARK_SHIFT : 0);
  const dasharray = useTransform(() => `${Math.max(tail.get() - head.get(), 0)} 2`);
  const dashoffset = useTransform(() => -head.get());
  // 长度为 0 的一段，圆头笔帽会画出一个点：没东西可画时整条藏起来。
  // 三个值都要先读出来：这种写法只在第一次运行时收集依赖，用 && 短路的话
  // head / tail 就没订阅上（从一片空白开始写的那种收起，O 会一直不出来）
  const morphOpacity = useTransform(() => {
    const length = tail.get() - head.get();
    return live.get() === 0 && length > 0.002 ? 1 : 0;
  });

  const writtenO = useRef<SVGPathElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduce) {
      head.set(collapsed ? OPEN_HEAD : 0);
      tail.set(collapsed ? OPEN_TAIL : 1);
      dot.set(collapsed ? 1 : 0);
      live.set(collapsed ? 0 : 1);
      shift.set(collapsed ? MARK_SHIFT : 0);
      return;
    }

    if (collapsed) {
      // 从字标此刻的笔迹接手（交接这一帧两条 O 一模一样）；上一次展开还没交回去就接着变
      if (live.get() === 1) {
        const written = writtenInterval(writtenO.current);
        // 那一刻一笔都没有：从缺口这头起笔，顺着书写方向写出来
        const [start, end] = written ?? [OPEN_HEAD, OPEN_HEAD];
        head.set(start);
        tail.set(end);
        dot.set(0);
        live.set(0);
      }
      const from = tail.get();
      // 收笔那头退过结的那一刻，蓝点开始长；收笔本来就没到结那里，就等 O 快成形了再出来
      const dotDelay =
        from > DOT_AT
          ? OPEN_DURATION * timeAt((from - DOT_AT) / (from - OPEN_TAIL))
          : OPEN_DURATION * 0.6;
      const tween = { duration: OPEN_DURATION, ease: OPEN_EASE };
      const controls = [
        animate(head, OPEN_HEAD, tween),
        animate(tail, OPEN_TAIL, tween),
        animate(shift, MARK_SHIFT, tween),
        animate(dot, 1, { ...DOT_IN, delay: dotDelay }),
      ];
      return () => {
        for (const c of controls) c.stop();
      };
    }

    // 展开：收笔那头伸到蓝点圆心时，蓝点正好缩没
    const from = tail.get();
    const tween = { duration: CLOSE_DURATION, ease: OPEN_EASE };
    const swallowAt = from < DOT_AT ? CLOSE_DURATION * timeAt((DOT_AT - from) / (1 - from)) : 0;
    let cancelled = false;
    const controls = [
      animate(head, 0, tween),
      animate(tail, 1, tween),
      animate(shift, 0, tween),
      animate(dot, 0, { duration: Math.max(swallowAt, 0.08), ease: [0.4, 0, 1, 1] }),
    ];
    // 合上了：交还给字标（它这时是写好的完整 O，见 WRITTEN_AT）
    Promise.all(controls).then(() => {
      if (!cancelled) live.set(1);
    });
    return () => {
      cancelled = true;
      for (const c of controls) c.stop();
    };
  }, [collapsed, reduce, head, tail, dot, live, shift]);

  const strokeTiming = (i: number) => ({
    animationDelay: `${(i * STEP - offset).toFixed(2)}s`,
    // 导航栏收起时停在那一帧（字母已经淡没了，O 交给了变形用的那条）
    animationPlayState: collapsed ? ("paused" as const) : undefined,
  });

  return (
    <svg
      viewBox="3 5 268 78"
      className="h-[38px] w-[131px] shrink-0 overflow-visible text-ink"
      role="img"
      aria-label="OnTheWay"
    >
      <g
        key={resumes.current}
        fill="none"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* 字标的 O：只有它不跟着字母淡出 —— 收起时直接交给下面变形用的那条 */}
        <motion.path
          ref={writtenO}
          d={STROKES[0]}
          pathLength="1"
          className="otw-logo-stroke"
          style={{ ...strokeTiming(0), opacity: live }}
        />
        <motion.g style={{ opacity: fade }}>
          {STROKES.slice(1).map((d, i) => (
            <path
              // 笔画顺序即身份，数组是常量、不会重排
              // biome-ignore lint/suspicious/noArrayIndexKey: 静态常量数组
              key={i}
              d={d}
              pathLength="1"
              className="otw-logo-stroke"
              style={strokeTiming(i + 1)}
            />
          ))}
        </motion.g>
      </g>
      {/* 变形用的 O 和蓝点：收起后整体往左挪一点，对上窄栏图标的中线 */}
      <motion.g style={{ x: shift }}>
        <motion.path
          d={STROKES[0]}
          pathLength="1"
          fill="none"
          stroke="currentColor"
          strokeWidth={5}
          strokeLinecap="round"
          style={{
            strokeDasharray: dasharray,
            strokeDashoffset: dashoffset,
            opacity: morphOpacity,
          }}
        />
        <motion.circle
          cx={DOT.cx}
          cy={DOT.cy}
          r={DOT.r}
          className="fill-accent"
          style={{ scale: dot, transformBox: "fill-box", transformOrigin: "50% 50%" }}
        />
      </motion.g>
    </svg>
  );
}
