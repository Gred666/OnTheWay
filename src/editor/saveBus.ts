import { isTauri, win } from "@/lib/tauri";

export type FlushEditor = () => Promise<void>;

const flushers = new Set<FlushEditor>();

export function registerEditorFlush(flush: FlushEditor): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

export async function flushAllEditors(): Promise<void> {
  await Promise.all([...flushers].map((flush) => flush()));
}

/**
 * close() 先触发 Tauri 的关闭请求；前端阻止默认关闭、等待所有编辑器落盘，
 * 再调用 forceClose() 真正销毁窗口。
 */
export async function installCloseGuard(): Promise<() => void> {
  if (!isTauri) {
    const beforeUnload = () => {
      void flushAllEditors();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  let closing = false;
  return getCurrentWindow().onCloseRequested(async (event) => {
    if (closing) return;
    event.preventDefault();
    try {
      await flushAllEditors();
      closing = true;
      await win.forceClose();
    } catch (error) {
      console.error("保存失败，已取消关闭窗口", error);
    }
  });
}
