import type { GoalHorizon, WorkspaceId } from "@/data/types";
import { type ISODate, today } from "@/lib/date";
import { create } from "zustand";

export type ThemePref = "system" | "light" | "dark";

interface AppState {
  /* ---- 导航 ---- */
  workspace: WorkspaceId;
  /** 导航切换方向，用于让主内容做方向感知的位移动画 */
  navDirection: 1 | -1;
  setWorkspace: (w: WorkspaceId) => void;

  /* ---- 各区的选中项 ---- */
  selectedNoteId: string;
  selectedArchiveId: string;
  selectedDate: ISODate;
  /**
   * 「今天」。放进 store 而不是每次 today() 现算：应用开着跨过零点时，
   * 今日TODO、日历上的今天标记都要跟着翻页，得有一个能触发重渲染的信号。
   * 由 startTodayTicker() 在每个零点刷新。
   */
  todayDate: ISODate;
  setTodayDate: (d: ISODate) => void;
  /** 日历右侧的分段：日TODO / 周·月·年 GOAL */
  calendarScope: "day" | "week" | "month" | "year";
  goalHorizon: GoalHorizon;

  selectNote: (id: string) => void;
  selectArchive: (id: string) => void;
  /**
   * `[[笔记#小节]]` 跳过去之后要滚到的小节。目标笔记的编辑器挂上、目录算出来
   * 之后由 DocumentView 消费并清掉；docKey 保证不会滚错篇。
   */
  pendingAnchor: { docKey: string; heading: string } | null;
  setPendingAnchor: (anchor: AppState["pendingAnchor"]) => void;
  selectDate: (d: ISODate) => void;
  setCalendarScope: (s: AppState["calendarScope"]) => void;
  setGoalHorizon: (h: GoalHorizon) => void;

  /* ---- 搜索 ---- */
  noteQuery: string;
  archiveQuery: string;
  setNoteQuery: (q: string) => void;
  setArchiveQuery: (q: string) => void;

  /* ---- 界面 ---- */
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  reduceMotion: boolean;
  setReduceMotion: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;

  /* ---- 专注模式：编辑区铺满整页，只有笔记区有 ---- */
  zen: boolean;
  setZen: (v: boolean) => void;
}

/** 导航顺序 —— 决定切换时主内容往哪个方向位移 */
const NAV_ORDER: WorkspaceId[] = ["notes", "today", "goal", "calendar", "archive", "extensions"];

const LS_KEY = "otw.prefs";

function loadPrefs(): { theme: ThemePref; reduceMotion: boolean } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        theme: p.theme === "light" || p.theme === "dark" ? p.theme : "system",
        reduceMotion: !!p.reduceMotion,
      };
    }
  } catch {
    /* 隐私模式 / 禁用存储：走默认值 */
  }
  return { theme: "system", reduceMotion: false };
}

function savePrefs(theme: ThemePref, reduceMotion: boolean) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ theme, reduceMotion }));
  } catch {
    /* 忽略：偏好丢失不影响使用 */
  }
}

const initialPrefs = loadPrefs();

