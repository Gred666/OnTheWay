import { Shell } from "@/app/Shell";
import { initPreferences } from "@/app/store";
import { signalReady } from "@/lib/tauri";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";

initPreferences();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);

// 首帧真正上屏后再让 Rust show() 窗口，避免开局白闪。
// 双 rAF：第一帧排进渲染队列，第二帧确认已经 paint。
requestAnimationFrame(() => requestAnimationFrame(signalReady));
