# OnTheWay 开发进度

> 每次开工先看这里，收工更新这里。
> 技术基准见 [技术方案.md](./技术方案.md)。

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

pnpm 10 默认拦截 postinstall，`pnpm-workspace.yaml` 里已放行 `esbuild` 和 `@biomejs/biome`。

**常用命令**

```bash
pnpm dev
```

```bash
pnpm tauri dev
```

```bash
npx tsc --noEmit
```

---

## 设计基准（从 Prototype/ 提炼）

**核心抽象：一切皆文档。** 笔记、今日TODO、GOAL、日历的某一天、归档项 —— 全部是同一种结构：

```
（可选横幅）大标题 +（可选分段控件）
正文 Markdown → 行动项分组 → 行动项之后的正文
右侧目录树 + 底部状态栏
```

四个模块不是四套 UI，是同一个 `DocumentView` 的不同数据源。新增内容类型 = 在
`data/adapter.ts` 里多映射一个 `DocumentModel`，**不写新视图组件**。守住这条。

**布局**

| 区域 | 宽度 | 出现条件 |
|---|---|---|
| 左导航 | 240px | 常驻 |
| 中列表栏 | 300px | 笔记 / 日历 / 归档；今日TODO 和 GOAL 是两栏 |
| 主内容 | flex-1，内容 max-w 860px | 常驻 |
| 右目录树 | 180px | ≥1280px 显示（`xl:`） |
| 提醒卡片 | 浮动右下 | 常驻 |

**色板**（亮色取样自原型图，1:1）

| token | 亮色 | 用途 |
|---|---|---|
| `ink` | `#1A1A18` | 标题、最强文字 |
| `body` | `#353532` | 正文 |
| `muted` / `faint` | `#74746E` / `#A3A39B` | 次级 / 最弱 |
| `canvas` / `panel` / `rail` | `#FFFFFF` / `#FAFAF8` / `#F1F1ED` | 主内容 / 列表栏 / 导航栏 |
| `line` / `line-strong` | `#F1F1EE` / `#E7E7E1` | 分隔线 |
| `accent` | `#2F63D8` | 主色 |
| `accent-wash` | `#F1F4FA` | 选中卡片底 |

暗色是手工配平版本，保持同样的暖中性调性。

---

## 阶段划分

- [x] **P0 环境与规划**
- [x] **P1 前端骨架与设计系统**
- [x] **P2 应用外壳与导航动效**
- [x] **P3 五个视图**
- [x] **P4 Tauri 外壳接入**
- [ ] **P5 Rust + SQLite 后端** ← 下一步
- [ ] **P6 Milkdown 编辑器**
- [ ] **P7 打磨与性能**

---

## 已完成

### P1 骨架与设计系统 ✅

- `styles/globals.css`：色板 token、亮暗双主题、`prose-doc` 排版、细滚动条、View Transition
- `lib/motion.ts`：spring/tween 预设、stagger、layoutId 命名空间
- `lib/date.ts`：全局唯一时间入口，ISO 日期字符串、月网格、ISO 周数、中文格式化
- `lib/markdown.tsx`：自研解析渲染（无 `dangerouslySetInnerHTML`），支持 `> [!标签]` callout
- `lib/cn.ts`、`lib/tauri.ts`
- `data/types.ts` / `seed.ts` / `store.ts` / `adapter.ts`

### P2 外壳与动效 ✅

| 位置 | 动效 |
|---|---|
| Logo | clip-path 从左到右擦除，模拟手写 |
| 导航活动项 | `layoutId` 指示块滑动 |
| 导航项入场 | stagger 40ms |
| 中列表栏出现/消失 | `marginLeft` + `x`，不动 width |
| 主内容切换 | 方向感知横移 + 淡入 |
| 标题切换 | `AnimatePresence popLayout` 上下滚动替换 |
| 标题下分隔线 | `scaleX` 从 0 展开 |
| 目录树活动条 | `layoutId` 滑动，IntersectionObserver 联动 |
| 提醒卡片 | 延迟 620ms 弹入 + 铃铛摇一下 |
| 主题切换按钮 | 图标旋转交叉淡入 |
| 命令面板 | 静态 backdrop-blur + 只动 opacity/scale |

### P3 五个视图 ✅

- **笔记**：搜索、三种排序、置顶分组、选中高亮 `layoutId` 滑动
- **今日TODO**：两栏、检查项 `1 / 3` 计数
- **/GOAL**：周月年分段、`本周重点 4 项`、行动项后接「记录」段
- **日历**：6×7 固定月网格、ISO 周数、选中周整行高亮、方向感知切月、当日安排+备注
- **归档**：归档横幅、分类·日期、悬停旋转的恢复按钮
- **命令面板**：⌘K，跳转/笔记/外观三组，方向键+回车

### 行动项勾选动画（重点打磨）

