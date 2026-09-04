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
  /** 日历右侧的分段：日TODO / 周·月·年 GOAL */
  calendarScope: "day" | "week" | "month" | "year";
  goalHorizon: GoalHorizon;

  selectNote: (id: string) => void;
  selectArchive: (id: string) => void;
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
    set({ workspace: w, navDirection: to > from ? 1 : -1 });
  },

  selectedNoteId: "n-autumn",
  selectedArchiveId: "a-ia",
  selectedDate: "2026-08-29",
  calendarScope: "day",
  goalHorizon: "week",

  selectNote: (id) => set({ selectedNoteId: id }),
  selectArchive: (id) => set({ selectedArchiveId: id }),
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

export { NAV_ORDER, today };
