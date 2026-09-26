use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_specta::Event;

use crate::boot;
use crate::domain::model::*;
use crate::domain::validate_date;
use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::vault::{fsio, layout, watch, Announce, Vault};

/* ============================================================
命令层：只做参数校验和调用，读写全在 vault/。

每个命令都在阻塞线程池里拿仓库的锁执行 —— 文件读写和 SQLite 都是同步的，
直接在 tokio 的 worker 上跑会拖住整个运行时。
============================================================ */

/// 仓库里别处发生的变化（外部程序改了文件、勾任务改了别的文档），前端据此刷新
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct VaultChanged(pub VaultChange);

pub fn announcer<R: Runtime>(app: AppHandle<R>) -> Announce {
    Arc::new(move |change| {
        if let Err(error) = VaultChanged(change).emit(&app) {
            eprintln!("通知前端失败: {error}");
        }
    })
}

async fn blocking<T, F>(f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("任务panic: {e}")))?
}

async fn with_vault<T, F>(state: &AppState, f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&mut Vault) -> Result<T> + Send + 'static,
{
    let vault = state.vault.clone();
    blocking(move || {
        let mut vault = vault
            .lock()
            .map_err(|_| AppError::Internal("仓库锁坏了".into()))?;
        f(&mut vault)
    })
    .await
}

/* ---------------- 笔记 ---------------- */

// 启动时一次取回整个列表的全文，替代「摘要列表 + 逐篇 note_get」
#[tauri::command]
#[specta::specta]
pub async fn note_list_full(state: State<'_, AppState>, archived: bool) -> Result<Vec<Note>> {
    with_vault(&state, move |v| v.note_list_full(archived)).await
}

#[tauri::command]
#[specta::specta]
pub async fn note_get(state: State<'_, AppState>, id: String) -> Result<Note> {
    with_vault(&state, move |v| v.note_get(&id)).await
}

