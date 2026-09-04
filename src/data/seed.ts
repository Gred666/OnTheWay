import type { DayDoc, Goal, Note, Reminder, Task } from "./types";

type NullableTaskField = "meta" | "dueDate" | "timeLabel" | "category" | "goalId" | "completedAt";
type SeedTask = Omit<Task, NullableTaskField> & Partial<Pick<Task, NullableTaskField>>;
type SeedActionGroup = { title: string; taskIds: string[] };
type SeedNote = Omit<Note, "archiveCategory" | "archivedAt" | "actionGroup"> & {
  archiveCategory?: string | null;
  archivedAt?: number | null;
  actionGroup?: SeedActionGroup;
};
type SeedGoal = Omit<Goal, "actionGroup"> & {
  actionGroup?: SeedActionGroup;
};
type SeedDayDoc = Omit<DayDoc, "tasks"> & { taskIds: string[] };

/* ============================================================
   种子数据 —— 文案全部取自 Prototype/ 原型图，保持 1:1。
   P5 接 SQLite 后，这份数据变成首次启动的示例内容。
   ============================================================ */

const DAY = 864e5;
/** 用一个固定的「现在」让种子数据的相对时间稳定：2026-08-29 09:12 */
export const SEED_NOW = new Date(2026, 7, 29, 9, 12).getTime();

const t = (dayOffset: number, hh: number, mm: number) => {
  const d = new Date(SEED_NOW + dayOffset * DAY);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
};

/* ---------------- 任务 ---------------- */

export const seedTasks: SeedTask[] = [
  // 「秋季项目复盘」的下阶段行动
  {
    id: "t-autumn-1",
    title: "整理访谈中的高频语言",
    status: "done",
    meta: "负责人 · 以安",
    priority: 2,
    sortKey: "a0",
    completedAt: t(-1, 15, 20),
    createdAt: t(-6, 10, 0),
    updatedAt: t(-1, 15, 20),
  },
  {
    id: "t-autumn-2",
    title: "建立每周一次的决策回看",
    status: "done",
    meta: "周一 10:00",
    priority: 2,
    sortKey: "a1",
    completedAt: t(-1, 17, 5),
    createdAt: t(-6, 10, 0),
    updatedAt: t(-1, 17, 5),
  },
  {
    id: "t-autumn-3",
    title: "完成编辑器专注模式原型",
    status: "todo",
    meta: "截止 9月4日",
    priority: 3,
    dueDate: "2026-09-04",
    sortKey: "a2",
    createdAt: t(-6, 10, 0),
    updatedAt: t(-2, 9, 30),
  },

  // 「完成专注模式原型」的检查项 —— 今日TODO
  {
    id: "t-focus-1",
    title: "梳理进入与退出路径",
    status: "done",
    priority: 2,
    sortKey: "b0",
    completedAt: t(0, 11, 40),
    createdAt: t(-3, 14, 0),
    updatedAt: t(0, 11, 40),
  },
  {
    id: "t-focus-2",
    title: "完成空状态和动效说明",
    status: "todo",
    priority: 3,
    sortKey: "b1",
    createdAt: t(-3, 14, 0),
    updatedAt: t(-3, 14, 0),
  },
  {
    id: "t-focus-3",
    title: "邀请 3 位用户试用",
    status: "todo",
    priority: 2,
    sortKey: "b2",
    createdAt: t(-3, 14, 0),
    updatedAt: t(-3, 14, 0),
  },

  // 「本周目标」的本周重点
  {
    id: "t-week-1",
    title: "完成序笺 1.0 核心原型",
    status: "todo",
    priority: 4,
    sortKey: "c0",
    createdAt: t(-4, 9, 0),
    updatedAt: t(-4, 9, 0),
  },
  {
    id: "t-week-2",
    title: "完成 4 次深度工作",
    status: "done",
    priority: 3,
    sortKey: "c1",
    completedAt: t(-1, 18, 0),
    createdAt: t(-4, 9, 0),
    updatedAt: t(-1, 18, 0),
  },
  {
    id: "t-week-3",
    title: "完成两次力量训练",
    status: "todo",
    priority: 2,
    sortKey: "c2",
    createdAt: t(-4, 9, 0),
    updatedAt: t(-4, 9, 0),
  },
  {
    id: "t-week-4",
    title: "周日完成一次周复盘",
    status: "todo",
    priority: 3,
    sortKey: "c3",
    createdAt: t(-4, 9, 0),
    updatedAt: t(-4, 9, 0),
  },

  // 日历 8月29日
  {
    id: "t-cal-1",
    title: "完成日历交互说明与空状态",
    status: "todo",
    meta: "产品 · 上午",
    category: "产品",
    timeLabel: "上午",
    priority: 3,
    dueDate: "2026-08-29",
    sortKey: "d0",
    createdAt: t(-2, 9, 0),
    updatedAt: t(-2, 9, 0),
  },
  {
    id: "t-cal-2",
    title: "回顾第 35 周目标",
    status: "done",
    meta: "/GOAL · 16:00",
    category: "/GOAL",
    timeLabel: "16:00",
    priority: 2,
    dueDate: "2026-08-29",
    sortKey: "d1",
    completedAt: t(0, 8, 40),
    createdAt: t(-2, 9, 0),
    updatedAt: t(0, 8, 40),
  },
  {
    id: "t-cal-3",
    title: "力量训练",
    status: "todo",
    meta: "健康 · 18:30",
    category: "健康",
    timeLabel: "18:30",
    priority: 2,
    dueDate: "2026-08-29",
    sortKey: "d2",
    createdAt: t(-2, 9, 0),
    updatedAt: t(-2, 9, 0),
  },
];

