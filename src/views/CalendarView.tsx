import { useApp } from "@/app/store";
import { ColumnButton, ListColumn } from "@/components/ListColumn";
import { cn } from "@/lib/cn";
import {
  type ISODate,
  addMonths,
  formatDayNum,
  formatMonthCN,
  formatYear,
  isSameMonth,
  isoWeekNumber,
  monthGrid,
  startOfMonth,
  startOfWeek,
  toISODate,
  today,
} from "@/lib/date";
import { spring, tween } from "@/lib/motion";
import { ChevronLeft, ChevronRight, LocateFixed } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

export function CalendarPanel({ marked }: { marked: Set<string> }) {
  const selected = useApp((s) => s.selectedDate);
  const selectDate = useApp((s) => s.selectDate);

  const [anchor, setAnchor] = useState<ISODate>(() => startOfMonth(selected));
  const [dir, setDir] = useState<1 | -1>(1);

  const go = (delta: number) => {
    setDir(delta > 0 ? 1 : -1);
    setAnchor((a) => addMonths(a, delta));
  };

  const jumpToday = () => {
    const t = today();
    setDir(t > anchor ? 1 : -1);
    setAnchor(startOfMonth(t));
    selectDate(t);
  };

  const days = monthGrid(anchor);
  const selectedWeekStart = startOfWeek(selected);

  return (
    <ListColumn
      title="日历"
      action={
        <ColumnButton label="回到今天" onClick={jumpToday} wide>
          <LocateFixed size={12} strokeWidth={2} />
          <span>今天</span>
        </ColumnButton>
      }
      belowTitle={
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-[26px] items-center rounded-md bg-raised/60 px-2 font-mono
                       text-[11.5px] text-body tabular-nums"
          >
            {formatYear(anchor)} 年
          </span>

          {/* 月份名做方向感知的上下滚动替换 */}
          <div className="relative h-[26px] min-w-[52px] flex-1 overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.span
                key={anchor.slice(0, 7)}
                custom={dir}
                initial={{ y: dir * 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: dir * -20, opacity: 0 }}
                transition={spring.smooth}
                className="absolute inset-0 flex items-center text-[17px] font-semibold
                           tracking-tight text-ink"
              >
                {formatMonthCN(anchor)}
              </motion.span>
            </AnimatePresence>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <StepButton label="上一月" onClick={() => go(-1)}>
              <ChevronLeft size={14} strokeWidth={2} />
            </StepButton>
            <StepButton label="下一月" onClick={() => go(1)}>
              <ChevronRight size={14} strokeWidth={2} />
            </StepButton>
          </div>
        </div>
      }
    >
      {/* 表头：周数列 + 七天 */}
      <div className="grid grid-cols-[26px_repeat(7,1fr)] px-1 pb-1.5">
        <span className="text-center text-[10px] font-medium text-faint">周</span>
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-center text-[10.5px] font-medium text-faint">
            {w}
          </span>
        ))}
      </div>

      {/* 网格固定 6 行 —— 切月时高度不变，动画才干净 */}
      <div className="relative overflow-hidden px-1">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={anchor.slice(0, 7)}
            custom={dir}
            initial={{ x: dir * 26, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir * -26, opacity: 0 }}
            transition={{ ...spring.smooth, opacity: tween.fast }}
            className="flex flex-col"
          >
            {Array.from({ length: 6 }, (_, row) => {
              const weekDays = days.slice(row * 7, row * 7 + 7);
              const weekStart = weekDays[0]!;

              return (
                <WeekRow
                  key={weekStart}
                  weekDays={weekDays}
                  weekNo={isoWeekNumber(weekStart)}
                  anchor={anchor}
                  selected={selected}
                  marked={marked}
                  highlighted={weekStart === selectedWeekStart}
                  onSelect={selectDate}
                />
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </ListColumn>
  );
}

function WeekRow({
  weekDays,
  weekNo,
  anchor,
  selected,
  marked,
  highlighted,
  onSelect,
}: {
  weekDays: ISODate[];
  weekNo: number;
  anchor: ISODate;
  selected: ISODate;
  marked: Set<string>;
  highlighted: boolean;
  onSelect: (d: ISODate) => void;
}) {
  const todayISO = toISODate(new Date());

  // 每周自成一个 grid 行 —— 这样整行高亮可以用 inset-0，
  // 而不是靠负值外扩去猜宽度。
  return (
    <div className="relative grid grid-cols-[26px_repeat(7,1fr)]">
      {highlighted && (
        <motion.span
          layoutId="calendar-week-band"
          className="pointer-events-none absolute inset-0 rounded-lg bg-accent-wash-2"
          transition={spring.smooth}
        />
      )}

      <div className="relative grid h-[52px] place-items-center">
        <span
          className={cn(
            "font-mono text-[10px] tabular-nums transition-colors duration-200",
            highlighted ? "font-semibold text-accent" : "text-faint/70",
          )}
        >
          {weekNo}
        </span>
      </div>

      {weekDays.map((d) => (
        <DayCell
          key={d}
          date={d}
          outside={!isSameMonth(d, anchor)}
          selected={d === selected}
          isToday={d === todayISO}
          marked={marked.has(d)}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function DayCell({
  date,
  outside,
  selected,
  isToday,
  marked,
  onSelect,
}: {
  date: ISODate;
  outside: boolean;
  selected: boolean;
  isToday: boolean;
  marked: boolean;
  onSelect: (d: ISODate) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(date)}
      aria-label={date}
      aria-current={selected ? "date" : undefined}
      className="group relative grid h-[52px] place-items-center"
    >
      <span className="relative grid h-[30px] w-[30px] place-items-center">
        {/* 选中：主色实心圆角方块，layoutId 让它在日期之间飞过去 */}
        {selected && (
          <motion.span
            layoutId="calendar-day-badge"
            className="absolute inset-0 rounded-lg bg-accent"
            transition={spring.smooth}
          />
        )}
        {!selected && (
          <span
            className="absolute inset-0 scale-90 rounded-lg bg-raised opacity-0 transition-all
                       duration-[140ms] group-hover:scale-100 group-hover:opacity-70"
          />
        )}

        <motion.span
          className={cn(
            "relative z-10 font-mono text-[12.5px] tabular-nums transition-colors duration-[160ms]",
            selected
              ? "font-semibold text-accent-ink"
              : outside
                ? "text-faint/45"
                : isToday
                  ? "font-semibold text-accent"
                  : "text-body",
          )}
          animate={{ scale: selected ? 1.04 : 1 }}
          transition={spring.snappy}
        >
          {formatDayNum(date)}
        </motion.span>
      </span>

      {/* 有内容的日子：下方小圆点 */}
      {marked && (
        <motion.span
          layout
          className={cn(
            "absolute bottom-[7px] h-[3px] w-[3px] rounded-full transition-colors duration-200",
            selected ? "bg-accent" : outside ? "bg-faint/40" : "bg-accent/70",
          )}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={spring.snappy}
        />
      )}
    </button>
  );
}

function StepButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      whileTap={{ scale: 0.88 }}
      transition={{ duration: 0.1 }}
      className="grid h-[26px] w-[26px] place-items-center rounded-md text-muted
                 transition-colors duration-[140ms] hover:bg-raised hover:text-ink"
    >
      {children}
    </motion.button>
  );
}
