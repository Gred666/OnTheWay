use serde::{Deserialize, Serialize};

/* ============================================================
跨 IPC 的领域类型。
全部 camelCase —— 和前端 src/data/types.ts 一一对应，
由 tauri-specta 生成 TS 定义，不需要手写两遍。
============================================================ */

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content_md: String,
    pub excerpt: String,
    pub word_count: i64,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub archive_category: Option<String>,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    /// 在仓库里的相对路径（正斜杠）。正文里的相对图片路径以它所在的文件夹为基准
    pub rel_path: String,
    /// 这篇是另一篇的冲突副本（网盘同步撞车、或本应用另存的）：原文的 id
    pub conflict_of: Option<String>,
}

/// 日历「当日安排」里的一条：某篇文档正文里带日期的 `- [ ]`（见 vault/tasks.rs）
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    /// 所在文档的 id # 行号。只在勾选的那一下用，文档改过之后就不作数了
    pub id: String,
    pub title: String,
    /// todo | done
    pub status: String,
    /// 灰色小字：分类 · 时间 · 出处
    pub meta: Option<String>,
    pub due_date: Option<String>,
    pub time_label: Option<String>,
    pub category: Option<String>,
}

/// 某个周期（某一周 / 某个月 / 某一年）的目标。
/// 一个周期一篇；还没写过的周期返回空文档（id 为空、updated_at 为 0），
/// 第一次保存时才落库。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    /// 还没落库时为空串
    pub id: String,
    /// week | month | year
    pub horizon: String,
    pub title: String,
    /// 周期起点：周一 / 1 号 / 1 月 1 日
    pub period_start: String,
    pub content_md: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// 在仓库里的相对路径；还没写过的周期是它将来的位置
    pub rel_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DayDoc {
    pub date: String,
    pub title: String,
    pub tasks: Vec<Task>,
    pub note_md: String,
    pub updated_at: i64,
    /// 这一天还没写过、内容是从之前最近一天延续来的：那一天的日期。
    /// 只有请求「今天」时才会延续；用户一编辑，就以这一天自己的身份落库。
    pub carried_from: Option<String>,
    /// 在仓库里的相对路径；还没写过的日子是它将来的位置
    pub rel_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub is_archived: bool,
    pub updated_at: i64,
    /// bm25 分数，越小越相关
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// 前端拿它在原始正文上做高亮（不能用 SQLite 的 snippet，见 search.rs）
    pub tokens: Vec<String>,
}

/// 新建 / 更新笔记的入参。
/// id 为 None 表示新建。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub id: Option<String>,
    pub title: String,
    pub content_md: String,
}

/// 指向一篇文档：和前端的 DocumentSaveTarget 同形
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DocTarget {
    Note {
        id: String,
    },
    /// id 是日期 YYYY-MM-DD
    Day {
        id: String,
    },
    Goal {
        horizon: String,
        #[serde(rename = "periodStart")]
        period_start: String,
    },
}

/// 仓库里别处发生的变化：文件被外部程序改了，或者一次操作连带改了别的文档
/// （在日历里勾任务，改的是任务所在的那篇）。前端据此刷新缓存。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultChange {
    /// 变了（或没了）的笔记 id
    pub notes: Vec<String>,
    /// 变了的某一天（YYYY-MM-DD）
    pub days: Vec<String>,
    /// 变了的目标，`week:2026-09-21`，和前端 goalKey 一样
    pub goals: Vec<String>,
    /// 带日期的任务有变化：日历的当日安排和小圆点要刷新
    pub tasks: bool,
    /// 这次产生的冲突副本的标题（编辑器里有没存的修改时外部改动到了，另存的那一份）
    pub conflicts: Vec<String>,
    /// 新出现的冲突副本（网盘同步时两边都改过，网盘另存的那一份）的标题
    pub found_copies: Vec<String>,
}

/// 反向链接：一篇正文里写了 `[[这篇的标题]]` 的文档
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    /// 链过来的那篇，点一下跳过去
    pub target: DocTarget,
    /// note | day | goal
    pub kind: String,
    /// 给人看的标题：笔记标题、「9月26日」、「第 39 周目标」
    pub title: String,
    pub archived: bool,
    pub updated_at: i64,
    /// 写着链接的那几行（最多 3 行）
    pub lines: Vec<BacklinkLine>,
    /// 这篇里一共链了几次
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkLine {
    /// 正文里的行号（从 0 开始）
    pub line: i64,
    /// 去掉列表符号之类、截过长度的那一行，双链原样保留（前端再画成小块）
    pub text: String,
}

/// 存进「附件」文件夹的一个文件
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    /// 从文档引用它的相对路径，直接写进 `![](…)`
    pub link: String,
    /// 文件名
    pub name: String,
    pub is_image: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    /// 仓库文件夹的绝对路径
    pub root: String,
    pub notes: i64,
    pub archived: i64,
    pub days: i64,
    pub goals: i64,
    pub tasks: i64,
}
