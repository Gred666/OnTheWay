import { describe, expect, it } from "vitest";
import { diffHunks, diffLines, diffStats } from "./lineDiff";

describe("逐行对比（冲突副本）", () => {
  it("marks what only the original has and what only the copy has", () => {
    const lines = diffLines("一\n二\n三\n四", "一\n二改\n三\n四\n五")!;
    expect(lines).toEqual([
      { kind: "same", text: "一" },
      { kind: "removed", text: "二" },
      { kind: "added", text: "二改" },
      { kind: "same", text: "三" },
      { kind: "same", text: "四" },
      { kind: "added", text: "五" },
    ]);
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
  });

  it("identical texts have no changes", () => {
    const lines = diffLines("a\nb", "a\nb")!;
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0 });
    expect(diffHunks(lines)).toEqual([]);
  });

  it("keeps one line of context and splits far-apart changes", () => {
    const before = Array.from({ length: 20 }, (_, i) => `行${i}`).join("\n");
    const after = before.replace("行2", "行2!").replace("行15", "行15!");
    const hunks = diffHunks(diffLines(before, after)!);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.lines.map((line) => line.text)).toEqual(["行1", "行2", "行2!", "行3"]);
  });

  it("gives up on huge inputs instead of freezing", () => {
    const big = (tag: string) => Array.from({ length: 3000 }, (_, i) => `${tag}${i}`).join("\n");
    expect(diffLines(big("a"), big("b"))).toBeNull();
  });
});
