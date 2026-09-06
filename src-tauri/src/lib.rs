#[cfg(desktop)]
use tauri::Manager;

#[cfg(feature = "agent")]
mod agent;
mod db;
#[cfg(all(desktop, feature = "notification"))]
mod reminder_scheduler;
#[cfg(all(desktop, feature = "shortcut"))]
mod shortcut;
#[cfg(feature = "sync")]
mod study_cloud;
#[cfg(desktop)]
mod tray;

/// 前端 -> Rust 的示例命令，演示 IPC 的类型传递。
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn read_legacy_reminder_deliveries(
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    #[cfg(all(desktop, feature = "notification"))]
    {
        let rows = reminder_scheduler::read_legacy_reminder_deliveries(app).await?;
        serde_json::to_value(rows).map_err(|error| error.to_string())
    }
    #[cfg(not(all(desktop, feature = "notification")))]
    {
        let _ = app;
        Err("Legacy reminder storage is unavailable in this build.".into())
    }
}

#[tauri::command]
fn set_quick_add_shortcut(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(all(desktop, feature = "shortcut"))]
    {
        return shortcut::set_registered(&app, enabled);
    }
    #[cfg(not(all(desktop, feature = "shortcut")))]
    {
        let _ = (app, enabled);
        Err("Global quick capture is unavailable in this build.".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // 自动更新装完后需要 process 插件来重启应用
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        // —— 核心能力：始终启用 ——
        // 轻量键值持久化，适合存窗口尺寸之类的 UI 偏好
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        );

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    // —— 可选模块：按 Cargo feature 装配（与前端 modules.config.ts 的 P1 模块对应） ——

    #[cfg(all(desktop, feature = "shortcut"))]
    {
        builder = builder.plugin(shortcut::plugin());
    }

    #[cfg(feature = "clipboard")]
    {
        builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    }

    #[cfg(feature = "notification")]
    {
        builder = builder.plugin(tauri_plugin_notification::init());
    }

    #[cfg(all(desktop, feature = "autostart"))]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    }

    #[cfg(all(feature = "agent", feature = "sync"))]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            greet,
            read_legacy_reminder_deliveries,
            set_quick_add_shortcut,
            agent::set_api_key,
            agent::has_api_key,
            agent::delete_api_key,
            agent::proxy_json,
            agent::proxy_stream,
            study_cloud::study_cloud_sign_in,
            study_cloud::study_cloud_session_status,
            study_cloud::study_cloud_sign_out,
            study_cloud::study_cloud_pull,
            study_cloud::study_cloud_push
        ]);
    }

    #[cfg(all(feature = "agent", not(feature = "sync")))]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            greet,
            read_legacy_reminder_deliveries,
            set_quick_add_shortcut,
            agent::set_api_key,
            agent::has_api_key,
            agent::delete_api_key,
            agent::proxy_json,
            agent::proxy_stream
        ]);
    }

    #[cfg(all(not(feature = "agent"), feature = "sync"))]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            greet,
            read_legacy_reminder_deliveries,
            set_quick_add_shortcut,
            study_cloud::study_cloud_sign_in,
            study_cloud::study_cloud_session_status,
            study_cloud::study_cloud_sign_out,
            study_cloud::study_cloud_pull,
            study_cloud::study_cloud_push
        ]);
    }

    #[cfg(all(not(feature = "agent"), not(feature = "sync")))]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            greet,
            read_legacy_reminder_deliveries,
            set_quick_add_shortcut
        ]);
    }

    #[cfg(desktop)]
    {
        builder = builder
            // 二次启动时聚焦已有窗口，而不是开第二个实例
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                show_main_window(app);
            }))
            .setup(|app| {
                tray::create_tray(app.handle())?;

                #[cfg(feature = "notification")]
                reminder_scheduler::start(app.handle());

                Ok(())
            });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(desktop)]
fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window(tray::MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
