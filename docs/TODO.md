# OnTheWay 开发进度

> 每次开工先看这里，收工更新这里。
> 技术基准见 [技术方案.md](./技术方案.md)（v2.0，已按代码现状重写）。

---

## 环境备忘

Rust 装在 **非默认路径**，新终端要先设环境变量否则 `cargo` 找不到：

```powershell
$env:CARGO_HOME="D:\Dev\cargo"; $env:RUSTUP_HOME="D:\Dev\rustup"; $env:Path="D:\Dev\cargo\bin;$env:Path"
```

| 工具 | 版本 |
|---|---|
| Node | v24.10.0 |
| pnpm | 10.30.3 |
| rustc / cargo | 1.96.0 (MSVC) |
| Vite / React / Tailwind | 6.4 / 19.2 / 4.3 |
| Motion | 12.43 |
| CodeMirror view | 6.43 |
| Vitest | 4.1 |

pnpm 10 默认拦截 postinstall，`pnpm-workspace.yaml` 里已放行 `esbuild` 和 `@biomejs/biome`。

**常用命令**

浏览器调 UI（mock 后端，localStorage）：

```bash
pnpm dev
```

桌面端：

```bash
pnpm tauri dev
```

类型检查 / lint / 前端测试：

```bash
npx tsc --noEmit
```

```bash
pnpm lint
```

```bash
pnpm test
```

Rust 测试（`--no-default-features` 下 `main.rs` 编不过，必须加 `--lib`；装了 WebView 依赖的机器上 `cargo test --lib` 会连 `commands.rs` 一起测）：

```bash
cd src-tauri; cargo test --no-default-features --lib
```

不碰真实笔记跑桌面端（换一个应用数据目录和仓库文件夹；想试搬家就先把 `ontheway.db` 拷一份进这个数据目录）：

```powershell
$env:ONTHEWAY_DATA_DIR="D:\tmp\otw-data"; $env:ONTHEWAY_VAULT="D:\tmp\otw-vault"; pnpm tauri dev
```

不起 app 重新生成 `src/lib/bindings.ts`（debug 启动也会自动生成）。注意这条命令导出的文件里没有 `ready` / `win_*` 这几个窗口命令（它们只在 desktop-runtime 下注册），提交前以 debug 启动生成的为准：

```bash
cd src-tauri; cargo run --example export_bindings --features typegen --no-default-features
```

---

## 设计基准（从 Prototype/ 提炼）

**核心抽象：一切皆文档。** 笔记、今日TODO、GOAL、日历的某一天、归档项 —— 全部是同一种结构：

```
（可选横幅）大标题 +（可选分段控件）
正文 Markdown（CodeMirror 所见即所得）
右侧目录树 + 底部状态栏
```

五个模块不是五套 UI，是同一个 `DocumentView` 的不同数据源。新增内容类型 = 在
`data/adapter.ts` 里多映射一个 `DocumentModel`，**不写新视图组件**。守住这条。

**布局**

| 区域 | 宽度 | 出现条件 |
|---|---|---|
| 标题栏 | 38px，无背景，浮在内容上 | 仅 Tauri 内 |
| 左导航 | 240px | 常驻 |
| 中列表栏 | 300px | 笔记 / 日历 / 归档；今日TODO、GOAL、扩展 是两栏 |
| 主内容 | flex-1，内容 max-w 860px | 常驻 |
| 右目录树 | 180px | ≥1280px 显示（`xl:`），条目多了自己滚动；专注模式下是贴右缘的浮层刻度 |

**色板**（亮色取样自原型图，1:1；暗色手工配平）见技术方案 §9.1。

---

## 阶段划分

- [x] **P0 环境与规划**
- [x] **P1 前端骨架与设计系统**
- [x] **P2 应用外壳与导航动效**
- [x] **P3 五个视图**
- [x] **P4 Tauri 外壳接入**
- [x] **P5 Rust + SQLite 后端**
- [x] **P6 编辑器**（Milkdown 接入 → 实机不行 → 换成 CodeMirror 6）
- [x] **P6.5 文档模型收口**（行动项迁回 Markdown、今日TODO = 某一天、GOAL 一周期一篇）
- [ ] **P7 打磨与性能** ← 现在

