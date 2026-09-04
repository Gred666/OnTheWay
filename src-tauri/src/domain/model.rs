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
    pub icon: String,
    pub word_count: i64,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub archive_category: Option<String>,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    /// 挂在这篇笔记下的行动项分组（通过 link 表关联）
    pub action_group: Option<ActionGroup>,
}

/// 列表用的轻量结构：不含 content_md。
/// 一个 300px 宽的列表没必要把每篇全文都传过来。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub icon: String,
    pub is_pinned: bool,
    pub archive_category: Option<String>,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActionGroup {
    pub title: String,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    /// todo | doing | done | cancelled
    pub status: String,
    pub meta: Option<String>,
    pub priority: i64,
    pub due_date: Option<String>,
    pub time_label: Option<String>,
    pub category: Option<String>,
    pub goal_id: Option<String>,
    pub sort_key: String,
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    /// week | month | year
    pub horizon: String,
    pub title: String,
    pub period_start: String,
    pub content_md: String,
    pub action_group: Option<ActionGroup>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DayDoc {
    pub date: String,
    pub tasks: Vec<Task>,
    pub note_md: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub icon: String,
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
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DbStats {
    pub notes: i64,
    pub archived: i64,
    pub tasks: i64,
    pub goals: i64,
    pub activities: i64,
    pub db_bytes: i64,
    pub db_path: String,
}
