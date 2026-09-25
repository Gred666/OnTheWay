use tauri::State;

use crate::domain::model::*;
use crate::domain::{goal, note, validate_date};
use crate::error::{AppError, Result};
use crate::state::AppState;

/* ============================================================
命令层：只做参数校验和调用，业务逻辑全在 domain/。

每个命令都用 spawn_blocking 把 SQLite 调用挪出 async 线程 ——
rusqlite 是同步阻塞的，直接在 tokio 的 worker 上跑会拖住整个运行时。
============================================================ */

/// 拿一条连接、在阻塞线程池里执行、把结果送回
async fn with_db<T, F>(state: &AppState, f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&rusqlite::Connection) -> Result<T> + Send + 'static,
{
    let pool = state.pool.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = pool.get()?;
        f(&conn)
    })
    .await
    .map_err(|e| AppError::Internal(format!("任务panic: {e}")))?
}

/* ---------------- 笔记 ---------------- */

#[tauri::command]
#[specta::specta]
pub async fn note_list(state: State<'_, AppState>, archived: bool) -> Result<Vec<NoteSummary>> {
    with_db(&state, move |c| note::list(c, archived)).await
}

// 启动时一次取回整个列表的全文，替代「摘要列表 + 逐篇 note_get」
#[tauri::command]
#[specta::specta]
pub async fn note_list_full(state: State<'_, AppState>, archived: bool) -> Result<Vec<Note>> {
    with_db(&state, move |c| note::list_full(c, archived)).await
}

#[tauri::command]
#[specta::specta]
pub async fn note_get(state: State<'_, AppState>, id: String) -> Result<Note> {
    with_db(&state, move |c| note::get(c, &id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn note_upsert(state: State<'_, AppState>, input: NoteInput) -> Result<String> {
    if input.title.trim().is_empty() && input.content_md.trim().is_empty() {
        return Err(AppError::Invalid("标题和正文不能同时为空".into()));
    }
    with_db(&state, move |c| note::upsert(c, input)).await
}

#[tauri::command]
#[specta::specta]
pub async fn note_set_pinned(state: State<'_, AppState>, id: String, pinned: bool) -> Result<()> {
    with_db(&state, move |c| note::set_pinned(c, &id, pinned)).await
}

#[tauri::command]
#[specta::specta]
pub async fn note_archive(
    state: State<'_, AppState>,
    id: String,
    category: Option<String>,
) -> Result<()> {
    with_db(&state, move |c| note::archive(c, &id, category)).await
}

#[tauri::command]
#[specta::specta]
pub async fn note_restore(state: State<'_, AppState>, id: String) -> Result<()> {
    with_db(&state, move |c| note::restore(c, &id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn note_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    with_db(&state, move |c| note::delete(c, &id)).await
}

// 删除后的「撤销」
#[tauri::command]
#[specta::specta]
pub async fn note_undelete(state: State<'_, AppState>, id: String) -> Result<()> {
    with_db(&state, move |c| note::undelete(c, &id)).await
}

/* ---------------- 搜索 ---------------- */

#[tauri::command]
#[specta::specta]
pub async fn search_notes(
    state: State<'_, AppState>,
    query: String,
    limit: u32,
) -> Result<SearchResult> {
    let limit = limit.clamp(1, 200);
    with_db(&state, move |c| note::search_notes(c, &query, limit)).await
}

/* ---------------- 任务 ---------------- */

#[tauri::command]
#[specta::specta]
pub async fn task_toggle(state: State<'_, AppState>, id: String) -> Result<Task> {
    with_db(&state, move |c| crate::domain::task::toggle(c, &id)).await
}

/* ---------------- 目标 ---------------- */

/// 某个周期的目标。period_start 由前端按 horizon 算好（周一 / 1 号 / 1 月 1 日），
/// domain 层会校验它确实是周期起点。没写过的周期返回空文档。
#[tauri::command]
#[specta::specta]
pub async fn goal_get(
    state: State<'_, AppState>,
    horizon: String,
    period_start: String,
) -> Result<Goal> {
    validate_date(&period_start)?;
    with_db(&state, move |c| {
        goal::get_for_period(c, &horizon, &period_start)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn goal_save(
    state: State<'_, AppState>,
    horizon: String,
    period_start: String,
    content_md: String,
) -> Result<Goal> {
    validate_date(&period_start)?;
    with_db(&state, move |c| {
        goal::save_for_period(c, &horizon, &period_start, &content_md)
    })
    .await
}

/* ---------------- 日历 ---------------- */

/// `carry_over` 只在请求「今天」时传 true：今天还没写过就延续之前最近的一天。
#[tauri::command]
#[specta::specta]
pub async fn calendar_day(
    state: State<'_, AppState>,
    date: String,
    carry_over: bool,
) -> Result<DayDoc> {
    validate_date(&date)?;
    with_db(&state, move |c| goal::day_doc(c, &date, carry_over)).await
}

#[tauri::command]
#[specta::specta]
pub async fn calendar_day_save(
    state: State<'_, AppState>,
    date: String,
    title: String,
    note_md: String,
) -> Result<DayDoc> {
    validate_date(&date)?;
    with_db(&state, move |c| {
        goal::save_day_doc(c, &date, &title, &note_md)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn calendar_marked(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> Result<Vec<String>> {
    validate_date(&from)?;
    validate_date(&to)?;
    with_db(&state, move |c| goal::marked_dates(c, &from, &to)).await
}

/* ---------------- 系统 ---------------- */

#[tauri::command]
#[specta::specta]
pub async fn db_stats(state: State<'_, AppState>) -> Result<DbStats> {
    let path = state.db_path.clone();
    let bytes = std::fs::metadata(&path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);
    let path_str = path.to_string_lossy().to_string();

    with_db(&state, move |c| {
        let one = |sql: &str| -> Result<i64> { Ok(c.query_row(sql, [], |r| r.get(0))?) };
        Ok(DbStats {
            notes: one("SELECT count(*) FROM note WHERE deleted_at IS NULL AND is_archived=0")?,
            archived: one("SELECT count(*) FROM note WHERE deleted_at IS NULL AND is_archived=1")?,
            tasks: one("SELECT count(*) FROM task WHERE deleted_at IS NULL")?,
            goals: one("SELECT count(*) FROM goal WHERE deleted_at IS NULL")?,
            activities: one("SELECT count(*) FROM activity")?,
            db_bytes: bytes,
            db_path: path_str,
        })
    })
    .await
}