/* ---------------- 笔记 ---------------- */

export const seedNotes: SeedNote[] = [
  {
    id: "n-autumn",
    title: "秋季项目复盘",
    icon: "file",
    excerpt: "团队是否更清楚为什么而做。",
    isPinned: false,
    isArchived: false,
    wordCount: 842,
    createdAt: new Date(2026, 7, 28, 11, 59).getTime(),
    updatedAt: t(0, 9, 12),
    contentMd: [
      "这一次，我们没有把“做得更多”当作衡量标准。真正重要的是：团队是否更清楚为什么而做，用户是否更自然地抵达价值。",
      "",
      "> [!核心判断]",
      "> 最有价值的进展，并不是交付数量，而是产品语言终于开始统一。",
      "",
      "从访谈记录回看，用户对入口的理解成本明显下降；与此同时，跨职能协作的决策链路也从平均三天缩短到一天以内。这说明我们需要继续保护清晰度，而不是急于增加新的功能层。",
      "",
      "## 下阶段行动",
      "",
      "- [x] 整理访谈中的高频语言",
      "- [x] 建立每周一次的决策回看",
      "- [ ] 完成编辑器专注模式原型",
    ].join("\n"),
  },
  {
    id: "n-kyoto",
    title: "京都书店清单",
    icon: "pin-place",
    excerpt: "那些安静、可以坐一下午的地方。",
    isPinned: true,
    isArchived: false,
    wordCount: 316,
    createdAt: t(-21, 20, 10),
    updatedAt: t(-5, 21, 30),
    contentMd: [
      "那些安静、可以坐一下午的地方。不追求书目齐全，只在意光线、座位和店主选书的性格。",
      "",
      "## 一乗寺",
      "",
      "惠文社一乗寺店。选书带有明确偏好，杂货区值得慢慢看。下午三点后阳光会斜进来。",
      "",
      "## 河原町",
      "",
      "誠光社。店面很小，但每一本都是店主挑的。适合待四十分钟，不适合久坐。",
      "",
      "> [!记一笔]",
      "> 好的书店不提供选择，它提供一种看待选择的方式。",
      "",
      "## 待去",
      "",
      "- 三月書房（寺町通）",
      "- ホホホ座（浄土寺）",
      "- レティシア書房（御幸町）",
    ].join("\n"),
  },
  {
    id: "n-grocery",
    title: "周末采购",
    icon: "circle-check",
    excerpt: "燕麦奶、灯泡、咖啡豆、洗衣液",
    isPinned: false,
    isArchived: false,
    wordCount: 68,
    createdAt: t(-2, 19, 0),
    updatedAt: t(-1, 10, 15),
    contentMd: [
      "周六上午一次解决，别分两趟。",
      "",
      "- 燕麦奶 ×2",
      "- 灯泡（书房那盏，暖光 4000K）",
      "- 咖啡豆（浅烘，200g）",
      "- 洗衣液",
      "",
      "顺路取快递。",
    ].join("\n"),
  },
  {
    id: "n-spark",
    title: "产品灵感碎片",
    icon: "sparkle",
    excerpt: "“好的工具，应该把思绪还给人。”",
    isPinned: false,
    isArchived: false,
    wordCount: 254,
    createdAt: t(-9, 23, 40),
    updatedAt: t(-3, 8, 5),
    contentMd: [
      "> [!一句话]",
      "> 好的工具，应该把思绪还给人。",
      "",
      "工具做得越勤快，人就越懒得想。真正好的工具应该在你需要它的时候出现，剩下的时间安静地待着。",
      "",
      "## 几个碎片",
      "",
      "- 空状态不是「什么都没有」，是「可以从这里开始」。",
      "- 动画的意义是解释变化，不是展示能力。变化解释完了，动画就该结束。",
      "- 一个功能如果需要说明书，多半是入口放错了地方。",
      "- 搜索框应该记住你上次没搜完的那个词。",
    ].join("\n"),
  },
  {
    id: "n-reading",
    title: "8月阅读摘录",
    icon: "bookmark",
    excerpt: "关于注意力、日常秩序与长期主义。",
    isPinned: false,
    isArchived: false,
    wordCount: 431,
    createdAt: t(-25, 22, 0),
    updatedAt: t(-4, 22, 45),
    contentMd: [
      "关于注意力、日常秩序与长期主义。这个月读得杂，但有几条串起来了。",
      "",
      "## 注意力",
      "",
      "注意力不是资源，是地形。你没法「省着用」，只能决定让它流向哪里。所以问题不是「今天专注了几小时」，而是「今天的环境让我自然地看向了什么」。",
      "",
      "## 秩序",
      "",
      "日常秩序的价值不在效率，在于减少决策。每天早上不用想「先做什么」，本身就是一种休息。",
      "",
      "> [!这个月最有用的一句]",
      "> 长期主义不是把时间拉长，而是把反馈缩短。",
      "",
      "## 待读",
      "",
      "- 关于城市步行尺度的那本，一直没开始",
      "- 找一本讲档案整理的书",
    ].join("\n"),
  },
];

