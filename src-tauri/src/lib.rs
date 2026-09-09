#[cfg(any(desktop, target_os = "android"))]
use tauri::Manager;

#[cfg(feature = "agent")]
mod agent;
#[cfg(all(desktop, feature = "calendar-connections"))]
mod calendar_connections;
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

/// Reports the compile target to the WebView so module routing does not rely
/// on a browser user agent (notably iPadOS desktop-mode user agents).
#[tauri::command]
fn runtime_platform() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

#[tauri::command]
fn report_native_smoke_phase(app: tauri::AppHandle, phase: &str) -> Result<(), String> {
    #[cfg(all(any(target_os = "android", target_os = "ios"), debug_assertions))]
    {
        use std::fs::OpenOptions;
        use std::io::Write;

        const PHASES: [&str; 5] = [
            "webview-created",
            "native-host-ready",
            "vue-mounted",
            "workspace-ready",
            "frontend-ready",
        ];
        if !PHASES.contains(&phase) {
            return Err(format!("Unknown native smoke phase: {phase}"));
        }

        #[cfg(target_os = "ios")]
        let run_id = std::env::var("SHIXUE_IOS_SMOKE_RUN_ID").ok();
        #[cfg(target_os = "ios")]
        let path = std::env::temp_dir().join("shixue-ios-launch-smoke.log");

        #[cfg(target_os = "android")]
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?;
        #[cfg(target_os = "android")]
        let run_id = std::fs::read_to_string(cache_dir.join("shixue-android-smoke-run-id"))
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        #[cfg(target_os = "android")]
        let path = cache_dir.join("shixue-android-launch-smoke.log");

        let Some(run_id) = run_id else {
            return Ok(());
        };
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|error| error.to_string())?;
        writeln!(file, "[shixue:smoke] {run_id} {phase}").map_err(|error| error.to_string())?;
    }

    #[cfg(not(all(any(target_os = "android", target_os = "ios"), debug_assertions)))]
    let _ = (app, phase);

    Ok(())
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AndroidPersistenceSmokeRequest {
    schema_version: u8,
    run_id: String,
    task_id: String,
    title: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AndroidPersistenceSmokeResult {
    schema_version: u8,
    run_id: String,
    stage: String,
    task_id: String,
    title: String,
    workspace_revision: u64,
}

#[tauri::command]
fn read_android_persistence_smoke_request(
    app: tauri::AppHandle,
) -> Result<Option<AndroidPersistenceSmokeRequest>, String> {
    #[cfg(all(target_os = "android", debug_assertions))]
    {
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?;
        let path = cache_dir.join("shixue-android-persistence-smoke-request.json");
        let source = match std::fs::read_to_string(path) {
            Ok(source) => source,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let request: AndroidPersistenceSmokeRequest =
            serde_json::from_str(&source).map_err(|error| error.to_string())?;
        validate_android_persistence_smoke_request(&request)?;
        return Ok(Some(request));
    }

    #[cfg(not(all(target_os = "android", debug_assertions)))]
    {
        let _ = app;
        Ok(None)
    }
}

#[tauri::command]
fn report_android_persistence_smoke_result(
    app: tauri::AppHandle,
    result: AndroidPersistenceSmokeResult,
) -> Result<(), String> {
    #[cfg(all(target_os = "android", debug_assertions))]
    {
        use std::fs::OpenOptions;
        use std::io::Write;

        let request = read_android_persistence_smoke_request(app.clone())?
            .ok_or_else(|| "Android persistence smoke request is missing.".to_owned())?;
        validate_android_persistence_smoke_result(&request, &result)?;
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(cache_dir.join("shixue-android-persistence-smoke.jsonl"))
            .map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut file, &result).map_err(|error| error.to_string())?;
        writeln!(file).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(not(all(target_os = "android", debug_assertions)))]
    {
        let _ = (app, result);
        Err("Android persistence smoke evidence is unavailable in this build.".into())
    }
}

#[cfg(any(all(target_os = "android", debug_assertions), test))]
fn validate_android_persistence_smoke_request(
    request: &AndroidPersistenceSmokeRequest,
) -> Result<(), String> {
    let expected_task_id = format!("task:android-persistence:{}", request.run_id);
    let expected_title = format!("Android persistence smoke {}", request.run_id);
    if request.schema_version != 1
        || !is_safe_smoke_token(&request.run_id)
        || request.task_id != expected_task_id
        || request.title != expected_title
    {
        return Err("Invalid Android persistence smoke request.".into());
    }
    Ok(())
}

#[cfg(any(all(target_os = "android", debug_assertions), test))]
fn validate_android_persistence_smoke_result(
    request: &AndroidPersistenceSmokeRequest,
    result: &AndroidPersistenceSmokeResult,
) -> Result<(), String> {
    if result.schema_version != 1
        || result.run_id != request.run_id
        || result.task_id != request.task_id
        || result.title != request.title
        || !matches!(
            result.stage.as_str(),
            "write-confirmed" | "restart-confirmed"
        )
        || result.workspace_revision == 0
    {
        return Err("Android persistence smoke result does not match its request.".into());
    }
    Ok(())
}

#[cfg(any(all(target_os = "android", debug_assertions), test))]
fn is_safe_smoke_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
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
        shortcut::set_registered(&app, enabled)
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

    #[cfg(all(desktop, feature = "calendar-connections"))]
    {
        builder = builder.plugin(calendar_connections::init());
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
            runtime_platform,
            report_native_smoke_phase,
            read_android_persistence_smoke_request,
            report_android_persistence_smoke_result,
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
            runtime_platform,
            report_native_smoke_phase,
            read_android_persistence_smoke_request,
            report_android_persistence_smoke_result,
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
            runtime_platform,
            report_native_smoke_phase,
            read_android_persistence_smoke_request,
            report_android_persistence_smoke_result,
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
            runtime_platform,
            report_native_smoke_phase,
            read_android_persistence_smoke_request,
            report_android_persistence_smoke_result,
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

#[cfg(test)]
mod tests {
    use super::{
        validate_android_persistence_smoke_request, validate_android_persistence_smoke_result,
        AndroidPersistenceSmokeRequest, AndroidPersistenceSmokeResult,
    };

    fn request() -> AndroidPersistenceSmokeRequest {
        AndroidPersistenceSmokeRequest {
            schema_version: 1,
            run_id: "run-1".into(),
            task_id: "task:android-persistence:run-1".into(),
            title: "Android persistence smoke run-1".into(),
        }
    }

    #[test]
    fn persistence_smoke_evidence_must_match_its_validated_request() {
        let request = request();
        assert!(validate_android_persistence_smoke_request(&request).is_ok());
        assert!(validate_android_persistence_smoke_result(
            &request,
            &AndroidPersistenceSmokeResult {
                schema_version: 1,
                run_id: request.run_id.clone(),
                stage: "restart-confirmed".into(),
                task_id: request.task_id.clone(),
                title: request.title.clone(),
                workspace_revision: 2,
            },
        )
        .is_ok());
    }

    #[test]
    fn persistence_smoke_rejects_forged_identity_and_unknown_stage() {
        let mut forged_request = request();
        forged_request.task_id = "task:other".into();
        assert!(validate_android_persistence_smoke_request(&forged_request).is_err());

        let request = request();
        assert!(validate_android_persistence_smoke_result(
            &request,
            &AndroidPersistenceSmokeResult {
                schema_version: 1,
                run_id: request.run_id.clone(),
                stage: "skipped".into(),
                task_id: request.task_id.clone(),
                title: request.title.clone(),
                workspace_revision: 2,
            },
        )
        .is_err());
    }
}
