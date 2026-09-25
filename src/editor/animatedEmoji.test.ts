// @vitest-environment happy-dom

import { ANIMATED_EMOJI_FALLBACK, animatedEmojiText } from "@/lib/emojiText";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANIMATED_EMOJIS,
  AUTO_PLAY_LIMIT,
  EmojiPlayer,
  animatedEmojiFor,
  autoPlay,
  inlineAnimatedEmoji,
  keyframesOf,
  motionLength,
  motionReduced,
  resolvePoses,
} from "./animatedEmoji";
import { ANIMATED_EMOJI_DESIGNS, EMOJI_GROUPS, type EmojiHue } from "./animatedEmojiSet";

const HUES: EmojiHue[] = [
  "red",
  "orange",
  "amber",
  "green",
  "blue",
  "sky",
  "purple",
  "pink",
  "brown",
  "slate",
];
/** globals.css 的 .otw-ae-svg 一节里定义过的类；拼错一个字母就是一块没颜色的图 */
const KNOWN_CLASSES = new Set([
  "o",
  "t",
  "k",
  "p",
  "i",
  "ik",
  "face",
  "blush",
  "shine",
  "shade",
  "road",
  "bold",
  "thin",
  "draw",
  "dash",
  "fx",
  ...HUES.map((hue) => `hue-${hue}`),
]);

function parse(svg: string): Element {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
    "image/svg+xml",
  );
  expect(doc.querySelector("parsererror")).toBeNull();
  return doc.documentElement;
}

afterEach(() => {
  document.documentElement.removeAttribute("data-reduce-motion");
  vi.restoreAllMocks();
});

describe("动态表情设计稿的规矩", () => {
  it("ids are unique, short-code safe and every one has a Unicode fallback", () => {
    const ids = ANIMATED_EMOJI_DESIGNS.map((design) => design.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
    // 主包里的小表和设计稿必须一一对应
    expect(Object.keys(ANIMATED_EMOJI_FALLBACK).sort()).toEqual([...ids].sort());
    for (const emoji of ANIMATED_EMOJIS) expect(emoji.fallback).not.toBe("");
  });

  it("fills every picker group with exactly one row of six", () => {
    for (const group of EMOJI_GROUPS) {
      expect(ANIMATED_EMOJI_DESIGNS.filter((design) => design.group === group.id)).toHaveLength(6);
    }
  });

  for (const design of ANIMATED_EMOJI_DESIGNS) {
    describe(design.id, () => {
      const root = parse(design.svg);

      it("has a name, keywords and a known hue", () => {
        expect(design.name.trim()).not.toBe("");
        expect(design.keywords.split(" ").length).toBeGreaterThan(3);
        expect(HUES).toContain(design.hue);
      });

      it("only uses classes the stylesheet knows", () => {
        for (const element of root.querySelectorAll("[class]")) {
          for (const name of element.getAttribute("class")!.split(/\s+/)) {
            expect(KNOWN_CLASSES, `${design.id}: .${name}`).toContain(name);
          }
        }
      });

      it("pairs every animated part with a motion and vice versa", () => {
        const parts = [...root.querySelectorAll("[data-a]")].map((el) => el.getAttribute("data-a"));
        expect(new Set(parts).size).toBe(parts.length);
        expect([...parts].sort()).toEqual(Object.keys(design.motion).sort());
      });

      it("never puts a transform attribute on an animated part (CSS transform would erase it)", () => {
        for (const part of root.querySelectorAll("[data-a]")) {
          expect(part.hasAttribute("transform"), part.getAttribute("data-a")!).toBe(false);
        }
      });

      it("only hides parts that an animation brings back", () => {
        for (const hidden of root.querySelectorAll(".fx")) {
          const name = hidden.getAttribute("data-a");
          expect(name, "fx 部件必须自己带 data-a").toBeTruthy();
          const steps = design.motion[name!]!.steps;
          expect(steps.some(([, pose]) => (pose.o ?? 0) > 0)).toBe(true);
        }
      });

      it("draws strokes only on normalised paths", () => {
        for (const [name, motion] of Object.entries(design.motion)) {
          if (!motion.steps.some(([, pose]) => pose.d !== undefined)) continue;
          const part = root.querySelector(`[data-a="${name}"]`)!;
          expect(part.getAttribute("pathLength")).toBe("1");
          expect(/\b(draw|dash)\b/.test(part.getAttribute("class") ?? "")).toBe(true);
        }
      });

      it("keeps steps ordered inside one iteration", () => {
        for (const motion of Object.values(design.motion)) {
          const offsets = motion.steps.map(([offset]) => offset);
          expect(offsets[0]).toBe(0);
          for (let i = 1; i < offsets.length; i += 1) {
            expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!);
          }
          expect(offsets.at(-1)!).toBeLessThanOrEqual(1);
          expect(motion.duration).toBeGreaterThanOrEqual(300);
          expect(motion.duration).toBeLessThanOrEqual(2000);
        }
        // 一轮不超过 2.5 秒：它是正文里的一个字，不是一段视频
        expect(motionLength(design)).toBeLessThanOrEqual(2500);
      });

      it("ends every motion on its resting pose, so nothing jumps when it stops", () => {
        for (const [name, motion] of Object.entries(design.motion)) {
          const last = resolvePoses(motion.steps).at(-1)!;
          const hidden = root.querySelector(`[data-a="${name}"]`)!.classList.contains("fx");
          expect(last.o, `${name} 的透明度`).toBe(hidden ? 0 : 1);
          // 粒子、泪滴最后是透明的，停在哪儿都看不见；其余部件必须回到原位
          if (hidden || motion.seamless) continue;
          expect(
            { x: last.x, y: last.y, r: last.r, sx: last.sx, sy: last.sy, kx: last.kx, ky: last.ky },
            name,
          ).toEqual({ x: 0, y: 0, r: 0, sx: 1, sy: 1, kx: 0, ky: 0 });
          expect(last.d, `${name} 的描边`).toBe(0);
        }
      });
    });
  }
});