/// id 为 null 是新建（返回新 id）；否则改标题和正文，标题变了文件跟着改名
#[tauri::command]
#[specta::specta]
pub async fn note_upsert(state: State<'_, AppState>, input: NoteInput) -> Result<String> {
    if input.title.trim().is_empty() && input.content_md.trim().is_empty() {
        return Err(AppError::Invalid("标题和正文不能同时为空".into()));
    }
    with_vault(&state, move |v| match input.id {
        Some(id) => v.note_update(&id, &input.title, &input.content_md).map(|()| id),
        None => v.note_create(&input.title, &input.content_md),
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn note_set_pinned(state: State<'_, AppState>, id: String, pinned: bool) -> Result<()> {
    with_vault(&state, move |v| v.note_set_pinned(&id, pinned)).await
}

#[tauri::command]
#[specta::specta]
pub async fn note_archive(
    state: State<'_, AppState>,
    id: String,
    category: Option<String>,
) -> Result<()> {
    with_vault(&state, move |v| v.note_archive(&id, category)).await
}

#[tauri::command]
#[specta::specta]
pub async fn note_restore(state: State<'_, AppState>, id: String) -> Result<()> {
    with_vault(&state, move |v| v.note_restore(&id)).await
}

/// 删除 = 挪进仓库的回收站（.ontheway/trash/，30 天后清掉）
#[tauri::command]
#[specta::specta]
pub async fn note_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    with_vault(&state, move |v| v.note_delete(&id)).await
}

// 删除后的「撤销」
#[tauri::command]
#[specta::specta]
pub async fn note_undelete(state: State<'_, AppState>, id: String) -> Result<()> {
    with_vault(&state, move |v| v.note_undelete(&id)).await
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
    with_vault(&state, move |v| v.search(&query, limit)).await
}

/* ---------------- 任务 ---------------- */

/// 勾选日历里的一条任务：改的是它所在文件里的那一行
#[tauri::command]
#[specta::specta]
pub async fn task_toggle(state: State<'_, AppState>, id: String) -> Result<Task> {
    with_vault(&state, move |v| v.toggle_task(&id)).await
}

/* ---------------- 目标 ---------------- */

/// 某个周期的目标。period_start 由前端按 horizon 算好（周一 / 1 号 / 1 月 1 日），
/// 这里校验它确实是周期起点。没写过的周期返回空文档。
#[tauri::command]
#[specta::specta]
pub async fn goal_get(
    state: State<'_, AppState>,
    horizon: String,
    period_start: String,
) -> Result<Goal> {
    validate_date(&period_start)?;
    with_vault(&state, move |v| v.goal(&horizon, &period_start)).await
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
    with_vault(&state, move |v| v.save_goal(&horizon, &period_start, &content_md)).await
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
    with_vault(&state, move |v| v.day(&date, carry_over)).await
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
    with_vault(&state, move |v| v.save_day(&date, &title, &note_md)).await
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
    with_vault(&state, move |v| v.marked_dates(&from, &to)).await
}

/* ---------------- 仓库文件夹 ---------------- */

#[tauri::command]
#[specta::specta]
pub async fn vault_info(state: State<'_, AppState>) -> Result<VaultInfo> {
    with_vault(&state, |v| v.info()).await
}

/// 在系统的文件管理器里定位这篇文档的文件（选中它）。还没写过的某一天 /
/// 某个周期没有文件，打开它将来所在的文件夹。
#[tauri::command]
#[specta::specta]
pub async fn vault_reveal(state: State<'_, AppState>, target: DocTarget) -> Result<()> {
    let (path, is_file) = with_vault(&state, move |v| v.locate(&target)).await?;
    blocking(move || {
        let result = if is_file {
            tauri_plugin_opener::reveal_item_in_dir(&path)
        } else {
            tauri_plugin_opener::open_path(&path, None::<&str>)
        };
        result.map_err(|error| AppError::Io(format!("打开文件夹失败: {error}")))
    })
    .await
}

/// 打开整个笔记文件夹
#[tauri::command]
#[specta::specta]
pub async fn vault_open_folder(state: State<'_, AppState>) -> Result<()> {
    let root = with_vault(&state, |v| Ok(v.root().to_path_buf())).await?;
    blocking(move || {
        tauri_plugin_opener::open_path(&root, None::<&str>)
            .map_err(|error| AppError::Io(format!("打开文件夹失败: {error}")))
    })
    .await
}

/// 编辑器里有没存的改动时，磁盘上又来了外部改动：先把磁盘上那一版另存一份
/// 「(冲突 …)」，前端随后照常保存自己的。返回冲突副本的标题。
#[tauri::command]
#[specta::specta]
pub async fn vault_keep_conflict_copy(
    state: State<'_, AppState>,
    target: DocTarget,
) -> Result<Option<String>> {
    with_vault(&state, move |v| v.keep_conflict_copy(&target)).await
}

/// 换一个文件夹当仓库。弹系统的选择文件夹对话框；新文件夹是空的就问要不要把
/// 现在的笔记一起复制过去（原来的不动）。取消了返回 null。前端拿到结果后整页重载。
#[tauri::command]
#[specta::specta]
pub async fn vault_change_root<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<Option<VaultInfo>> {
    let current = with_vault(&state, |v| Ok(v.root().to_path_buf())).await?;

    let picker = app.clone();
    let start = current.parent().map(PathBuf::from).unwrap_or_else(|| current.clone());
    let picked = blocking(move || {
        Ok(picker
            .dialog()
            .file()
            .set_title("选择笔记文件夹")
            .set_directory(start)
            .blocking_pick_folder())
    })
    .await?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let new_root = picked
        .into_path()
        .map_err(|error| AppError::Invalid(format!("这个位置用不了: {error}")))?;

    let same = |a: &std::path::Path, b: &std::path::Path| {
        a.canonicalize().ok().zip(b.canonicalize().ok()).is_some_and(|(a, b)| a == b)
    };
    if same(&new_root, &current) {
        return with_vault(&state, |v| v.info()).await.map(Some);
    }
    let canonical = |p: &std::path::Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    let (new_canonical, current_canonical) = (canonical(&new_root), canonical(&current));
    if new_canonical.starts_with(&current_canonical) || current_canonical.starts_with(&new_canonical) {
        return Err(AppError::Invalid(
            "新文件夹不能在现在的笔记文件夹里面，也不能包着它".into(),
        ));
    }

    let target_is_vault =
        fsio::has_markdown(&new_root) || fsio::abs(&new_root, layout::VAULT_MARKER).exists();
    if !target_is_vault && fsio::has_markdown(&current) {
        let asker = app.clone();
        let bring = blocking(move || {
            Ok(asker
                .dialog()
                .message("新文件夹是空的。要把现在的笔记一起复制过去吗？\n\n原来的文件夹不会被改动。")
                .title("更换笔记文件夹")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "复制过去".into(),
                    "只换文件夹".into(),
                ))
                .blocking_show())
        })
        .await?;
        if bring {
            let (from, to) = (current.clone(), new_root.clone());
            blocking(move || boot::copy_vault(&from, &to).map(|_| ())).await?;
        }
    }

    let data_dir = state.data_dir.clone();
    let root = new_root.clone();
    let vault = blocking(move || {
        let mut config = boot::Config::load(&data_dir);
        boot::prepare(&root, &data_dir, &mut config, false)?;
        let vault = Vault::open(&root, &boot::index_path(&data_dir, &root))?;
        config.vault_root = Some(root);
        config.save(&data_dir)?;
        Ok(vault)
    })
    .await?;

    // 先停旧的监听，再换仓库
    *state
        .watcher
        .lock()
        .map_err(|_| AppError::Internal("监听锁坏了".into()))? = None;
    {
        let mut current = state
            .vault
            .lock()
            .map_err(|_| AppError::Internal("仓库锁坏了".into()))?;
        *current = vault;
        current.set_announcer(announcer(app.clone()));
    }
    match watch::start(state.vault.clone()) {
        Ok(watcher) => {
            *state
                .watcher
                .lock()
                .map_err(|_| AppError::Internal("监听锁坏了".into()))? = Some(watcher);
        }
        Err(error) => eprintln!("{error}"),
    }
    with_vault(&state, |v| v.info()).await.map(Some)
}