---

## 已完成

### P1 骨架与设计系统 ✅

- `styles/globals.css`：色板 token、亮暗双主题（`data-theme` + `@custom-variant dark`）、`prose-doc` 排版、编辑器全部样式
- `lib/motion.ts`：spring（含 `layout`）/ tween（含 `instant` `slow`）预设、stagger、layoutId 命名空间、`usePrefersReducedMotion`
- `lib/date.ts`：全局唯一时间入口，ISO 日期字符串、周期起止、月网格、ISO 周数、中文格式化
- `lib/markdown.tsx`：`buildOutline`（ATX / Setext / callout 进目录树）、`countWords`；`renderMarkdown` 现在只做占位
- `lib/cn.ts`、`lib/tauri.ts`、`lib/platform.ts`（mac ⌘ / Windows Ctrl 的快捷键提示）
- `data/types.ts` / `seed.ts` / `store.ts` / `adapter.ts` / `backend.ts` / `mock.ts`

### P2 外壳与动效 ✅

| 位置 | 动效 |
|---|---|
| Logo | SVG 九段笔画 `stroke-dashoffset` 依序描出、停一拍、再收回，无限循环 |
| 导航活动项 | `layoutId` 指示块滑动 |
| 导航项入场 | stagger |
| 中列表栏出现/消失 | 整块 `x: -300 → 0` 从导航栏底下抽出，**220ms tween**；布局只在挂载那一帧变一次（见坑记录） |
| 主内容切换 | `popLayout` 冻结退场屏交叉淡出，退场方向感知横移；**进场纯 opacity**（编辑器才能第一帧挂上） |
| 切换文档（笔记 / 日历某天 / GOAL 周期） | `SwapFade`：旧内容的静态快照原地淡出上飘 4px（140ms），新内容纯 opacity 淡入（220ms）；标题、正文、状态栏、目录树整块一起换 |
| 标题下分隔线 | `scaleX` 从 0 展开（进工作区时一次，换篇不重播） |
| 目录树活动条 | `layoutId` 滑动，跟编辑器行号联动 |
| 主题切换按钮 | 图标旋转交叉淡入 |
| 命令面板 | 静态 backdrop-blur + 只动 opacity/scale |
| 专注模式 | 左侧 chrome 切 absolute 后 `x: -540` 滑出，正文画布往左多铺 540px |

### P3 五个视图 ✅

- **笔记**：标题筛选、三种排序（单选菜单）、置顶分组、选中高亮 `layoutId` 滑动、新建、行菜单（置顶 / 归档 / 删除）
- **今日TODO**：两栏，就是今天这一天的文档
- **/GOAL**：周月年分段，一个周期一篇，标题由周期算
- **日历**：6×7 固定月网格、ISO 周数、选中周整行高亮、方向感知切月、「今天」按钮按需出现、写过的日子墨点；右侧「日TODO / 周·月·年 GOAL」四段
- **归档**：归档横幅、分类·日期、悬停旋转的恢复按钮，正文仍可编辑
- **扩展**：目录页（官方占位 + 本地导入清单），无运行时
- **命令面板**：⌘K，跳转 / 笔记 / 外观三组，方向键 + 回车

### 行动项勾选动画（日历「当日安排」）

三层同时发生，总时长约 380ms：对勾 `pathLength` 描边、圆环脉冲、文字色过渡。

### P4 Tauri 外壳 ✅

- `src-tauri/` 脚手架、`tauri.conf.json`、`Cargo.toml`（feature `desktop-runtime` / `typegen`）、`capabilities/default.json`
- 应用图标：蓝底 + 一条「在路上」的弧线，全套尺寸
- 无边框窗口 + 自定义标题栏 `TitleBar.tsx`：按钮平时 opacity 0.28，悬停浮现；双击最大化；`win_start_dragging` 必须在 mousedown 同一调用栈发起
- `visible: false` + 首帧双 rAF 后 `ready()` 才 show()，消除开局白闪
- 单实例、窗口状态记忆
- 关窗保护：`onCloseRequested` → flush 所有编辑器 → `win_force_close`；保存失败不锁死窗口，再点一次放弃修改