describe("关键帧", () => {
  it("carries unspecified values forward and lets s drive both axes", () => {
    const poses = resolvePoses([
      [0, { x: 2 }],
      [0.5, { s: 1.2 }],
      [1, { sy: 0.8 }],
    ]);
    expect(poses.map(({ x, sx, sy }) => ({ x, sx, sy }))).toEqual([
      { x: 2, sx: 1, sy: 1 },
      { x: 2, sx: 1.2, sy: 1.2 },
      { x: 2, sx: 1.2, sy: 0.8 },
    ]);
  });

  it("writes the same transform function list on every frame", () => {
    const frames = keyframesOf([
      [0, {}],
      [0.5, { r: 10 }, "ease-in"],
      [1, {}],
    ]);
    expect(frames).toHaveLength(3);
    expect(frames[1]).toMatchObject({ offset: 0.5, easing: "ease-in" });
    const shape = (frame: Keyframe) => String(frame.transform).replace(/-?[\d.]+/g, "N");
    expect(new Set(frames.map(shape)).size).toBe(1);
    expect(frames[0]!.opacity).toBeUndefined();
  });

  it("holds the last pose until the end instead of sliding back to rest", () => {
    // 星星转到 72° 停在 0.62：不补末帧的话浏览器会从 72° 慢慢转回 0°
    const frames = keyframesOf([
      [0, { r: 0 }],
      [0.62, { r: 72 }],
    ]);
    expect(frames.map((frame) => frame.offset)).toEqual([0, 0.62, 1]);
    expect(frames[2]!.transform).toBe(frames[1]!.transform);
  });

  it("animates opacity and stroke only when a motion asks for them", () => {
    const [first] = keyframesOf([
      [0, { o: 0, d: 1 }],
      [1, { o: 1, d: 0 }],
    ]);
    expect(first).toMatchObject({ opacity: 0, strokeDashoffset: "1" });
    expect(first!.transform).toBeUndefined();
  });
});