export const useApp = create<AppState>((set, get) => ({
  workspace: "notes",
  navDirection: 1,
  setWorkspace: (w) => {
    const from = NAV_ORDER.indexOf(get().workspace);
    const to = NAV_ORDER.indexOf(w);
    if (from === to) return;
    // 离开笔记区就退出专注模式：其它区没有这个入口，留着的话侧栏会一直是收起的，
    // 用户在日历页找不到任何东西可以点回来。
    set({ workspace: w, navDirection: to > from ? 1 : -1, zen: false });
  },

  selectedNoteId: "n-autumn",
  selectedArchiveId: "a-ia",
  // 打开日历就是今天，不用每次手动定位
  selectedDate: today(),
  todayDate: today(),
  setTodayDate: (d) => set({ todayDate: d }),
  calendarScope: "day",
  goalHorizon: "week",

  selectNote: (id) => set({ selectedNoteId: id }),
  selectArchive: (id) => set({ selectedArchiveId: id }),
  pendingAnchor: null,
  setPendingAnchor: (pendingAnchor) => set({ pendingAnchor }),
  selectDate: (d) => set({ selectedDate: d }),
  setCalendarScope: (s) => set({ calendarScope: s }),
  setGoalHorizon: (h) => set({ goalHorizon: h }),

  noteQuery: "",
  archiveQuery: "",
  setNoteQuery: (q) => set({ noteQuery: q }),
  setArchiveQuery: (q) => set({ archiveQuery: q }),

  theme: initialPrefs.theme,
  setTheme: (t) => {
    applyTheme(t);
    savePrefs(t, get().reduceMotion);
    set({ theme: t });
  },
  reduceMotion: initialPrefs.reduceMotion,
  setReduceMotion: (v) => {
    document.documentElement.setAttribute("data-reduce-motion", String(v));
    savePrefs(get().theme, v);
    set({ reduceMotion: v });
  },
  paletteOpen: false,
  setPaletteOpen: (v) => set({ paletteOpen: v }),

  zen: false,
  setZen: (v) => set({ zen: v }),
}));

/* ============================================================
   主题：始终在 <html> 上落一个明确的 data-theme。
   不留「未指定」态 —— 否则 Tailwind 的 dark: 变体在系统暗色下不生效。
   ============================================================ */

const mq = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function applyTheme(pref: ThemePref) {
  const resolved = pref === "system" ? (mq?.matches ? "dark" : "light") : pref;
  document.documentElement.setAttribute("data-theme", resolved);
  try {
    localStorage.setItem("otw.theme", pref === "system" ? "" : pref);
  } catch {
    /* 忽略 */
  }
}

/** 在 main.tsx 调一次：应用初始偏好并跟随系统变化 */
export function initPreferences() {
  const { theme, reduceMotion } = useApp.getState();
  applyTheme(theme);
  document.documentElement.setAttribute("data-reduce-motion", String(reduceMotion));

  mq?.addEventListener("change", () => {
    if (useApp.getState().theme === "system") applyTheme("system");
  });
}

/** 当前工作区是否有中列表栏（今日TODO 和 GOAL 是两栏布局） */
export function hasListColumn(w: WorkspaceId): boolean {
  return w === "notes" || w === "calendar" || w === "archive";
}

/** 中列表栏的宽度。进出场时它要从导航栏底下滑出来 / 滑回去，位移就是这么宽（见 Shell）。 */
export const LIST_WIDTH = 300;

/**
 * 左侧 chrome 的总宽：导航 240 + 列表栏 300。
 * 专注模式要把这一整条推出去；正文的画布也要往它底下多铺这么宽（见 DocumentView）。
 */
export const RAIL_WIDTH = 240 + LIST_WIDTH;

/**
 * 零点翻页：把 todayDate 刷成新的一天，并把日历上还停在昨天的选择带过去。
 * 用 setTimeout 对准下一个零点，而不是每分钟轮询；睡眠唤醒后 setTimeout
 * 可能晚点，所以醒来（visibilitychange）时再对一次表。
 */
export function startTodayTicker(): () => void {
  let timer = 0;

  const sync = () => {
    const now = today();
    const state = useApp.getState();
    if (state.todayDate !== now) {
      const followed = state.selectedDate === state.todayDate;
      useApp.setState({ todayDate: now, ...(followed ? { selectedDate: now } : {}) });
    }
    schedule();
  };

  const schedule = () => {
    window.clearTimeout(timer);
    const next = new Date();
    next.setHours(24, 0, 0, 500);
    timer = window.setTimeout(sync, Math.max(1000, next.getTime() - Date.now()));
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") sync();
  };
  document.addEventListener("visibilitychange", onVisible);
  schedule();

  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export { NAV_ORDER, today };
