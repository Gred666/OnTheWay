import brandUrl from "@/assets/brand.png";
import { motion, useReducedMotion } from "motion/react";

/**
 * 手写 Logo。
 * 入场用 clip-path 从左到右擦除，模拟「正在被写出来」——
 * 比整体淡入有性格得多，而且 clip-path 走合成器，零布局成本。
 * 暗色模式用 invert 把黑色笔画翻成白色（素材是透明底黑字）。
 */
export function Logo() {
  const reduce = useReducedMotion();

  return (
    <div className="relative h-[22px] w-[105px] shrink-0">
      <motion.img
        src={brandUrl}
        alt="OnTheWay"
        draggable={false}
        className="h-full w-full object-contain object-left select-none
                   [image-rendering:-webkit-optimize-contrast]
                   dark:brightness-0 dark:invert"
        initial={reduce ? false : { clipPath: "inset(0 100% 0 0)", opacity: 0.4 }}
        animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1 }}
        transition={{
          clipPath: { duration: 0.72, ease: [0.33, 0.9, 0.42, 1] },
          opacity: { duration: 0.18 },
        }}
      />
    </div>
  );
}