/* ---------------- 归档 ---------------- */

export const seedArchived: SeedNote[] = [
  {
    id: "a-ia",
    title: "第一版信息架构草稿",
    icon: "file",
    excerpt: "最初的页面层级与交互假设。",
    archiveCategory: "工作笔记",
    isPinned: false,
    isArchived: true,
    wordCount: 842,
    archivedAt: new Date(2026, 7, 18, 16, 20).getTime(),
    createdAt: new Date(2026, 7, 28, 11, 59).getTime(),
    updatedAt: t(0, 9, 12),
    contentMd: [
      "最初的结构围绕“记录、整理、回顾”三个阶段展开，希望让笔记、备忘和目标自然地出现在同一条时间线上。",
      "",
      "后续测试发现，用户更需要明确的入口和更少的层级。因此这套方案被新的工作区结构替代，但其中关于快速记录和长期回顾的思路仍然值得保留。",
      "",
      "> [!当时的结论]",
      "> 好的结构不是展示所有能力，而是让下一步足够明确。",
    ].join("\n"),
  },
  {
    id: "a-moving",
    title: "搬家准备清单",
    icon: "circle-check",
    excerpt: "纸箱、地址变更、宽带预约。",
    archiveCategory: "TODO",
    isPinned: false,
    isArchived: true,
    wordCount: 194,
    archivedAt: new Date(2026, 7, 12, 9, 0).getTime(),
    createdAt: new Date(2026, 6, 20, 20, 0).getTime(),
    updatedAt: new Date(2026, 7, 12, 9, 0).getTime(),
    contentMd: [
      "已经搬完了，留着当下次的模板。",
      "",
      "## 提前两周",
      "",
      "- 宽带预约移机（要提前，师傅排期慢）",
      "- 联系搬家公司，确认是否走电梯",
      "- 纸箱 20 个 + 气泡膜",
      "",
      "## 提前三天",
      "",
      "- 地址变更：银行、快递、订阅",
      "- 冰箱清空",
      "",
      "> [!教训]",
      "> 书最重，最后打包，最先搬。别问为什么。",
    ].join("\n"),
  },
  {
    id: "a-spring",
    title: "春季阅读摘录",
    icon: "bookmark",
    excerpt: "关于注意力与日常秩序的摘录。",
    archiveCategory: "读书笔记",
    isPinned: false,
    isArchived: true,
    wordCount: 377,
    archivedAt: new Date(2026, 6, 30, 21, 15).getTime(),
    createdAt: new Date(2026, 2, 4, 21, 0).getTime(),
    updatedAt: new Date(2026, 6, 30, 21, 15).getTime(),
    contentMd: [
      "关于注意力与日常秩序的摘录。和 8 月那份有重叠，但角度不同。",
      "",
      "## 三月",
      "",
      "把「想做的事」和「该做的事」分成两张清单，是一种自欺。它们本来就在抢同一段时间。",
      "",
      "## 五月",
      "",
      "> [!当时抄下来的]",
      "> 秩序感来自可预期，不来自整齐。",
    ].join("\n"),
  },
  {
    id: "a-roadmap",
    title: "旧版产品路线图",
    icon: "file",
    excerpt: "已由新的季度计划替代。",
    archiveCategory: "工作笔记",
    isPinned: false,
    isArchived: true,
    wordCount: 522,
    archivedAt: new Date(2026, 6, 16, 11, 30).getTime(),
    createdAt: new Date(2026, 3, 8, 10, 0).getTime(),
    updatedAt: new Date(2026, 6, 16, 11, 30).getTime(),
    contentMd: [
      "已由新的季度计划替代。保留是因为里面对优先级的排序方式仍然成立。",
      "",
      "## 原计划",
      "",
      "四个季度各压一个大特性，结果第二季度就发现节奏排不下——每个特性都比估计的长 40%。",
      "",
      "## replaced by",
      "",
      "新计划改成「一个主线 + 若干可随时中断的支线」。主线保证推进，支线用来填空隙。",
      "",
      "> [!留下来的判断]",
      "> 路线图的作用不是预测，是让人知道什么时候该说不。",
    ].join("\n"),
  },
];