describe("短码", () => {
  it("resolves case-insensitively, with or without colons", () => {
    expect(animatedEmojiFor(":otw_fire:")?.id).toBe("fire");
    expect(animatedEmojiFor("OTW_Fire")?.id).toBe("fire");
    expect(animatedEmojiFor(":fire:")).toBeNull();
    expect(animatedEmojiFor(":otw_nope:")).toBeNull();
  });

  it("turns short codes into Unicode for plain-text surfaces", () => {
    expect(animatedEmojiText("冲 :otw_fire: 好 :OTW_DONE:")).toBe("冲 🔥 好 ✅");
    expect(animatedEmojiText("留着 :otw_nope: 和 :smile:")).toBe("留着 :otw_nope: 和 :smile:");
    expect(animatedEmojiText("没有短码")).toBe("没有短码");
  });
});

describe("播放器", () => {
  const fire = animatedEmojiFor(":otw_fire:")!;

  it("clones a fresh SVG per player from one parsed template", () => {
    const a = new EmojiPlayer(fire);
    const b = new EmojiPlayer(fire);
    expect(a.element).not.toBe(b.element);
    expect(a.element.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(a.element.classList.contains("hue-orange")).toBe(true);
    expect(a.element.querySelectorAll("[data-a]")).toHaveLength(Object.keys(fire.motion).length);
  });

  it("stays still when motion is reduced", async () => {
    document.documentElement.dataset.reduceMotion = "true";
    expect(motionReduced()).toBe(true);
    const player = new EmojiPlayer(fire);
    const animate = vi.fn();
    for (const part of player.element.querySelectorAll("[data-a]")) {
      (part as unknown as { animate: typeof animate }).animate = animate;
    }
    await player.play();
    expect(animate).not.toHaveBeenCalled();
    expect(player.playing).toBe(false);
  });

  it("starts one animation per part and cancels them on stop", () => {
    const player = new EmojiPlayer(fire);
    const cancelled: string[] = [];
    for (const part of player.element.querySelectorAll<SVGElement>("[data-a]")) {
      (part as unknown as { animate: unknown }).animate = (
        _frames: Keyframe[],
        options: object,
      ) => ({
        options,
        playState: "running",
        finished: new Promise(() => {}),
        cancel: () => cancelled.push(part.dataset.a!),
      });
    }
    void player.play();
    expect(player.playing).toBe(true);
    player.stop();
    expect(cancelled.sort()).toEqual(Object.keys(fire.motion).sort());
  });

  it("caps simultaneous autoplay and gives the slot back when a round ends", async () => {
    const finishers: Array<() => void> = [];
    const player = () => {
      const p = new EmojiPlayer(fire);
      for (const part of p.element.querySelectorAll<SVGElement>("[data-a]")) {
        (part as unknown as { animate: unknown }).animate = () => {
          let done!: () => void;
          const finished = new Promise<void>((resolve) => {
            done = resolve;
          });
          finishers.push(() => done());
          return { playState: "running", finished, cancel: () => done() };
        };
      }
      return p;
    };
    const started = Array.from({ length: AUTO_PLAY_LIMIT + 5 }, () => autoPlay(player()));
    expect(started.filter(Boolean)).toHaveLength(AUTO_PLAY_LIMIT);
    for (const finish of finishers.splice(0)) finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(autoPlay(player())).toBe(true);
    for (const finish of finishers.splice(0)) finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("renders a static inline copy whose text is the Unicode fallback", () => {
    const node = inlineAnimatedEmoji(fire);
    expect(node.querySelector("svg")).not.toBeNull();
    expect(node.textContent).toBe("🔥");
    expect(node.getAttribute("aria-label")).toBe(fire.name);
  });
});
