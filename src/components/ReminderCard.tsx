import type { Reminder } from "@/data/types";
import { spring, tween } from "@/lib/motion";
import { Bell, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

/**
 * 右下角浮动提醒。
 * 入场稍微延迟（620ms）—— 让主内容先安定下来，它再出现，
 * 不然一屏东西同时动，看起来是「加载」而不是「呈现」。
 */
export function ReminderCard({ reminder }: { reminder: Reminder }) {
  const [dismissed, setDismissed] = useState(false);

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.aside
          key={reminder.label + reminder.when}
          role="status"
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98, transition: tween.fast }}
          transition={{ ...spring.gentle, delay: 0.62 }}
          whileHover={{ y: -2 }}
          className="group absolute bottom-6 right-6 z-20 w-[124px] select-none rounded-xl
                     bg-accent-wash px-3 py-2.5 shadow-card ring-1 ring-accent-line/60"
        >
          <div className="flex items-center gap-1.5">
            <motion.span
              animate={{ rotate: [0, -12, 10, -6, 0] }}
              transition={{ duration: 0.7, delay: 1.15, ease: "easeInOut" }}
              className="origin-top text-accent"
            >
              <Bell size={11} strokeWidth={2.2} />
            </motion.span>
            <span className="text-[10.5px] font-medium leading-none text-accent">
              {reminder.label}
            </span>

            <button
              type="button"
              aria-label="忽略提醒"
              onClick={() => setDismissed(true)}
              className="ml-auto -mr-1 grid h-4 w-4 place-items-center rounded text-accent/45
                         opacity-0 transition-all duration-[140ms] hover:bg-accent/10
                         hover:text-accent group-hover:opacity-100"
            >
              <X size={10} strokeWidth={2.4} />
            </button>
          </div>

          <p className="mt-1.5 text-[15px] font-semibold leading-none text-accent">
            {reminder.when}
          </p>
          <p className="mt-1.5 text-[10.5px] leading-none text-accent/70">{reminder.what}</p>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
