import { cn } from "@/lib/cn";
import { spring } from "@/lib/motion";
import { motion } from "motion/react";

/**
 * 分段控件。原型里的 [周|月|年] 和 [日TODO|周/GOAL|月/GOAL|年/GOAL]。
 * 滑块用 layoutId 在选项间滑动 —— 这是整个应用里最能体现「流畅」的小控件，
 * 因为用户会反复点它。
 */
export function Segmented<T extends string>({
  group,
  options,
  value,
  onChange,
  size = "md",
}: {
  /** layoutId 命名空间，同页面多个分段控件不能重名 */
  group: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "relative flex shrink-0 items-center gap-0.5 rounded-lg bg-rail p-[3px]",
        size === "sm" ? "h-[30px]" : "h-[34px]",
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative h-full rounded-[7px] transition-colors duration-[140ms]",
              size === "sm" ? "px-2.5 text-[11.5px]" : "px-4 text-[12.5px]",
              active ? "text-ink" : "text-muted hover:text-body",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segment-thumb-${group}`}
                className="absolute inset-0 rounded-[7px] bg-canvas shadow-[0_1px_2px_rgb(26_26_24_/_0.06)]"
                transition={spring.smooth}
              />
            )}
            <span
              className={cn(
                "relative z-10 whitespace-nowrap transition-[font-weight] duration-[140ms]",
                active ? "font-semibold" : "font-normal",
              )}
            >
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
