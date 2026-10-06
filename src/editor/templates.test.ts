import { parseBlocks } from "@/lib/markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  CARET,
  TEMPLATES,
  type TemplateContext,
  type TemplateScope,
  applyTemplate,
  hasOtherContent,
  isTemplateTrigger,
  openTasksOf,
  scopeLabel,
  templateTrigger,
  templatesFor,
} from "./templates";

const byId = (id: string) => TEMPLATES.find((template) => template.id === id)!;
const ctx = (scope: TemplateScope, date: string, today = "2026-09-27"): TemplateContext => ({
  scope,
  date,
  today,
});

/** 光标放在 `|` 处（去掉它）的状态 */
function stateAt(markdown: string): EditorState {
  const head = markdown.indexOf("|");
  return EditorState.create({
    doc: markdown.replace("|", ""),
    selection: EditorSelection.cursor(head),
  });
}

/** 插入 / 替换之后的正文，光标处标 `|` */
function applied(markdown: string, source: string, mode: "insert" | "replace"): string {
  const state = stateAt(markdown);
  const trigger = templateTrigger(state);
  expect(trigger).not.toBeNull();
  const next = state.update(applyTemplate(state, trigger!, source, mode)).state;
  const head = next.selection.main.head;
  const doc = next.doc.toString();
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
}

describe("触发词", () => {
  it("accepts /模板 and its aliases, including the IME's 、 for /", () => {
    for (const line of [
      "/模板",
      "/model",
      "/MODEL",
      "/Template",
      "/mb",
      "/tpl",
      "、模板",
      "、mb",
    ]) {
      expect(isTemplateTrigger(line), line).toBe(true);
    }
    expect(isTemplateTrigger("  /模板  ")).toBe(true);
  });

  it("only fires on a line that holds nothing but the trigger", () => {
    for (const line of [
      "/模板 周",
      "看 /模板",
      "/models",
      "模板",
      "//模板",
      "- /模板",
      "> /模板",
    ]) {
      expect(isTemplateTrigger(line), line).toBe(false);
    }
  });

  it("needs a single empty caret at the end of the trigger", () => {
    expect(templateTrigger(stateAt("前言\n/模板|\n后记"))).toEqual({ from: 3, to: 6 });
    expect(templateTrigger(stateAt("/模板 |"))).toEqual({ from: 0, to: 4 });
    expect(templateTrigger(stateAt("/模|板"))).toBeNull();
    const selected = EditorState.create({
      doc: "/模板",
      selection: EditorSelection.range(0, 3),
    });
    expect(templateTrigger(selected)).toBeNull();
  });
});

