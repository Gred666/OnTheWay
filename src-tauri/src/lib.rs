mod commands;
mod db;
mod domain;
mod error;
mod state;

use tauri::{Manager, WebviewWindow};
use tauri_specta::{collect_commands, Builder};

use state::AppState;

/// 窗口就绪后再显示。
///
/// tauri.conf.json 里 `visible: false`，等前端首帧渲染完再 show() ——
/// 否则用户会先看到一个空窗口闪一下，这是桌面应用最常见的廉价感来源。
#[tauri::command]
#[specta::specta]
fn ready(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

/* ---------------- 无边框窗口的窗口控制 ---------------- */

#[tauri::command]
#[specta::specta]
fn win_minimize(window: WebviewWindow) {
    let _ = window.minimize();
}

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

#[tauri::command]
#[specta::specta]
fn win_close(window: WebviewWindow) {
    // close() 而不是 destroy()，让前端 onCloseRequested
    // 有机会把编辑器里未保存的内容 flush 掉（P6 会用到）
    let _ = window.close();
}

#[tauri::command]
#[specta::specta]
fn win_is_maximized(window: WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        ready,
        win_minimize,
        win_toggle_maximize,
        win_close,
        win_is_maximized,
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
        commands::calendar_day,
        commands::calendar_marked,
        commands::db_stats,
    ]);

    // 开发时把 TS 绑定写到前端目录。手写 IPC 类型是这个架构里最容易
    // 出错的地方，交给生成器。
    #[cfg(debug_assertions)]
    specta_builder
        .export(
            specta_typescript::Typescript::default()
                .header("// 由 tauri-specta 自动生成，请勿手动编辑。\n"),
            "../src/lib/bindings.ts",
        )
        .expect("导出 TS 绑定失败");

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