### P5 Rust + SQLite ✅

- `0001_init.sql` + 三次迁移（见技术方案 §5.3）
- 连接池 + PRAGMA（WAL / foreign_keys 每连接都要设）；迁移前 Online Backup；`DbTooNew` 拒绝降级
- `domain/` 各模块 + 59 个单测（迁移链路、FTS5、rrule / 时区、双链、延续语义…）
- jieba 分词 + FTS5（**不要用 trigram**，中文双字词搜不到）；`build_match_query` 空 / 纯标点返回 None
- tauri-specta 生成 `src/lib/bindings.ts`；三个 crate 版本 `=` 锁死；`typegen` feature 可不起 app 导出
- 笔记 / 任务变更与 append-only `activity` 同一事务
- 双链保存时同步 `link(kind='ref')`，不存在的目标保留 Markdown
- 首次启动 `seed::ensure` 播种示例内容，`setting.seeded_v1` 标记只播一次
- 浏览器 mock backend（`otw.mock.v3`）语义贴近 Rust

### P6 编辑器 ✅（CodeMirror 6）

Milkdown 在实机上接入后被整个换掉：AST ↔ Markdown 互转导致输入跳行、内容漂移，Crepe 的框架 UI 也和原型不合。现在：

- `@codemirror/lang-markdown`（CommonMark + GFM）解析，文档始终是 Markdown 源文
- Typora 式装饰：光标不在的语法范围藏标记 + 加样式，进入后原位展开
- 装饰拆成块级 `StateField`（全文浅遍历）+ 行内 `ViewPlugin`（只处理视口）：53KB 文档 5.3ms → 0.57ms
- widget：任务勾选框（点击改源码）、列表符号、围栏封口 + 语言名、分隔线、图片、表格（点击回源码）
- `markdownStyleRegistry.ts` 注册表：新增纯样式语法只加一行
- Typora 对齐的快捷键（`Mod-k` 让给命令面板；插入链接 `Shift-Mod-k`）；搜索面板中文化
- 串行 400ms 防抖保存；Mod-S / 失焦 / 切换 / 关窗统一 flush；失败版本放回队列重试
- 外部回填只在本地无未同步编辑时进行（修掉「某天备注异步到达前一输入就整篇覆盖」的 P0）
- 编辑器分包在 bootstrap 里预载，首帧直接是编辑器，没有「预览 → 编辑器」的闪动
- 目录树用编辑器行号跳转；正文变化 250ms 防抖、标题集合没变不重渲染
- 自绘 `OverlayScrollbar`，滑块对 `scrollHeight` 的变化做指数缓动跟随
- 支持 / 不支持的语法清单见技术方案 §11.4

### P6.7 动态表情 ✅

- 自己画的 36 个线稿动画表情（心情 / 干劲 / 在路上 / 日常 / 打工人 / 吃瓜），SVG + Web Animations，亮暗主题都跟着变
- 源文是 `:otw_<id>:` 短码；编辑器里像一个字符（贴着不展开、退格整删、方向键跨过），看得见就一直循环，单击从头再来、双击改源码
- `Mod-e` 选择器：贴光标、最近使用、中文 / 拼音 / 英文搜索、方向键 + 回车、输入法组字不误触
- 列表摘要、目录、表格单元格里换成 Unicode；主包只带一张「短码 → Unicode」的小表
- 行高零变化、在前面打字不重播、滚出视口就停、同时循环最多 48 个；细节见技术方案 §11.4.2
- 性能：静止时换成一张按主题缓存的图，只在循环时叠上活的 SVG —— 一屏 400 个表情首次渲染 217 → 103ms，画质逐像素验证未变；循环每轮用计时器重播，停顿期间不占帧
- 第三批「网络梗」12 个：打工人（摸鱼、躺平、头秃、下班、充电、奶茶）和吃瓜（吃瓜、鸽了、柠檬精、裂开、666、灵魂出窍）；选择器六组放不下，网格限高滚动，矮窗口里两边都放不下时压矮网格贴在空间大的一侧