/* ---------------- 今日 TODO 文档 ---------------- */

export const seedTodayDoc = {
  id: "today",
  title: "完成专注模式原型",
  contentMd:
    "为编辑器补充一个真正安静的专注模式：隐藏非必要入口，只保留正文、字数和退出方式。\n\n## 检查项\n\n- [x] 梳理进入与退出路径\n- [ ] 实现快捷键与状态保持\n- [ ] 完成真实内容下的可用性走查",
  wordCount: 842,
  updatedAt: t(0, 20, 14),
};

/* ---------------- 目标 ---------------- */

export const seedGoals: SeedGoal[] = [
  {
    id: "g-week",
    horizon: "week",
    title: "本周目标",
    periodStart: "2026-08-24",
    createdAt: t(-5, 9, 0),
    updatedAt: t(0, 9, 12),
    contentMd: [
      "这一周，把序笺推进到可以真正交给用户测试的状态；同时保护精力，不让忙碌挤掉思考和运动。",
      "",
      "## 记录",
      "",
      "本周暂时不增加新的功能范围。所有决定先回到用户是否能更快开始记录，以及编辑过程是否足够安静。",
      "",
      "## 本周重点",
      "",
      "- [ ] 完成编辑器稳定性验证",
      "- [ ] 整理首次启动体验",
      "- [ ] 完成日历交互说明",
      "- [ ] 安排两次力量训练",
    ].join("\n"),
  },
  {
    id: "g-month",
    horizon: "month",
    title: "八月目标",
    periodStart: "2026-08-01",
    createdAt: new Date(2026, 7, 1, 9, 0).getTime(),
    updatedAt: t(-6, 10, 0),
    contentMd: [
      "八月只做一件事：让序笺从「能用」走到「愿意每天打开」。其余需求一律推迟到九月再评估。",
      "",
      "## 判断标准",
      "",
      "不是功能数量，是连续使用天数。如果我自己都做不到连续用满两周，就说明还不够。",
      "",
      "> [!这个月的取舍]",
      "> 宁可少一个模块，也不要多一层入口。",
    ].join("\n"),
  },
  {
    id: "g-year",
    horizon: "year",
    title: "2026 年目标",
    periodStart: "2026-01-01",
    createdAt: new Date(2026, 0, 1, 10, 0).getTime(),
    updatedAt: t(-20, 15, 0),
    contentMd: [
      "今年想把注意力收回到三件事上：做完一个自己会长期用的工具、恢复稳定的运动节奏、重新开始认真读书。",
      "",
      "## 做完一个工具",
      "",
      "不是做出来，是做完 —— 发布、有人用、根据反馈迭代过至少三轮。",
      "",
      "## 身体",
      "",
      "全年力量训练不少于 100 次。不追求强度，追求不断。",
      "",
      "## 读书",
      "",
      "每月至少一本读完并写摘录。写不出摘录说明没读进去。",
      "",
      "> [!年初写下的]",
      "> 少做几件事，然后把它们做到有反馈为止。",
    ].join("\n"),
  },
];