三层同时发生，总时长约 380ms：
1. 对勾 SVG `pathLength` 0→1 描边画出
2. 圆环脉冲扩散淡出
3. 文字色过渡到 `faint`、轻微右移 1.5px

---

### P4 Tauri 外壳 ✅

- `src-tauri/` 脚手架、`tauri.conf.json`、`Cargo.toml`、`build.rs`、`lib.rs`
- 应用图标：蓝底 + 一条「在路上」的弧线，`app-icon.png` → 全套尺寸（含 ico/icns）
- 无边框窗口 + 自定义标题栏 `TitleBar.tsx`
  - 平时按钮 opacity 0.28，悬停标题栏才浮现；双击切换最大化
- `visible: false` + 首帧双 rAF 后调 `ready()` 才 show()，消除开局白闪
- 单实例（二次启动拉回已有窗口）、窗口状态记忆
- **实机验证**：客户区 1440×900、TopInset 1px（无边框生效）、窗口可见

补做的部分：

- 笔记行操作菜单 `RowMenu.tsx`（置顶 / 归档 / 删除，Radix + Motion 接管动画）
- 命令面板补 `主题跟随系统` 和 `减少动画效果`
- 双链 `[[...]]` 的视觉样式
- 持久化改为整份快照（原来跟种子数据 diff 的写法在「归档」操作上会算错）
- 列表栏切换动效修正：`笔记 → 日历` 不再整条收起再展开，只换内容
- lint / typecheck 全绿

## P5 Rust + SQLite（下一步）

- [ ] `0001_init.sql`（表结构见技术方案 §5.3）
- [ ] 连接池 + PRAGMA（WAL / foreign_keys 每连接都要设）
- [ ] `domain/` 各模块 + 单测（rrule、时区、迁移链路三块必须有）
- [ ] jieba 分词 + FTS5（**不要用 trigram**，中文双字词搜不到）
- [ ] tauri-specta 生成 `src/lib/bindings.ts`
- [ ] `data/adapter.ts` 和 `data/store.ts` 切到真实 IPC

## P6 Milkdown

- [ ] Crepe 集成
- [ ] **中文 IME composition 门控**（组合期间禁止上层更新，否则吞字）
- [ ] 编辑器容器「稳定岛」：祖先不得跑 layout 动画
- [ ] 防抖 400ms + 切换/关窗/失焦强制 flush
- [ ] 双链 `[[]]` 插件（`lib/markdown.tsx` 里已预留 `.otw-wikilink`）

## P7 打磨

- [ ] 暗色模式全量走查（五个视图 × 各种选中态；已过笔记页）
- [ ] 独立的设置界面（目前偏好只能从命令面板改）
- [ ] 空状态插画
- [ ] 性能回归脚本
- [ ] 打包与签名

---

## 决策记录

- **数据层抽象**：`data/store.ts`（内存态 + localStorage）+ `data/adapter.ts`（映射成
  `DocumentModel`）。P5 只替换 store 的实现，adapter 和所有视图零改动。
- **Logo**：直接用 `Prototype/Brand.png`（210×45），暗色 `brightness-0 invert`。
- **行动项**不是 markdown 的 `- [ ]`，是独立 task 实体嵌在文档里（有负责人、时间、
  截止日）。数据模型上是 task 表 + link 表。
- **侧栏 badge = 总数**（原型是 3，而检查项 1/3，说明计的是总数不是剩余）。
  想改成剩余数：`data/store.ts` 的 `useTodoCount`。
- **目录树首项固定为「概览」**。原型在笔记页是「概览」、GOAL 页是标题，不一致；
  取固定锚点，五个视图统一。
- **callout 标签进目录树**：原型的「核心判断」「当时的结论」就是 callout，
  它们是文档骨架的一部分。
- **日历不用 FullCalendar**，自己用 CSS Grid 画：太重、样式难改、动画无法接管。
- **每周自成一个 grid 行**，这样整行高亮能用 `inset-0`，而不是靠负值外扩猜宽度。

## 坑记录

- `pnpm 10` 拦 postinstall，esbuild 不放行则 vite 起不来。
- Tailwind v4 的 `dark:` 变体需要 `<html>` 上有明确的 `data-theme`，
  不能只靠 `prefers-color-scheme` —— 所以 `index.html` 里有段内联脚本在首帧前落属性。
- Browser 预览面板的截图会滞后于动画，判断渲染问题要用 DOM 测量而不是看截图。
- `pnpm tauri dev` 会占 1420 端口，和已经在跑的 `pnpm dev` 冲突，先停一个。
- Python 脚本在 Windows 上写文件会把换行转成 CRLF，Biome 会报格式错。
  批量改文件后跑一次 LF 归一化。
- 标题栏的 `data-tauri-drag-region` 铺满顶部 38px，这一条内会吞掉滚轮事件。
  各视图内容都从 42px 以下开始，目前无影响；将来若有元素上移要重新评估。