### P6.6 Markdown 语法补全 ✅

- 解析器识别但以前没表现的：`~sub~` `^sup^`、`:emoji:`（`editor/emoji.ts` 短码表）、`&entity;`（`editor/entities.ts`）、硬换行 `↵`、`\*` 只藏反斜杠、块级 HTML、嵌套引用按层叠竖线
- 新语法：`==高亮==`、`[[双链]]` / `[[目标|别名]]`、`[^脚注]`、`> [!标签]` callout（五种语义 + 中文自定义）、`[TOC]` 目录 widget、YAML front matter 折叠、图片 `"title"` 与 `|300x200`
- 方括号分流：没有定义的 `[文字]` 不再被染成链接（以前任何 `[x]` 都藏括号变链接色），块级层收集 `referenceLabels` 供行内层判断
- 围栏代码：`@codemirror/language-data` 按语言懒加载 + `codeHighlight.ts` 调色板（`--code-*`，亮暗各一套）；封口带复制按钮（clipboard API 失败退回 execCommand）
- 链接：Mod + 点击打开（`@tauri-apps/plugin-opener`，只放行 http(s) / mailto / tel），按住 Mod 变手形，悬停 tooltip 显示地址
- 表格单元格 / 目录条目用 `editor/inlineDom.ts` 渲染行内格式，真实 DOM 不走 innerHTML
- widget 全部搬到 `editor/widgets.ts`；`MarkdownEditor.tsx` 只剩两层装饰的编排
- 测试：`markdownSyntax.dom.test.ts`（21 个 DOM 用例）+ `markdownExtras.test.ts`（纯函数）

### P6.5 文档模型收口 ✅

- 行动项区块（`link(kind='action')` + 独立 task）迁回宿主正文的 `## 标题` + `- [ ]`（迁移 0003），整篇文档只有一个编辑面
- 「今日TODO」从特殊笔记 `n-today` 变成今天这一天的 `day_doc`（迁移 0004），`day_doc` 加可编辑标题
- 今天没写过时**延续**之前最近一天（`carried_from`），一编辑才落库；零点翻页丢掉延续缓存
- GOAL 合并成一篇 `content_md`、`UNIQUE(horizon, period_start)`（迁移 0002）；没写过的周期返回空文档不落库；`period_start` 必须是周期起点
- 零点翻页 `startTodayTicker`：对准下一个零点 + 唤醒对表
- 专注模式（笔记区）：Esc 退出、离开笔记区自动退出

## P7 打磨

