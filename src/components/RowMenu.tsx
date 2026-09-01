import { cn } from "@/lib/cn";
import { spring } from "@/lib/motion";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

export interface MenuAction {
  id: string;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * 列表行右上角的「…」菜单。
 * 用 Radix 拿焦点管理和键盘导航，动画自己接管
 * （Radix 自带的 data-state 动画只能用 CSS，做不了 spring）。
 */
export function RowMenu({
  actions,
  alwaysVisible,
}: {
  actions: MenuAction[];
  /** 选中行的「…」常驻显示，其余悬停才出现 */
  alwaysVisible?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="更多操作"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "grid h-5 w-5 place-items-center rounded text-faint",
            "transition-all duration-[150ms] hover:bg-raised hover:text-ink",
            open || alwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            open && "bg-raised text-ink",
          )}
        >
          <MoreHorizontal size={13} strokeWidth={2} />
        </button>
      </DropdownMenu.Trigger>

      <AnimatePresence>
        {open && (
          <DropdownMenu.Portal forceMount>
            <DropdownMenu.Content
              align="end"
              sideOffset={5}
              className="z-50 outline-none"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -2, transition: { duration: 0.1 } }}
                transition={spring.snappy}
                className="min-w-[142px] origin-top-right overflow-hidden rounded-lg bg-canvas
                           p-1 shadow-float ring-1 ring-line-strong"
              >
                {actions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <DropdownMenu.Item
                      key={a.id}
                      onSelect={a.onSelect}
                      className={cn(
                        "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-[6px]",
                        "text-[12.5px] outline-none transition-colors duration-[110ms]",
                        a.danger
                          ? "text-danger data-[highlighted]:bg-danger/10"
                          : "text-body data-[highlighted]:bg-raised data-[highlighted]:text-ink",
                      )}
                    >
                      <Icon size={13} strokeWidth={1.9} className="shrink-0" />
                      <span>{a.label}</span>
                    </DropdownMenu.Item>
                  );
                })}
              </motion.div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </AnimatePresence>
    </DropdownMenu.Root>
  );
}
