// 不带 Tauri 运行时的纯逻辑单测（cargo test --no-default-features --lib）里，
// 只给命令层用的函数和类型没人调用，别让它们刷一屏警告
#![cfg_attr(
    not(any(feature = "desktop-runtime", feature = "typegen")),
    allow(dead_code)
)]

mod boot;
#[cfg(any(feature = "desktop-runtime", feature = "typegen"))]
mod commands;
mod db;
mod domain;
mod error;
#[cfg(any(feature = "desktop-runtime", feature = "typegen"))]
mod state;
mod vault;

#[cfg(feature = "desktop-runtime")]
use std::sync::{Arc, Mutex};
#[cfg(feature = "desktop-runtime")]
use tauri::{Manager, WebviewWindow};
#[cfg(any(feature = "desktop-runtime", feature = "typegen"))]
use tauri_specta::{collect_commands, collect_events, Builder};

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
        commands::note_list_full,
        commands::note_get,
        commands::note_upsert,
        commands::note_set_pinned,
        commands::note_archive,
        commands::note_restore,
        commands::note_delete,
        commands::note_undelete,
        commands::search_notes,
        commands::task_toggle,
        commands::goal_get,
        commands::goal_save,
        commands::calendar_day,
        commands::calendar_day_save,
        commands::calendar_marked,
        commands::vault_info,
        commands::vault_reveal,
        commands::vault_open_folder,
        commands::vault_keep_conflict_copy,
        commands::vault_change_root::<tauri::Wry>,
    ])
    .events(collect_events![commands::VaultChanged])
}

/// 独立导出命令与领域类型，供 `cargo run --example export_bindings` 和
/// debug 启动共用。生成文件是前端 IPC 的唯一类型来源。
#[cfg(any(feature = "desktop-runtime", feature = "typegen"))]
pub fn export_typescript_bindings(path: impl AsRef<std::path::Path>) {
    #[cfg(feature = "desktop-runtime")]
    let builder = command_builder();
    #[cfg(all(feature = "typegen", not(feature = "desktop-runtime")))]
    let builder = Builder::<tauri::test::MockRuntime>::new().commands(collect_commands![
        commands::note_list_full,
        commands::note_get,
        commands::note_upsert,
        commands::note_set_pinned,
        commands::note_archive,
        commands::note_restore,
        commands::note_delete,
        commands::note_undelete,
        commands::search_notes,
        commands::task_toggle,
        commands::goal_get,
        commands::goal_save,
        commands::calendar_day,
        commands::calendar_day_save,
        commands::calendar_marked,
        commands::vault_info,
        commands::vault_reveal,
        commands::vault_open_folder,
        commands::vault_keep_conflict_copy,
        commands::vault_change_root::<tauri::test::MockRuntime>,
    ])
    .events(collect_events![commands::VaultChanged]);

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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);

            let data_dir = boot::data_dir(app.path().app_data_dir().expect("拿不到应用数据目录"));
            let mut config = boot::Config::load(&data_dir);
            let root = boot::vault_root(&config, app.path().document_dir().ok(), &data_dir);

            // 第一次启动：旧库有东西就搬进文件夹，否则放示例内容。搬家失败时不能带着
            // 一个空仓库启动 —— 用户会以为笔记全没了，还可能在空仓库里接着写。
            match boot::prepare(&root, &data_dir, &mut config, true) {
                Ok(boot::Prepared::Imported(report)) => eprintln!("旧数据已搬进 {}: {report:?}", root.display()),
                Ok(_) => {}
                Err(error) => panic!("准备笔记文件夹 {} 失败: {error}", root.display()),
            }
            if std::env::var_os("ONTHEWAY_VAULT").is_none() {
                config.vault_root = Some(root.clone());
            }
            if let Err(error) = config.save(&data_dir) {
                eprintln!("保存配置失败: {error}");
            }

            let mut vault = vault::Vault::open(&root, &boot::index_path(&data_dir, &root))
                .expect("打开笔记文件夹失败");
            vault.set_announcer(commands::announcer(app.handle().clone()));
            let vault = Arc::new(Mutex::new(vault));
            let watcher = match vault::watch::start(vault.clone()) {
                Ok(watcher) => Some(watcher),
                Err(error) => {
                    // 监听不上只是外部改动不能实时同步，重启时的扫描还会补上
                    eprintln!("{error}");
                    None
                }
            };
            app.manage(AppState {
                vault,
                watcher: Mutex::new(watcher),
                data_dir,
            });

            // jieba 首次初始化约 50ms。仓库是空的时候打开仓库不会用到它，放后台预热
            std::thread::spawn(domain::search::warm_up);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running OnTheWay");
}