- [ ] 全文搜索接回界面（后端 / store 都在，`NotesView` 现在只按标题筛）
- [x] 双链 `[[…]]` 编辑器内表现 + Mod 点击跳转（反向链接面板还没有）
- [x] callout `> [!标签]` 的编辑器内表现
- [x] 代码块语法高亮 + 复制按钮
- [x] 表格 widget 单元格走行内渲染
- [x] 下标 / 上标 / Emoji 短码 / 实体 / 硬换行 / 转义 / `==高亮==` / 脚注 / `[TOC]` / front matter / 嵌套引用 / 图片 title 与尺寸 / Mod 点击打开外链
- [x] 行内 / 块级 HTML（白名单净化，不走 innerHTML）、`<br>` 多行单元格、callout 标题与 `[!x]-` 折叠、有序列表自动编号、单 `~` 删除线（下标改 `<sub>`）、`[[笔记#小节]]`、脚注悬停与跳转、KaTeX 公式、mermaid 图表、```csv 表格、定义列表、缩写、智能标点、本机图片 asset 协议 + CSP 放行网络图片（见技术方案 §11.4）
- [x] 编辑区动效：标记淡入、替身淡入、勾选描边、复制反馈、标题层级提示（见技术方案 §11.4.1）
- [x] 长文档刚打开时 `[TOC]` 只列前几节、后面的表格公式是源码（块级层只看到前 3000 字符的语法树）；表格分隔行 `:--:` 被拒；脚注徽章压住上一行；块级公式挂竖滑块；缩写常驻点线
- [x] 表格 / CSV 重做成圆角卡片 + 数字列右对齐，CSV 加标签栏；自绘光标（`smoothCaret.ts`：滑动、柔和闪烁）；脚注 / 缩写改用悬停卡片（`hoverCard.ts`）
- [x] 表格 / CSV 格子里直接编辑（`tableWidget.ts`：露出单格源码、逐字写回、Tab / Enter / 方向键导航、插入 / 删除行）
- [x] Ctrl+F 边打边跳到第一个匹配，跳过去后把匹配项钉在屏幕上；块级替身报估计高度并记住真实高度（远处跳转不再整页下沉）
- [x] 表格加列 / 删列 / 改对齐（工具栏；GFM 插删列时整表按显示宽度重新排版）；换格时工具栏不再闪
- [x] 查找、目录树、[TOC]、脚注的跳转改成平滑滑过去（`glide.ts`）
- [x] 切换笔记不再「闪一下」：以前正文硬切、标题先消失再弹上来、分隔线缩回再展开、目录逐条错峰，各块到场时间不一；现在 `SwapFade` 整块交叉淡化（见技术方案 §10.3）
- [x] 长标题折行：正文大标题从 `input` 换成随内容长高的 `textarea`（`field-sizing: content`，不支持的内核 JS 量高），笔记 / 归档列表的标题最多两行
- [x] 按文档缓存编辑器状态：切回来不再解析全文，撤销历史也在。生产包里 66KB 的「语法全览」切回来 160–220ms → 约 58ms（第一次打开仍约 124ms，见技术方案 §11.6）
- [x] **文件是真相**：每篇文档是仓库文件夹（默认「文档/OnTheWay」）里的一个 .md，SQLite 只做可重建的索引；旧库第一次启动时自动搬进来（旧库原样留着）；文件监听 + 冲突副本；日历当日安排改成来自正文里带日期的 `- [ ]`；行菜单 / 状态栏 / 命令面板「在文件夹中显示」；命令面板可以更换笔记文件夹（见技术方案 §5）
- [ ] 反向链接面板；改标题时顺手改别处的 `[[旧标题]]`
- [ ] 识别网盘生成的冲突副本（「xxx (1).md」），目前当普通笔记
- [ ] 附件：粘贴 / 拖进图片时存进「附件/」并写相对路径
- [ ] 暗色模式全量走查（五个视图 × 各种选中态；已过笔记页）
- [ ] 独立的设置界面（目前偏好只能从命令面板改；`db_stats` 命令等着有地方展示）
- [ ] 空状态插画
- [ ] 性能回归脚本
- [ ] 打包与签名、自动更新
- [x] 清理旧代码：没用的依赖（`@dnd-kit/*`、`fractional-indexing`、`marked`、Radix dialog / popover / tooltip，Rust 的 `r2d2`、`rrule`、`chrono-tz`）；旧数据模型留下的字段（笔记的 `icon`、恒为空的 `actionGroup`、任务的 `priority` / `goalId` / `sortKey` / `completedAt`）、没人调的 `note_list`、用不上的 `NoteIcon` 组件；日历当日安排从 `ActionGroup` 简化成 `DayTasks`

---

## 决策记录

- **文件是真相，SQLite 只是索引**（2026-09-27）：v2.0 的 SQLite 为真相让「一切皆文档」只在界面上成立 —— 数据锁在库里，没法在文件夹里找到一篇笔记、没法用别的编辑器打开、没法放进网盘。现在每篇文档是仓库里的一个 .md；索引存在应用数据目录（不在仓库里：网盘来回拷一个正在写的 SQLite 迟早出冲突），表结构改了升版本号、清空重建，不写迁移。event / review / key_result / tag 这些建了没用的表连同 rrule 一起删掉了（git 历史里有）。
- **任务只有 Markdown 一个来源**：日历「当日安排」来自任何文档里带日期的 `- [ ] … @2026-09-30`，勾选改原文件那一行。独立的 task 表没了。
- **外部改动不静默覆盖**：保存前发现磁盘比索引新、或者外部改动撞上编辑器里没存的修改，都先把磁盘那一版另存成「(冲突 时间)」副本。
- **数据层抽象**：`data/backend.ts`（`Backend` 接口，Tauri IPC / 浏览器 mock 二选一）→ `data/store.ts`（缓存 + 乐观更新）→ `data/adapter.ts`（映射成 `DocumentModel`）。视图只认 adapter 的产物。
- **不用 TanStack Query / Router**：没有路由（五个工作区共用一个视图），乐观更新和失效范围都很小，直接写在 Zustand 里更直白。
- **编辑器换成 CodeMirror 6**：Milkdown 的 AST 互转在真机上表现为输入跳行、内容漂移。CodeMirror 文档就是源文，装饰层只负责「看起来像渲染过」。
- **没有「只读预览模式」**：`renderMarkdown` 只在数据还没到 / 空状态时当占位。技术方案 v1 里「大文档降级为只读」没有做，CodeMirror 按视口渲染，1800 行文档挂载 5ms，不需要。
- **行动项就是 Markdown 的 `- [ ]`**：原来的独立 task 实体 + link 表方案让文档有两个编辑面，已迁回正文。`task` 表现在只服务日历「当日安排」（按 `due_date`）。
- **今日TODO = 今天的 `day_doc`**，未写过时延续最近一天。原来是一篇藏起来的特殊笔记，和日历里的今天是两份数据。
- **GOAL 一个周期一篇**，键是 `(horizon, period_start)`，由前端算周期起点、后端校验。「本周目标」是今天所在那一周，不是最新一条。
- **笔记列表只按标题筛**：全文匹配的结果和标题栏对不上，异步回填还会闪一次。全文搜索留给专门的入口。
- **自动保存不重排列表**：每 400ms 刷新 `updatedAt`，按它排序会让正在编辑的笔记当着用户的面往上跳。「按更新时间」排序直接用 store 的顺序，不在 `NotesView` 里再按 `updatedAt` 排。
- **删除 = 挪进回收站 + 6 秒撤销**：不弹确认框（多数删除是有意的），删完底部给「撤销」，走 `note_undelete` 从 `.ontheway/trash/` 挪回原来的位置。回收站 30 天后清掉，没有回收站界面。
- **保存失败的正文留作草稿**：`drafts` 按 `saveKeyOf` 的键存，切走再切回来还在（adapter 优先用它），下一次保存成功就清掉，关窗时编辑器 flush 之后再试一次（`flushDrafts`）。状态栏只显示这一篇自己的保存失败。
- **其它操作失败走 ErrorToast**：置顶 / 归档 / 恢复 / 删除 / 勾选 / 新建 / 加载失败写进 `error`，底部提示条显示；启动加载失败时常驻并带「重试」。保存失败不走这里。
- **同一篇文档的写入排队**（store 里的 `serialized`）：标题和正文两条路保存、各自写整篇，并发时后到的会把另一半覆盖回旧值。
- **迁移期间关外键**：`migrate::run` 事务外关、每次迁移后 `foreign_key_check` 只拦新增的悬空引用，结束再恢复。重建表时开着外键，DROP TABLE 会级联删掉引用它的行。
- **启动一次取全文**：`note_list_full` 每个列表一次往返，不再「摘要列表 + 逐篇 `note_get`」。
- **摘要 / 字数的算法改了要升索引的 `VERSION`**（`vault/index.rs`）：索引整个重建，摘要字数跟着重算。
- **Logo 改成手写 SVG**：九段笔画按书写顺序 `stroke-dashoffset` 描出再收回，`pathLength="1"` 归一化、`currentColor` 跟主题走。原来的 `Brand.png` 是 53760×11528 的巨图，缩到 22px 发糊，已删。减少动效时停在「写完」态。
- **目录树首项固定为「概览」**，五个视图统一；callout 标签进目录树。
- **日历不用 FullCalendar**，自己用 CSS Grid 画；每周自成一个 grid 行，整行高亮用 `inset-0`。
- **`calendarMarked` 一次取 2000–2100**：一个 `Set<string>` 而已，比按月分页省事。
- **扩展页只做目录和导入**，`ExtensionCatalogProvider` 接口留给以后的审核服务；不承诺运行时。

## 坑记录

**工程**

- `pnpm 10` 拦 postinstall，esbuild 不放行则 vite 起不来。
- `pnpm tauri dev` 会占 1420 端口，和已经在跑的 `pnpm dev` 冲突，先停一个。
- Python 脚本在 Windows 上写文件会把换行转成 CRLF，Biome 会报格式错。批量改文件后跑一次 LF 归一化。
- `cargo test --no-default-features` 会因 `main.rs` 的 `run()` 被 feature 门控而失败，加 `--lib`。
- tauri-specta 三个 crate 的 RC 版本互不兼容，`=` 锁死，不要跟着 `cargo update` 走。
- 无事件时 tauri-specta 生成的辅助代码触发 `noUnusedLocals`，生成文件头加了 `// @ts-nocheck`，biome 也忽略它。

**主题 / 布局**

- Tailwind v4 的 `dark:` 变体需要 `<html>` 上有明确的 `data-theme`，不能只靠 `prefers-color-scheme` —— `index.html` 里有段内联脚本在首帧前落属性。
- 标题栏的 `data-tauri-drag-region` 铺满顶部 38px，这一条内会吞掉滚轮事件。各视图内容都从 42px 以下开始。
- `win_start_dragging` 必须在 mousedown 的同一调用栈里发起 IPC，不能等动态 import。
- Browser 预览面板的截图会滞后于动画，判断渲染问题要用 DOM 测量而不是看截图。

**动效**

- motion 自带的 `useReducedMotion()`：`MotionConfig` 只要设过一次 `reducedMotion="always"`，它之后就一直返回 true 直到刷新。要判断系统偏好用 `lib/motion.ts::usePrefersReducedMotion()`。
- 列表栏不能动画化 `marginLeft`：布局属性，动画期间 flex 行每帧重排，开了 lineWrapping 的 CodeMirror 逐帧折行，头几帧稳定 28ms 一帧。改成挂载即入流、只动 `x`；主内容用 `popLayout` + `anchorX="right"` 把退场屏冻结在原位交叉淡出。
- 中文文字的 `font-weight` 不能做 CSS 过渡：每一帧都是一个新的小数字重，回退字体（YaHei 没有可变轴）每次都要重新匹配，实测一个标签一帧 11ms、拉丁文只要 0.5ms。导航切换时新旧两个标签一起变，就是 22ms 一帧持续 140ms。
- 工作区进场不能带 transform：编辑器不能挂在正在平移的祖先里，否则得先渲染占位再换编辑器，两者排版不同（正文 15px vs 17px/1.82），一换整篇重排。
- `React.lazy + Suspense` 即便 promise 已 resolve，首次渲染也必然先 suspend 一次把 fallback 提交上屏。编辑器组件自己持有解析后的引用，bootstrap 里 await 预载。

**CodeMirror**

- 块级 widget 的留白只能用 padding，**不能用 margin**：CodeMirror 用 `getBoundingClientRect` 量 widget 高度，margin 不在边框盒里，高度图比真实布局短，点击会定位到错误的行。`widgetSpacing.test.ts` 用正则守着。
- 行内 `<img>` widget 同理：块级子元素的上下 margin 会穿透 `.cm-line` 折叠出去。
- 改变行结构的装饰（折叠整行、块级 widget）必须来自 `StateField`，视口是在 ViewPlugin 更新之前算出来的。
- 空围栏（只有开闭两行）不能折叠，折叠后再也点不进去。
- Setext 下划线只藏 `===` 三个字符会留一条空行，得整行折叠；分隔线同理。
- `<u>` 的源码级配对以前是全文 `indexOf`，两个不相干段落里的 `<u>` 和 `</u>` 会配成一对；现在要求不跨空行。
- 中文正文在 WebView2 里会被拼写检查画满红波浪线，`spellcheck="false"`。
- `scrollHeight` 在滚动过程中会变（未渲染的行只有估算高度，滚过去才回填真实值；400 段文档从 17846 涨到 22286）。自绘滚动条的滑块要指数缓动跟随，不能每帧离散校正。
- 外部回填（store → 编辑器）要用 annotation 标记，否则会被当成用户输入触发一次保存。
- CommonMark 把任何没有定义的 `[文字]` 都解析成 `Link` 节点（短引用形式），`[!NOTE]`、`[TOC]`、`[^1]`、`[[双链]]` 里那层都是它。装饰层必须按内容分流，不能见 Link 就藏括号。
- `HardBreak` 节点的末尾是换行符本身；行内 replace 装饰跨过换行会把两行拼成一行，替换范围必须停在 `to - 1`。
- `LinkReference` 这类顶层节点的父节点是 `Document`，按「父节点是否被光标碰到」判断激活永远为真，只能看节点自己。
- front matter 的 `---` 会被 CommonMark 解析成分隔线 + Setext 标题，两层装饰和目录收集都要先用 `frontMatterRange` 绕开；光标停在 0（新挂载的编辑器）不算点进了属性块，否则每篇一打开就是展开的 YAML。
- 预览面板里 `navigator.clipboard.writeText` 会因权限被拒（真机不会），复制按钮要有 execCommand 退路并吞掉 rejection。
- 用 `::before` 做行首提示（标题的 H2）要给 `width: max-content; white-space: nowrap`，否则 `right: 100%` 的绝对定位伪元素会被压成一列字。

**数据**

- 某天 / 某周期的文档是异步加载的，编辑器往往先以空文档挂载。`saveDocument` 在 `source` 还没回来时**必须直接返回**，否则用户一输入就把原有内容整篇覆盖。adapter 在数据没到时干脆不给 `editor`。
- `foreign_keys` 是连接级 PRAGMA，只在建库时设一次没用（旧库的事，搬家只读拷贝，不用管）。
- 文件改名 / 挪位置后按新路径写入前，索引里得先改路径**并清掉指纹**：标题来自文件名、归档与否来自位置，内容一模一样也得重新解析；不改路径的话旧路径那一行占着同一个 id，新文件会被当成一篇重复的笔记。
- 应用自己写的文件会触发文件监听：靠「写完立刻把修改时间、大小、指纹记进索引」识别，扫描时对得上就不算外部改动、不发通知。
- 外部程序用 CRLF 存过的文件：读进来统一成 `\n`，否则编辑器一打开就当成改过了。
- 编辑器分辨不了「store 里的正文变了」是外部改动还是自己的保存回来了（边打字边保存时两者都是 `当前 ≠ 已同步`）：store 只在外部改动真的改了正文时给 `externalRevisions` 加一，编辑器看这个数有没有变。
- `saveBus` 引用了数据 store，store 要 flush 编辑器时只能动态 `import("@/editor/saveBus")`，静态引入会成环。
- 这台机器的 Git 开了 `core.autocrlf`，工作区里的文件是 CRLF，Biome 按 LF 检查会报格式错；改过的文件存成 LF 即可（提交时本来就是 LF）。
- FTS5 的 `snippet()` / `highlight()` 作用在分词串上，中文会显示成「今天 开会 讨论」；高亮在前端用 `tokens` 做。
- jieba 会把标点单独切出来，进了 FTS5 查询就是 `""""*`，要先过滤掉不含字母数字汉字的 token。
- 延续来的「今天」不落库；跨过零点后缓存里的延续文档要丢掉，否则翻回昨天会把它当成昨天写的。
