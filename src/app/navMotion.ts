import { motionValue } from "motion/react";
import { NAV_COLLAPSED_WIDTH, NAV_WIDTH, useApp } from "./store";

/* ============================================================
   导航栏收起 / 展开的动画（Sidebar 驱动，Shell、DocumentView 跟着）。

   排版只在切换的那一帧变一次：导航栏的盒子直接是新宽度，列表栏和正文一帧之内
   挪到新位置、正文只折一次行 —— 动画化宽度的话，开了折行的 CodeMirror 每一帧都要
   重新折行（Shell 里列表栏那段注释说的坑）。看得见的动静全是另外几层：
   - 导航栏的底板（Sidebar 里一层 absolute 的面板）宽度从旧值滑到新值：它只有十来个
     元素，每帧排一次版不到半毫秒，而且 absolute、关在 contain 里，碰不到外面
   - 列表栏用 transform 贴着底板的右边缘走：x = 看起来的宽 - 排版上的宽
   - 正文那一列用 Motion 的 layout="position" 滑到新的居中位置（同专注模式）
   - 文字标签只淡入淡出，图标一直钉在原处（两种宽度下图标的 x 是同一个）
   ============================================================ */

const widthOf = (collapsed: boolean) => (collapsed ? NAV_COLLAPSED_WIDTH : NAV_WIDTH);
const initiallyCollapsed = useApp.getState().navCollapsed;

/** 导航栏排版上的宽度：切换那一帧就是新值 */
export const navLayoutWidth = motionValue(widthOf(initiallyCollapsed));
/** 导航栏看起来的宽度：从旧值滑到新值 */
export const navPanelWidth = motionValue(widthOf(initiallyCollapsed));
/** 文字标签（和完整 Logo）的不透明度；收起时 0 */
export const navLabelOpacity = motionValue(initiallyCollapsed ? 0 : 1);

/**
 * 底板宽度、列表栏、正文那一列共用的节奏：标准的缓入缓出。
 *
 * 没用专注模式那条前段快的曲线：那条曲线 100ms 里边缘就走完了一大半，左下角那一行
 * 来不及先竖起来就得挤进 64px，几个图标会叠在一起（Sidebar 的 FootControls）。
 * 缓一点起步，那一行有时间先错开成三层、再跟着边缘收进去
 */
export const NAV_TRANSITION = { duration: 0.5, ease: [0.4, 0, 0.2, 1] } as const;

/** 专注模式：chrome 整条推出去，前段快、尾巴长，收尾几乎察觉不到停下的那一下 */
export const ZEN_TRANSITION = { duration: 0.46, ease: [0.22, 1, 0.36, 1] } as const;

/** 收起时字先走（边缘追上来之前就淡完了）；展开时等底板差不多打开了再出来 */
export const LABEL_OUT = { duration: 0.12, ease: "easeOut" } as const;
export const LABEL_IN = { duration: 0.22, delay: 0.2, ease: "easeOut" } as const;

export { widthOf as navWidthOf };
