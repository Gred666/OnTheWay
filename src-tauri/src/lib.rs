#[cfg(any(feature = "desktop-runtime", feature = "typegen"))]
mod commands;
mod db;
mod domain;
mod error;
#[cfg(any(feature = "desktop-runtime", feature = "typegen"))]
mod state;

#[cfg(feature = "desktop-runtime")]
use tauri::{Manager, WebviewWindow};
#[cfg(any(feature = "desktop-runtime", feature = "typegen"))]
use tauri_specta::{collect_commands, Builder};

#[cfg(any(feature = "desktop-runtime", feature = "typegen"))]
use state::AppState;

/// 窗口就绪后再显示。
///
/// tauri.conf.json 里 `visible: false`，等前端首帧渲染完再 show() ——
/// 否则用户会先看到一个空窗口闪一下，这是桌面应用最常见的廉价感来源。
#[cfg(feature = "desktop-runtime")]
#[tauri::command]
#[specta::specta]
fn ready(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

/* ---------------- 无边框窗口的窗口控制 ---------------- */

#[cfg(feature = "desktop-runtime")]
#[tauri::command]
#[specta::specta]
fn win_minimize(window: WebviewWindow) {
    let _ = window.minimize();
}

#[cfg(feature = "desktop-runtime")]
#[tauri::command]
#[specta::specta]
fn win_toggle_maximize(window: WebviewWindow) -> bool {
    let maximized = window.is_maximized().unwrap_or(false);
    let _ = if maximized {
        window.unmaximize()
    } else {
        window.maximize()
    };
    !maximized
}

#[cfg(feature = "desktop-runtime")]
#[tauri::command]
#[specta::specta]
fn win_close(window: WebviewWindow) {
    // close() 而不是 destroy()，让前端 onCloseRequested
    // 有机会把编辑器里未保存的内容 flush 掉（P6 会用到）
    let _ = window.close();
}

/// 保存完成后真正销毁窗口。只由前端的 close guard 调用，避免再次触发
/// `onCloseRequested` 形成递归。
#[cfg(feature = "desktop-runtime")]
#[tauri::command]
#[specta::specta]
fn win_force_close(window: WebviewWindow) {
    let _ = window.destroy();
}

#[cfg(feature = "desktop-runtime")]
#[tauri::command]
#[specta::specta]
fn win_is_maximized(window: WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[cfg(feature = "desktop-runtime")]
#[tauri::command]
#[specta::specta]
fn win_start_dragging(window: WebviewWindow) -> bool {
    window.start_dragging().is_ok()
}

#[cfg(feature = "desktop-runtime")]
fn command_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        ready,
        win_minimize,
        win_toggle_maximize,
        win_close,
        win_force_close,
        win_is_maximized,
        win_start_dragging,
        commands::note_list,
        commands::note_get,
        commands::note_upsert,
        commands::note_set_pinned,
        commands::note_archive,
        commands::note_restore,
        commands::note_delete,
        commands::search_notes,
        commands::task_toggle,
        commands::goal_latest,
        commands::goal_save,
        commands::calendar_day,
        commands::calendar_day_save,
        commands::calendar_marked,
        commands::db_stats,
    ])
}

/// 独立导出命令与领域类型，供 `cargo run --example export_bindings` 和
/// debug 启动共用。生成文件是前端 IPC 的唯一类型来源。
#[cfg(any(feature = "desktop-runtime", feature = "typegen"))]
pub fn export_typescript_bindings(path: impl AsRef<std::path::Path>) {
    #[cfg(feature = "desktop-runtime")]
    let builder = command_builder();
    #[cfg(all(feature = "typegen", not(feature = "desktop-runtime")))]
    let builder = Builder::<tauri::test::MockRuntime>::new().commands(collect_commands![
        commands::note_list,
        commands::note_get,
        commands::note_upsert,
        commands::note_set_pinned,
        commands::note_archive,
        commands::note_restore,
        commands::note_delete,
        commands::search_notes,
        commands::task_toggle,
        commands::goal_latest,
        commands::goal_save,
        commands::calendar_day,
        commands::calendar_day_save,
        commands::calendar_marked,
        commands::db_stats,
    ]);

    builder
        .export(
            specta_typescript::Typescript::default()
                // SQLite 时间戳是 UTC 毫秒，远低于 JS Number.MAX_SAFE_INTEGER；
                // 明确允许 i64 导出为 number，避免 debug 启动时导出器拒绝生成。
                .bigint(specta_typescript::BigIntExportBehavior::Number)
                // 无事件时 tauri-specta 仍会生成事件辅助代码，TS 的
                // noUnusedLocals 会误报；生成文件本身由 Rust 类型约束。
                .header("// 由 tauri-specta 自动生成，请勿手动编辑。\n// @ts-nocheck\n"),
            path,
        )
        .expect("导出 TS 绑定失败");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(feature = "desktop-runtime")]
pub fn run() {
    let specta_builder = command_builder();

    // 开发时把 TS 绑定写到前端目录。手写 IPC 类型是这个架构里最容易
    // 出错的地方，交给生成器。
    #[cfg(debug_assertions)]
    export_typescript_bindings("../src/lib/bindings.ts");

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);

            let db_path = app
                .path()
                .app_data_dir()
                .expect("拿不到 app data 目录")
                .join("ontheway.db");

            let pool = db::open(&db_path).expect("打开数据库失败");

            {
                let mut conn = pool.get().expect("拿连接失败");
                domain::seed::ensure(&mut conn).expect("写入示例内容失败");
            }

            app.manage(AppState { pool, db_path });

            // jieba 首次初始化约 50ms。放后台预热，
            // 别等用户第一次敲搜索框才付这个代价。
            std::thread::spawn(domain::search::warm_up);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running OnTheWay");
}
