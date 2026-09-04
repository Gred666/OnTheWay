import { Shell } from "@/app/Shell";
import { initPreferences } from "@/app/store";
import { useData } from "@/data/store";
import { installCloseGuard } from "@/editor/saveBus";
import { signalReady } from "@/lib/tauri";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";

async function bootstrap() {
  initPreferences();
  await useData.getState().initialize();
  try {
    await installCloseGuard();
  } catch (error) {
    // capability 配置异常不能阻断整个 React 根节点渲染。关闭保护失效时
    // 保留控制台错误，应用主体仍然可用。
    console.error("安装关闭前保存保护失败", error);
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  );

  // 首帧真正上屏后再让 Rust show() 窗口，避免开局白闪。
  // 双 rAF：第一帧排进渲染队列，第二帧确认已经 paint。
  requestAnimationFrame(() => requestAnimationFrame(signalReady));
}

void bootstrap();