describe("模板清单", () => {
  it("offers every document kind a few templates, with unique ids", () => {
    expect(templatesFor("day").map((t) => t.name)).toEqual([
      "今日计划",
      "时间块",
      "晚间复盘",
      "三行日记",
    ]);
    expect(templatesFor("week")).toHaveLength(3);
    expect(templatesFor("month")).toHaveLength(2);
    expect(templatesFor("year")).toHaveLength(2);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  it("builds every template with exactly one caret and well-formed tables", () => {
    for (const template of TEMPLATES) {
      const source = template.build(
        ctx(template.scope, template.scope === "day" ? "2026-09-27" : "2026-09-28"),
      );
      expect(source.split(CARET), template.id).toHaveLength(2);
      // 同一张表每一行的格子数一样（多一格少一格，表格就退回源码了）
      let columns: number | null = null;
      for (const line of source.split("\n")) {
        if (!line.startsWith("|")) {
          columns = null;
          continue;
        }
        const cells = line.split("|").length - 2;
        if (columns === null) columns = cells;
        expect(cells, `${template.id}: ${line}`).toBe(columns);
      }
    }
  });

  it("previews every table as a table, not as raw pipes", () => {
    // 预览走占位渲染器（lib/markdown.tsx），它的分隔行至少要三个 `-`
    for (const template of TEMPLATES) {
      const source = template.build(ctx(template.scope, "2026-09-28"));
      const tables = source.split("\n").filter((line) => /^\|[:-]+\|/.test(line)).length;
      const rendered = parseBlocks(source).filter((block) => block.kind === "table").length;
      expect(rendered, template.id).toBe(tables);
      expect(
        parseBlocks(source).some((block) => block.kind === "p" && block.text.includes("|")),
      ).toBe(false);
    }
  });

  it("labels the picker with the document's own period", () => {
    expect(scopeLabel(ctx("day", "2026-09-27"))).toBe("9月27日 · 周日");
    expect(scopeLabel(ctx("week", "2026-09-28"))).toBe("第 40 周");
    expect(scopeLabel(ctx("month", "2026-10-01"))).toBe("十月");
    expect(scopeLabel(ctx("year", "2026-01-01"))).toBe("2026 年");
  });
});

describe("按日期现算", () => {
  it("lays out the seven days of the week, dated so they land in the calendar", () => {
    const source = byId("week-plan").build(ctx("week", "2026-09-28"));
    expect(source).toContain("- **周一**\n  - [ ] @2026-09-28 \n- **周二**");
    expect(source).toContain("- **周日**\n  - [ ] @2026-10-04 ");
    expect(source).toContain("- [ ] 周复盘 @2026-10-04 20:00 #复盘");
  });

  it("leaves out review checkpoints that are already in the past", () => {
    const past = byId("week-plan").build(ctx("week", "2026-09-21", "2026-09-28"));
    expect(past).not.toContain("周复盘");
    const lastDay = byId("week-plan").build(ctx("week", "2026-09-21", "2026-09-27"));
    expect(lastDay).toContain("周复盘 @2026-09-27");

    const year = byId("year-plan").build(ctx("year", "2026-01-01", "2026-09-27"));
    expect(year).not.toContain("第一季度回顾");
    expect(year).not.toContain("年中回顾");
    expect(year).toContain("- [ ] 第三季度回顾 @2026-09-30 #复盘");
    expect(year).toContain("- [ ] 年度复盘 @2026-12-31 #复盘");
    expect(byId("year-plan").build(ctx("year", "2025-01-01"))).not.toContain("回顾节点");
  });

  it("dates the habit tracker's columns, across a month boundary", () => {
    const source = byId("week-habits").build(ctx("week", "2026-09-28"));
    expect(source).toContain("| 习惯 | 一 28 | 二 29 | 三 30 | 四 1 | 五 2 | 六 3 | 日 4 |");
  });

  it("splits the month into its weeks, clipped to the month", () => {
    const source = byId("month-plan").build(ctx("month", "2026-10-01"));
    expect(source).toContain("> [!十月的主题]");
    expect(source).toContain(
      [
        "- **第 40 周** 10/1 – 10/4：",
        "- **第 41 周** 10/5 – 10/11：",
        "- **第 42 周** 10/12 – 10/18：",
        "- **第 43 周** 10/19 – 10/25：",
        "- **第 44 周** 10/26 – 10/31：",
      ].join("\n"),
    );
    expect(source).toContain("- [ ] 月度复盘 @2026-10-31 20:00 #复盘");
    // 二月、跨年的一月
    expect(byId("month-plan").build(ctx("month", "2027-02-01"))).toContain("2/22 – 2/28：");
    expect(byId("month-plan").build(ctx("month", "2027-01-01"))).toContain(
      "- **第 53 周** 1/1 – 1/3：",
    );
  });
});

describe("插入", () => {
  const source = `## 标题\n\n- ${CARET}`;

  it("turns an empty document into the template, caret where the template says", () => {
    expect(applied("/模板|", source, "insert")).toBe("## 标题\n\n- |");
  });

  it("keeps a blank line between the template and the text around it", () => {
    expect(applied("上面\n/模板|\n下面", source, "insert")).toBe("上面\n\n## 标题\n\n- |\n\n下面");
    expect(applied("上面\n\n/模板|\n\n下面", source, "insert")).toBe(
      "上面\n\n## 标题\n\n- |\n\n下面",
    );
  });

  it("puts the caret at the end when the template has no caret mark", () => {
    expect(applied("/模板|", "## 标题", "insert")).toBe("## 标题|");
  });

  it("tags the edit so it does not reopen the picker", () => {
    const state = stateAt("/模板|");
    const spec = applyTemplate(state, templateTrigger(state)!, source, "insert");
    expect(spec.userEvent).toBe("input.template");
  });
});

describe("替换全文", () => {
  const source = `## 今天\n\n- ${CARET}`;

  it("only offers to replace when there is something besides the trigger", () => {
    const empty = stateAt("\n/模板|\n");
    expect(hasOtherContent(empty, templateTrigger(empty)!)).toBe(false);
    const written = stateAt("昨天的事\n/模板|");
    expect(hasOtherContent(written, templateTrigger(written)!)).toBe(true);
  });

  it("carries unfinished tasks into 待续 and drops the rest", () => {
    const yesterday = [
      "## 最重要的三件事",
      "",
      "- [x] 做完了的",
      "- [ ] 没做完的",
      "  - [ ] 子任务",
      "1. [ ] 编号的",
      "- [ ] ",
      "",
      "/模板|",
    ].join("\n");
    expect(applied(yesterday, source, "replace")).toBe(
      "## 今天\n\n- |\n\n## 待续\n\n- [ ] 没做完的\n- [ ] 子任务\n- [ ] 编号的",
    );
  });

  it("keeps the front matter on top", () => {
    const doc = "---\ntags: 日记\n---\n\n旧内容\n/模板|";
    expect(applied(doc, source, "replace")).toBe("---\ntags: 日记\n---\n\n## 今天\n\n- |");
  });
});

describe("未完成任务", () => {
  it("normalises, dedupes and skips fenced code", () => {
    const markdown = [
      "- [ ] 写周报 @2026-09-28",
      "* [ ] 写周报 @2026-09-28",
      "   + [ ]   缩进的  ",
      "- [X] 勾上了",
      "- [ ]没有空格",
      "```md",
      "- [ ] 代码里的",
      "```",
      "- [ ] 代码后面的",
    ].join("\n");
    expect(openTasksOf(markdown)).toEqual([
      "- [ ] 写周报 @2026-09-28",
      "- [ ] 缩进的",
      "- [ ] 代码后面的",
    ]);
  });
});
