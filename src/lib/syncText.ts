import type { SyncStatus } from "@/data/types";

/* ============================================================
   同步状态怎么说（技术方案 §5.9.9）：导航栏左下那一行、同步对话框共用。
   ============================================================ */

/** 上一次同步是什么时候：刚刚 / 3 分钟前 / 10:32 / 10月6日 */
export function formatSyncedAt(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  const then = new Date(at);
  const today = new Date(now);
  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate();
  if (sameDay) {
    return `${String(then.getHours()).padStart(2, "0")}:${String(then.getMinutes()).padStart(2, "0")}`;
  }
  return `${then.getMonth() + 1}月${then.getDate()}日`;
}

/** 导航栏那一行的字（短）和悬停时的说明（长） */
export function describeSync(status: SyncStatus, now: number): { label: string; detail: string } {
  const where = status.remote ? ` · ${status.remote}` : "";
  const when = status.lastSyncedAt ? formatSyncedAt(status.lastSyncedAt, now) : null;
  const pending = status.unpushed > 0 ? `${status.unpushed} 次改动还没推上去` : null;
  switch (status.state) {
    case "off":
      return { label: "开启同步", detail: "把笔记同步到 GitHub / Gitee 上的私有仓库" };
    case "idle":
      return {
        label: when ? `已同步 · ${when}` : "已同步",
        detail: `${when ? `上次同步 ${when}` : "已同步"}${where}`,
      };
    case "syncing":
      return { label: "同步中…", detail: `正在同步${where}` };
    case "offline":
      return {
        label: pending ? `离线 · ${status.unpushed} 次改动没推` : "离线",
        detail: `连不上云端，改动都在本机，过一会儿会再试${pending ? `（${pending}）` : ""}`,
      };
    case "auth":
      return { label: "登录失效", detail: "同步账号的登录过期了，点这里重新登录" };
    case "error":
      return { label: "同步出错", detail: status.message ?? "同步出错了，点这里看原因" };
  }
}

/** 文件大小：「230 MB」「1.2 GB」 */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.ceil(mb)} MB`;
}
