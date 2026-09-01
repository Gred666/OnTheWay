import { cn } from "@/lib/cn";
import { spring, tween } from "@/lib/motion";
import { Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div
      className={cn(
        "relative flex h-9 items-center gap-2 rounded-lg px-2.5",
        "transition-colors duration-[160ms]",
        focused ? "bg-canvas ring-1 ring-accent-line" : "bg-raised/55 hover:bg-raised/80",
      )}
    >
      <motion.span
        animate={{ scale: focused ? 1.06 : 1, color: focused ? "var(--color-accent)" : undefined }}
        transition={spring.snappy}
        className="shrink-0 text-faint"
      >
        <Search size={13} strokeWidth={2} />
      </motion.span>

      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none
                   placeholder:text-faint selection:bg-accent/20"
      />

      <AnimatePresence>
        {value && (
          <motion.button
            type="button"
            aria-label="清空搜索"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={tween.fast}
            onClick={() => {
              onChange("");
              ref.current?.focus();
            }}
            className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-faint
                       transition-colors hover:bg-raised hover:text-body"
          >
            <X size={10} strokeWidth={2.6} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
