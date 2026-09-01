/* ============================================================
   Tauri 运行时的薄封装。
   浏览器里跑（pnpm dev 直开 1420 端口）时全部降级为 no-op，
   这样同一份代码既能在浏览器里快速调 UI，也能跑在桌面壳里。
   ============================================================ */

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invokeImpl: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn | null> {
  if (!isTauri) return null;
  if (invokeImpl) return invokeImpl;
  const mod = await import("@tauri-apps/api/core");
  invokeImpl = mod.invoke as InvokeFn;
  return invokeImpl;
}

async function call<T>(cmd: string, fallback: T): Promise<T> {
  const invoke = await getInvoke();
  if (!invoke) return fallback;
  try {
    return await invoke<T>(cmd);
  } catch (e) {
    console.error(`[tauri] ${cmd} failed`, e);
    return fallback;
  }
}

/** 前端首帧渲染完成，通知 Rust 把窗口显示出来 */
export function signalReady() {
  void call("ready", undefined);
}

export const win = {
  minimize: () => call("win_minimize", undefined),
  toggleMaximize: () => call<boolean>("win_toggle_maximize", false),
  close: () => call("win_close", undefined),
  isMaximized: () => call<boolean>("win_is_maximized", false),
};
