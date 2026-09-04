use tauri::State;

use crate::domain::model::*;
use crate::domain::{goal, note};
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

#[tauri::command]
#[specta::specta]
pub async fn goal_latest(state: State<'_, AppState>, horizon: String) -> Result<Goal> {
    if !matches!(horizon.as_str(), "week" | "month" | "year") {
        return Err(AppError::Invalid(format!("未知的时间尺度: {horizon}")));
    }
    with_db(&state, move |c| goal::latest(c, &horizon)).await
}

#[tauri::command]
#[specta::specta]
pub async fn goal_save(state: State<'_, AppState>, id: String, content_md: String) -> Result<Goal> {
    with_db(&state, move |c| goal::save(c, &id, &content_md)).await
}

/* ---------------- 日历 ---------------- */

#[tauri::command]
#[specta::specta]
pub async fn calendar_day(state: State<'_, AppState>, date: String) -> Result<DayDoc> {
    validate_date(&date)?;
    with_db(&state, move |c| goal::day_doc(c, &date)).await
}

#[tauri::command]
#[specta::specta]
pub async fn calendar_day_save(
    state: State<'_, AppState>,
    date: String,
    note_md: String,
) -> Result<DayDoc> {
    validate_date(&date)?;
    with_db(&state, move |c| goal::save_day_doc(c, &date, &note_md)).await
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

/// 'YYYY-MM-DD'。日期直接拼进 SQL 比较的地方虽然都用了参数绑定，
/// 但格式错的日期会静默返回空结果，不如早点报错。
fn validate_date(s: &str) -> Result<()> {
    let ok = s.len() == 10
        && s.as_bytes()[4] == b'-'
        && s.as_bytes()[7] == b'-'
        && s.bytes()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit());
    if ok {
        Ok(())
    } else {
        Err(AppError::Invalid(format!(
            "日期格式应为 YYYY-MM-DD，收到: {s}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::validate_date;

    #[test]
    fn accepts_valid_dates() {
        assert!(validate_date("2026-08-29").is_ok());
        assert!(validate_date("2026-01-01").is_ok());
    }

    #[test]
    fn rejects_malformed_dates() {
        for bad in [
            "2026-8-29",
            "26-08-29",
            "2026/08/29",
            "",
            "2026-08-29T00:00",
            "abcd-ef-gh",
        ] {
            assert!(validate_date(bad).is_err(), "「{bad}」不该通过校验");
        }
    }
}