/* ---------------- 日历 ---------------- */

export const seedDayDocs: SeedDayDoc[] = [
  {
    date: "2026-08-29",
    taskIds: ["t-cal-1", "t-cal-2", "t-cal-3"],
    noteMd: "今天只安排最重要的三件事。给深度工作留下完整时间，不把未完成的事项带入下一天。",
    updatedAt: t(0, 9, 12),
  },
];

/** 日历上带小圆点的日期（有内容的日子） */
export const seedMarkedDates = new Set<string>([
  "2026-08-06",
  "2026-08-12",
  "2026-08-18",
  "2026-08-21",
  "2026-08-29",
]);

/* ---------------- 提醒 ---------------- */

export const seedReminders: Record<string, Reminder> = {
  default: { label: "提醒", when: "今天 16:30", what: "回看行动项" },
  goal: { label: "回顾提醒", when: "周日 20:00", what: "更新下一周目标" },
};

const normalizeTask = (task: SeedTask): Task => ({
  ...task,
  meta: task.meta ?? null,
  dueDate: task.dueDate ?? null,
  timeLabel: task.timeLabel ?? null,
  category: task.category ?? null,
  goalId: task.goalId ?? null,
  completedAt: task.completedAt ?? null,
});

const normalizeNote = (note: SeedNote): Note => ({
  ...note,
  archiveCategory: note.archiveCategory ?? null,
  archivedAt: note.archivedAt ?? null,
  actionGroup: null,
});

const normalizeGoal = (goal: SeedGoal): Goal => ({
  ...goal,
  actionGroup: null,
});

/** 浏览器 mock 与 Rust 首次启动种子保持同一份内容。 */
export const seedTasksRaw: Task[] = seedTasks.map(normalizeTask);
export const seedNotesRaw: Note[] = seedNotes.map(normalizeNote);
export const seedArchivedRaw: Note[] = seedArchived.map(normalizeNote);
export const seedGoalsRaw: Goal[] = seedGoals.map(normalizeGoal);
export const seedDayNotes: Record<string, string> = Object.fromEntries(
  seedDayDocs.map((day) => [day.date, day.noteMd]),
);
