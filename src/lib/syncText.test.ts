import { SYNC_OFF } from "@/data/types";
import { describe, expect, it } from "vitest";
import { describeSync, formatBytes, formatSyncedAt } from "./syncText";

const at = (h: number, m: number, day = 7) => new Date(2026, 9, day, h, m).getTime();

describe("formatSyncedAt", () => {
  it("says just now, minutes ago, the time today, or the date", () => {
    const now = at(10, 30);
    expect(formatSyncedAt(now - 20_000, now)).toBe("刚刚");
    expect(formatSyncedAt(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(formatSyncedAt(at(8, 5), now)).toBe("08:05");
    expect(formatSyncedAt(at(23, 0, 6), now)).toBe("10月6日");
  });
});

describe("describeSync", () => {
  const now = at(10, 30);

  it("invites to turn sync on when it is off", () => {
    expect(describeSync(SYNC_OFF, now).label).toBe("开启同步");
  });

  it("shows when it last synced and where", () => {
    const text = describeSync(
      { ...SYNC_OFF, state: "idle", lastSyncedAt: now - 3 * 60_000, remote: "github.com/me/notes" },
      now,
    );
    expect(text.label).toBe("已同步 · 3 分钟前");
    expect(text.detail).toBe("上次同步 3 分钟前 · github.com/me/notes");
  });

  it("counts what is waiting to be pushed while offline", () => {
    const text = describeSync({ ...SYNC_OFF, state: "offline", unpushed: 2 }, now);
    expect(text.label).toBe("离线 · 2 次改动没推");
    expect(text.detail).toContain("改动都在本机");
  });

  it("passes the error message through", () => {
    expect(
      describeSync({ ...SYNC_OFF, state: "error", message: "云端拒绝了: 仓库不存在" }, now).detail,
    ).toBe("云端拒绝了: 仓库不存在");
  });
});

describe("formatBytes", () => {
  it("rounds megabytes up and switches to gigabytes", () => {
    expect(formatBytes(100 * 1024 * 1024 + 1)).toBe("101 MB");
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe("1.3 GB");
  });
});
