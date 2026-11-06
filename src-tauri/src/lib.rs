// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

mod config;
mod db;
mod ei_runner;
mod evtc_parser;
mod uploader;
mod vl_ranks;
mod watcher;

use config::AppConfig;

pub static EI_LOCKS: OnceLock<Mutex<std::collections::HashMap<std::path::PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
pub fn ei_locks() -> &'static Mutex<std::collections::HashMap<std::path::PathBuf, Arc<Mutex<()>>>> {
    EI_LOCKS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}
pub static EI_SEMAPHORE: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
pub fn ei_semaphore() -> &'static tokio::sync::Semaphore {
    EI_SEMAPHORE.get_or_init(|| tokio::sync::Semaphore::new(2))
}
pub fn ei_lock_for(path: &std::path::Path) -> Arc<Mutex<()>> {
    let lock = ei_locks();
    {
        let map = lock.lock().unwrap();
        if let Some(v) = map.get(path) { return v.clone(); }
    }
    let mut map = lock.lock().unwrap();
    map.entry(path.to_path_buf()).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
}
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Emitter;
use tauri::{AppHandle, Manager, State, WindowEvent};
use watcher::LogWatcher;

/// Install a process-global panic hook that writes the panic message + backtrace
/// to a file under %LOCALAPPDATA%/Portal Protocol/crash.log (and mirrors to stderr).
///
/// WHY THIS EXISTS: the app was "fully closing" during golem uploads with no trace.
/// tokio-spawned upload/heal tasks catch their own panics (so they can't abort the
/// process), but a panic on the MAIN thread, in the single std::thread (watcher
/// forwarder), or from a poisoned-lock .unwrap() anywhere will abort the WHOLE
/// process. This hook captures the real panic + backtrace so the cause is never
/// hidden again. It also makes a panic non-fatal to the process where feasible by
/// logging instead of letting the default hook print-and-abort on non-tokio threads.
fn install_panic_logger() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let mut msg = String::new();
        let _ = std::fmt::write(
            &mut msg,
            format_args!(
                "PANIC @ {}:{} : ",
                info.location().map(|l| l.file()).unwrap_or("?"),
                info.location().map(|l| l.line()).unwrap_or(0)
            ),
        );
        match info.payload().downcast_ref::<&str>() {
            Some(s) => msg.push_str(s),
            None => match info.payload().downcast_ref::<String>() {
                Some(s) => msg.push_str(s),
                None => msg.push_str("<non-string payload>"),
            },
        }
        msg.push('\n');
        let bt = std::backtrace::Backtrace::force_capture();
        let _ = std::fmt::write(&mut msg, format_args!("BACKTRACE:\n{}\n", bt));

        // Best-effort write to %LOCALAPPDATA%/Portal Protocol/crash.log
        if let Some(local) = dirs_local_data_dir() {
            let dir = local.join("Portal Protocol");
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("crash.log"))
            {
                let _ = f.write_all(msg.as_bytes());
            }
        }
        // Also surface to stderr for `npm run tauri dev` users.
        eprintln!("{}", msg);
        // Run the default hook (prints the panic) but we've already captured it.
        default(info);
    }));
}

/// Minimal shim so we don't pull in the `directories` crate just for this.
fn dirs_local_data_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(|h| std::path::PathBuf::from(h).join(".local").join("share"))
        })
}
use tokio::sync::mpsc::Sender;

struct AppState {
    watcher: Arc<Mutex<LogWatcher>>,
    upload_tx: Sender<PathBuf>,
    // Manual uploads (drag-drop / folder picker / re-upload) flow through here so
    // `start_upload_loop` can tag them and exempt them from the `min_log_seconds`
    // auto-skip. A user who explicitly chooses a file should never be silently
    // banned by a too-short-fight heuristic (see uploader.rs).
    manual_tx: Sender<PathBuf>,
}

fn set_autostart(enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get current exe path: {}", e))?;
        let exe_str = exe_path
            .to_str()
            .ok_or_else(|| "Invalid exe path".to_string())?;

        if enable {
            let output = std::process::Command::new("reg")
                .creation_flags(0x08000000) // CREATE_NO_WINDOW (0x08000000) prevents flashing CMD window
                .args([
                    "add",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    "GW2LogUploader",
                    "/t",
                    "REG_SZ",
                    "/d",
                    &format!("\"{}\"", exe_str),
                    "/f",
                ])
                .output()
                .map_err(|e| format!("Failed to run reg: {}", e))?;
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                return Err(format!("reg add failed: {}", err));
            }
        } else {
            let _ = std::process::Command::new("reg")
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .args([
                    "delete",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    "GW2LogUploader",
                    "/f",
                ])
                .output();
        }
    }
    Ok(())
}

#[tauri::command]
async fn get_config(app: AppHandle) -> AppConfig {
    config::load_config(&app)
}

#[tauri::command]
async fn save_config(
    app: AppHandle,
    state: State<'_, AppState>,
    new_config: AppConfig,
) -> Result<(), String> {
    // Save new configuration to disk
    config::save_config(&app, &new_config)?;

    // Apply concurrency changes live (no restart needed)
    crate::uploader::set_concurrency(new_config.max_concurrent_uploads);

    // Toggle Windows autostart Registry key
    let _ = set_autostart(new_config.autostart);

    // Update watcher path if auto-upload is enabled
    // Poison-tolerant: never .unwrap() a Mutex on the command thread — a poisoned
    // lock (from a panic elsewhere) would abort the whole process.
    match state.watcher.lock() {
        Ok(mut watcher) => {
            if new_config.auto_upload && !new_config.logs_directory.is_empty() {
                watcher.start(
                    &new_config.logs_directory,
                    state.upload_tx.clone(),
                    new_config.watch_stability_delay_ms,
                    new_config.watch_poll_interval_ms,
                )?;
            } else {
                watcher.stop();
            }
        }
        Err(_) => { /* poisoned — skip watcher resync, non-fatal */ }
    }

    Ok(())
}

#[tauri::command]
fn get_watcher_status(_state: State<'_, AppState>) -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
fn stop_watcher(state: State<'_, AppState>) -> Result<(), String> {
    // Explicitly stop the file watcher (drops the notify handle AND signals the
    // forwarding thread to exit, so no thread/file-handle leak).
    // Poison-tolerant: don't .unwrap() on the command thread.
    if let Ok(mut w) = state.watcher.lock() {
        w.stop();
    }
    Ok(())
}

#[tauri::command]
fn update_log_status(app: AppHandle, file_path: String, status: String) -> Result<(), String> {
    config::with_history_mut(&app, |history| {
        if let Some(idx) = history.iter().position(|r| r.file_path == file_path) {
            history[idx].status = status.clone();
            let _ = app.emit("upload-status", history[idx].clone());
            true
        } else {
            false
        }
    })
}

#[tauri::command]
fn trigger_manual_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }
    // A deliberate re-upload must bypass the "deleted" suppression. deleted_paths.json
    // exists only to swallow the arcdps watcher re-touch echo after a delete — it must
    // not block a user who explicitly re-queues the same file (otherwise "Delete" then
    // "upload again" silently does nothing).
    let mut deleted = config::load_deleted_paths(&app);
    let norm = config::normalize_path(&file_path);
    if deleted.remove(&norm) {
        let _ = config::save_deleted_paths(&app, &deleted);
    }
    // Route through the manual channel so upload_file skips the min_log_seconds ban.
    state.manual_tx.try_send(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_error_report(file_name: String, content: String) -> Result<String, String> {
    use directories::UserDirs;
    use std::fs::File;
    use std::io::Write;

    let user_dirs =
        UserDirs::new().ok_or_else(|| "Could not locate user directories".to_string())?;
    let desktop = user_dirs
        .desktop_dir()
        .ok_or_else(|| "Could not locate Desktop folder".to_string())?;

    // Clean file name to prevent directory traversal
    let clean_name = file_name.replace(
        |c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '_',
        "_",
    );

    // Create timestamp
    let now = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let report_file_name = format!("EVTC_Error_{}_{}.txt", clean_name, now);
    let save_path = desktop.join(report_file_name);

    let mut file = File::create(&save_path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write report: {}", e))?;

    Ok(save_path.to_string_lossy().to_string())
}

/// Shared HTTP client for the lightweight 20s status polls (dps.report / b.dps.report /
/// Wingman). One pooled client across all three checks instead of rebuilding per call,
/// so keep-alive connections are reused on every tick. Short timeout + browser UA so
/// dps.report's GET /uploadContent returns its expected 400/405 (treated as "online").
fn http_check_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .pool_max_idle_per_host(4)
            .build()
            .expect("health-check client build")
    })
}

#[tauri::command]
async fn check_dps_report_status() -> Result<String, String> {
    static FAILS: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
    let client = http_check_client();

    let res = client.get("https://dps.report/uploadContent").send().await;

    let status = match res {
        Ok(response) => {
            let code = response.status().as_u16();
            if code == 400 || code == 405 || response.status().is_success() {
                Ok("online".to_string())
            } else if code >= 500 {
                Ok("offline".to_string())
            } else {
                Ok(format!("degraded_{}", code))
            }
        }
        Err(_) => Ok("offline".to_string()),
    };
    let down = matches!(status, Ok(ref s) if s == "offline");
    if down {
        let n = FAILS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        if n >= 3 {
            crate::uploader::set_dps_report_down(true);
        }
    } else {
        FAILS.store(0, std::sync::atomic::Ordering::Relaxed);
        // Don't override a 5xx-driven outage with a false-positive "online"
        // health check. Keep the flag down until uploads succeed again.
        if crate::uploader::consecutive_5xx() == 0 {
            crate::uploader::set_dps_report_down(false);
        }
    }
    // Report offline to the frontend when uploads have been failing with 5xx,
    // even if the lightweight health check still says "online".
    if crate::uploader::consecutive_5xx() >= 2 {
        return Ok("offline".to_string());
    }
    status
}
#[tauri::command]
async fn check_bundled_ei(app: AppHandle) -> Result<(), String> {
    crate::ei_runner::check_bundled_ei(&app)
}

#[tauri::command]
async fn check_backup_dps_status() -> Result<String, String> {
    static FAILS: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
    let client = http_check_client();

    let res = client
        .get("https://b.dps.report/uploadContent")
        .send()
        .await;

    let status = match res {
        Ok(response) => {
            let code = response.status().as_u16();
            if code == 400 || code == 405 || response.status().is_success() {
                Ok("online".to_string())
            } else if code >= 500 {
                Ok("offline".to_string())
            } else {
                Ok(format!("degraded_{}", code))
            }
        }
        Err(_) => Ok("offline".to_string()),
    };
    let down = matches!(status, Ok(ref s) if s == "offline");
    if down {
        let n = FAILS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        if n >= 3 {
            crate::uploader::set_backup_dps_down(true);
        }
    } else {
        FAILS.store(0, std::sync::atomic::Ordering::Relaxed);
        crate::uploader::set_backup_dps_down(false);
    }
    status
}

#[tauri::command]
fn sweep_dps_processing(app: AppHandle) {
    uploader::sweep_stuck_processing_on_recovery(app);
}

#[tauri::command]
async fn check_wingman_status() -> Result<String, String> {
    let client = http_check_client();

    let res = client
        .get("https://gw2wingman.nevermindcreations.de/testConnection")
        .send()
        .await;

    match res {
        Ok(response) => {
            let code = response.status().as_u16();
            if response.status().is_success() {
                let body = response.text().await.unwrap_or_default();
                if body.trim().eq_ignore_ascii_case("True") {
                    Ok("online".to_string())
                } else {
                    Ok("degraded_bad_response".to_string())
                }
            } else if code >= 500 {
                Ok("offline".to_string())
            } else {
                Ok(format!("degraded_{}", code))
            }
        }
        Err(_) => Ok("offline".to_string()),
    }
}

#[tauri::command]
async fn pick_log_files() -> Result<Vec<String>, String> {
    let files = rfd::AsyncFileDialog::new()
        .add_filter("Guild Wars 2 Logs", &["evtc", "zevtc"])
        .pick_files()
        .await
        .ok_or("No files selected")?;
    Ok(files
        .into_iter()
        .map(|f| f.path().to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
async fn run_local_ei_parse(app: tauri::AppHandle, file_path: String) -> Result<serde_json::Value, String> {
    let path = std::path::PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("local log file does not exist: {}", file_path));
    }
    let app_clone = app.clone();
    let handle = tauri::async_runtime::spawn_blocking(move || {
        crate::ei_runner::run_ei(&app_clone, &path)
    });
    let raw = handle.await.map_err(|e| format!("EI task failed: {}", e))??;
    crate::ei_runner::store_local_ei_report(&app, &file_path, raw.clone());
    // Clean up arcdps sidecar files (.log/.html) created by EI in the same folder.
    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        crate::ei_runner::cleanup_leftover_ei_files(parent);
    }
    Ok(raw)
}

#[tauri::command]
fn load_stats_cache(app: tauri::AppHandle, file_path: String) -> Result<Option<serde_json::Value>, String> {
    Ok(crate::ei_runner::load_stats_cache(&app, &file_path))
}

#[tauri::command]
fn store_stats_cache(app: tauri::AppHandle, file_path: String, data: serde_json::Value) -> Result<(), String> {
    crate::ei_runner::store_stats_cache(&app, &file_path, data);
    Ok(())
}

#[tauri::command]
fn parse_local_revealed_sources(file_path: String) -> Result<Vec<serde_json::Value>, String> {
    let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    let events = evtc_parser::parse_revealed_sources(&bytes)
        .ok_or_else(|| format!("Failed to parse EVTC Revealed sources: {}", file_path))?;
    Ok(events
        .into_iter()
        .map(|e| {
            serde_json::json!({
                "time": e.time,
                "dst_character": e.dst_character,
                "dst_account": e.dst_account,
                "dst_profession": e.dst_profession,
                "skill_id": e.skill_id,
                "trigger_skill_ids": e.trigger_skill_ids,
                "trigger_srcs": e.trigger_srcs,
                "src_character": e.src_character,
                "src_account": e.src_account,
                "src_profession": e.src_profession,
            })
        })
        .collect())
}

#[tauri::command]
async fn open_in_explorer(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(path.clone(), None::<&str>)
        .map_err(|e| format!("Failed to open path: {}", e))
}

#[tauri::command]
async fn reset_window_state(app: AppHandle) -> Result<(), String> {
    let dir = crate::config::get_config_dir(&app);
    let state_path = dir.join(".window-state.json");
    if state_path.exists() {
        std::fs::remove_file(&state_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_settings_folder(app: AppHandle) -> Result<(), String> {
    let dir = crate::config::get_config_dir(&app);
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open folder: {}", e))
}

#[tauri::command]
async fn get_history_count(app: AppHandle) -> usize {
    config::load_history(&app).len()
}

#[tauri::command]
async fn get_history_page(
    app: AppHandle,
    page: usize,
    limit: usize,
) -> Vec<crate::uploader::UploadRecord> {
    let history = config::load_history(&app);
    let start = page * limit;
    if start >= history.len() {
        return Vec::new();
    }
    let end = std::cmp::min(start + limit, history.len());
    history[start..end].to_vec()
}

#[tauri::command]
async fn clear_history(app: AppHandle) -> Result<(), String> {
    config::save_history(&app, &[])?;
    config::invalidate_history_set(&app);
    Ok(())
}

#[tauri::command]
async fn delete_history_log(app: AppHandle, file_path: String) -> Result<(), String> {
    config::with_history_mut(&app, |history| {
        let before = history.len();
        history.retain(|r| r.file_path != file_path);
        history.len() != before
    })?;
    config::invalidate_history_set(&app);
    Ok(())
}

#[tauri::command]
async fn get_feed(app: AppHandle) -> Vec<String> {
    config::load_feed(&app)
}

#[tauri::command]
async fn save_feed(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    config::save_feed(&app, &paths)
}

#[tauri::command]
async fn delete_history_logs(app: AppHandle, file_paths: Vec<String>) -> Result<(), String> {
    config::with_history_mut(&app, |history| {
        let before = history.len();
        history.retain(|r| !file_paths.contains(&r.file_path));
        history.len() != before
    })?;
    config::invalidate_history_set(&app);
    Ok(())
}

#[tauri::command]
async fn mark_log_deleted(app: AppHandle, file_path: String) -> Result<(), String> {
    // Remember the path so the watcher won't re-queue the (re-touched) source file
    // after a Feed delete. This is a FEED-ONLY guard: it must not touch History or
    // Folders, which are independent stores. (History removal was removed on purpose.)
    let mut deleted = config::load_deleted_paths(&app);
    let norm = config::normalize_path(&file_path);
    deleted.insert(norm);
    config::save_deleted_paths(&app, &deleted)
}

#[tauri::command]
async fn add_log_note(app: AppHandle, file_path: String, text: String) -> Result<(), String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Ok(());
    }
    let now = chrono::Utc::now().to_rfc3339();
    let id = format!("n{}", now.replace(['-', ':', '.'], ""));
    config::with_history_mut(&app, |history| {
        let mut found = false;
        for rec in history.iter_mut() {
            if rec.file_path == file_path {
                rec.notes.push(crate::uploader::LogNote {
                    id: id.clone(),
                    text: trimmed.clone(),
                    created_at: now.clone(),
                });
                found = true;
                break;
            }
        }
        found
    })
}

#[tauri::command]
async fn delete_log_note(app: AppHandle, file_path: String, note_id: String) -> Result<(), String> {
    config::with_history_mut(&app, |history| {
        let mut found = false;
        for rec in history.iter_mut() {
            if rec.file_path == file_path {
                rec.notes.retain(|n| n.id != note_id);
                found = true;
                break;
            }
        }
        found
    })
}

/// Toggle the favorite flag on a log record.
#[tauri::command]
async fn toggle_favorite(app: AppHandle, file_path: String) -> Result<bool, String> {
    let mut new_val = false;
    config::with_history_mut(&app, |history| {
        let mut found = false;
        for rec in history.iter_mut() {
            if rec.file_path == file_path {
                rec.is_favorite = match rec.is_favorite {
                    Some(true) => None,
                    _ => Some(true),
                };
                new_val = rec.is_favorite == Some(true);
                found = true;
                break;
            }
        }
        found
    })?;
    Ok(new_val)
}

// Re-attempt a Wingman import for a log whose automatic import failed (e.g. Wingman
// was briefly down at upload time). Persists the outcome on the record and emits an
// upload-status event so the UI badge animates in place.
#[tauri::command]
async fn retry_wingman_import(app: AppHandle, file_path: String) -> Result<(), String> {
    // Resolve the permalink + mark in-progress under the history lock, then
    // perform the (slow) network call OUTSIDE the lock. We shuttle the link out
    // via a local Cell since closures can't easily return it.
    let link_cell: std::cell::Cell<Option<String>> = std::cell::Cell::new(None);
    let resolved = config::with_history_mut(&app, |history| {
        let idx = match history.iter().position(|r| r.file_path == file_path) {
            Some(i) => i,
            None => return false,
        };
        let link = match history[idx].url.clone() {
            Some(u) => u,
            None => return false,
        };
        history[idx].wingman_status = Some("in_progress".to_string());
        let _ = app.emit("upload-status", history[idx].clone());
        link_cell.set(Some(link));
        true
    });
    if resolved.is_err() {
        return Err("history lock poisoned".into());
    }
    let permalink = match link_cell.take() {
        Some(u) => u,
        None => return Err("Log not found / no dps.report link".into()),
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let url = format!(
        "https://gw2wingman.nevermindcreations.de/api/importLogQueued?link={}",
        permalink
    );

    // Pre-check against Wingman's own queue/DB state.
    let mut known_outcome: Option<String> = None;
    let precheck_url = format!(
        "https://gw2wingman.nevermindcreations.de/api/checkLogQueuedOrDB?link={}",
        permalink
    );
    if let Ok(resp) = client.get(&precheck_url).send().await {
        if let Ok(text) = resp.text().await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if v.get("inDB").and_then(|b| b.as_bool()) == Some(true) {
                    known_outcome = Some("imported".to_string());
                } else if v.get("inQueue").and_then(|b| b.as_bool()) == Some(true) {
                    known_outcome = Some("in_progress".to_string());
                }
            }
        }
    }

    let outcome = if let Some(o) = known_outcome {
        o
    } else {
        match client.get(&url).send().await {
            Ok(resp) => {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                eprintln!(
                    "[uploader] Wingman retry status for {}: {}, body: {}",
                    permalink, status, text
                );
                if status.is_success() {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                        let success = v.get("success").and_then(|s| s.as_i64());
                        let note = v.get("note").and_then(|s| s.as_str()).unwrap_or("").to_lowercase();
                        if success == Some(0) || note.contains("already") || note.contains("in wingman") {
                            "imported".to_string()
                        } else {
                            "done".to_string()
                        }
                    } else {
                        "done".to_string()
                    }
                } else {
                    "failed".to_string()
                }
            }
            Err(e) => {
                eprintln!("[uploader] Wingman retry error for {}: {}", permalink, e);
                "failed".to_string()
            }
        }
    };

    {
        let outcome = outcome.clone();
        let path = file_path.clone();
        config::with_history_mut(&app, |history| {
            if let Some(idx) = history.iter().position(|r| r.file_path == path) {
                history[idx].wingman_status = Some(outcome.clone());
                let _ = app.emit("upload-status", history[idx].clone());
                true
            } else {
                false
            }
        })?;
    }
    Ok(())
}

// Lightweight re-check of Wingman's DB/queue state for a log that is currently
// stuck in "in_progress". Does NOT run Elite Insights or re-upload; it only
// asks Wingman whether the log is already imported or queued and flips the
// persisted status accordingly. Used by the 20s safety net and startup recovery.
#[tauri::command]
async fn verify_wingman_status(app: AppHandle, file_path: String) -> Result<(), String> {
    let config = crate::config::load_config(&app);
    if !config.wingman_enabled {
        return Ok(());
    }
    let history = crate::config::load_history(&app);
    let rec = history.iter().find(|r| r.file_path == file_path);
    let permalink = rec.and_then(|r| r.url.clone());
    let account = if !config.wingman_account.trim().is_empty() {
        config.wingman_account.clone()
    } else {
        config.wingman_accounts.first().cloned().unwrap_or_default()
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut outcome: Option<String> = None;

    if let Some(link) = permalink {
        // Link import path: ask Wingman's queue/DB.
        let precheck_url = format!(
            "https://gw2wingman.nevermindcreations.de/api/checkLogQueuedOrDB?link={}",
            link
        );
        if let Ok(resp) = client.get(&precheck_url).send().await {
            if let Ok(text) = resp.text().await {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if v.get("inDB").and_then(|b| b.as_bool()) == Some(true) {
                        outcome = Some("imported".to_string());
                    } else if v.get("inQueue").and_then(|b| b.as_bool()) == Some(true) {
                        outcome = Some("in_progress".to_string());
                    }
                }
            }
        }
        // If Wingman doesn't know, try importing by link (idempotent).
        if outcome.is_none() {
            let url = format!(
                "https://gw2wingman.nevermindcreations.de/api/importLogQueued?link={}",
                link
            );
            if let Ok(resp) = client.get(&url).send().await {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                if status.is_success() {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                        let success = v.get("success").and_then(|s| s.as_i64());
                        let note = v.get("note").and_then(|s| s.as_str()).unwrap_or("").to_lowercase();
                        if success == Some(0) || note.contains("already") || note.contains("in wingman") {
                            outcome = Some("imported".to_string());
                        } else {
                            outcome = Some("done".to_string());
                        }
                    } else {
                        outcome = Some("done".to_string());
                    }
                } else {
                    outcome = Some("failed".to_string());
                }
            } else {
                outcome = Some("failed".to_string());
            }
        }
    } else {
        // Raw upload path: pre-check by file metadata.
        let file_name = std::path::Path::new(&file_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let (file_size, file_ts) = match std::fs::metadata(&file_path) {
            Ok(m) => {
                let size = m.len();
                let ts = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                (size, ts)
            }
            Err(_) => (0, 0),
        };
        let precheck_url = format!(
            "https://gw2wingman.nevermindcreations.de/api/checkUpload?file={}&timestamp={}&filesize={}&account={}",
            file_name.replace(' ', "%20"),
            file_ts,
            file_size,
            account.replace(' ', "%20")
        );
        if let Ok(resp) = client.get(&precheck_url).send().await {
            if let Ok(text) = resp.text().await {
                let ok = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    v.as_bool().or_else(|| v.as_str().map(|s| s.eq_ignore_ascii_case("true")))
                } else {
                    let t = text.trim().to_lowercase();
                    if t == "true" { Some(true) } else if t == "false" { Some(false) } else { None }
                };
                if ok == Some(false) {
                    outcome = Some("imported".to_string());
                }
            }
        }
        // If Wingman doesn't have it, leave as in_progress (don't re-run EI here).
        if outcome.is_none() {
            outcome = Some("in_progress".to_string());
        }
    }

    if let Some(o) = outcome {
        let path = file_path.clone();
        let _ = crate::config::with_history_mut(&app, |history| {
            if let Some(idx) = history.iter().position(|r| r.file_path == path) {
                history[idx].wingman_status = Some(o.clone());
                let _ = app.emit("upload-status", history[idx].clone());
                true
            } else {
                false
            }
        });
    }
    Ok(())
}
// local Elite Insights to produce the JSON+HTML bundle and upload that to
// Wingman via /api/uploadProcessed instead of importing by dps.report link.
#[tauri::command]
async fn retry_wingman_raw_upload(app: AppHandle, file_path: String) -> Result<(), String> {
    wingman_raw_upload(app, file_path).await
}

pub async fn wingman_raw_upload(app: AppHandle, file_path: String) -> Result<(), String> {
    // WvW logs are excluded from Wingman (no raw upload).
    {
        let fp = file_path.clone();
        let mut is_wvw = false;
        let _ = crate::config::with_history_mut(&app, |history| {
            if let Some(rec) = history.iter().find(|r| r.file_path == fp) {
                is_wvw = rec.is_wvw == Some(true);
            }
            false
        });
        if is_wvw {
            return Err("WvW logs are not uploaded to Wingman.".into());
        }
    }
    let config = crate::config::load_config(&app);
    if !config.wingman_enabled {
        return Err("Wingman is disabled in settings.".into());
    }
    let account = if !config.wingman_account.trim().is_empty() {
        config.wingman_account.clone()
    } else {
        config.wingman_accounts.first().cloned().unwrap_or_default()
    };

    // Mark in-progress.
    {
        let fp = file_path.clone();
        let _ = crate::config::with_history_mut(&app, |history| {
            if let Some(idx) = history.iter().position(|r| r.file_path == fp) {
                history[idx].wingman_status = Some("in_progress".to_string());
                let _ = app.emit("upload-status", history[idx].clone());
                true
            } else {
                false
            }
        });
    }

    // Run EI to produce JSON+HTML (blocking), with a 5-minute timeout.
    // Acquire a global parse permit so bulk uploads don't spawn unbounded
    // concurrent Elite Insights processes (each is a heavy .NET process).
    let _permit = crate::ei_semaphore().acquire().await.map_err(|e| e.to_string())?;
    let app_clone = app.clone();
    let fp_clone = file_path.clone();
    let bundle = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        tauri::async_runtime::spawn_blocking(move || {
            let _lock = crate::ei_lock_for(std::path::Path::new(&fp_clone));
            let _guard = _lock.lock().unwrap();
            crate::ei_runner::run_ei_wingman_bundle(&app_clone, std::path::Path::new(&fp_clone))
        }),
    )
    .await;
    let bundle = match bundle {
        Ok(Ok(b)) => b,
        Ok(Err(e)) => {
            set_wingman_status(&app, &file_path, "failed");
            return Err(format!("EI task panicked: {}", e));
        }
        Err(_) => {
            set_wingman_status(&app, &file_path, "failed");
            return Err("EI timed out after 5 minutes".into());
        }
    };

    let (json_path, html_path) = match bundle {
        Ok(b) => b,
        Err(e) => {
            set_wingman_status(&app, &file_path, "failed");
            return Err(e);
        }
    };

    // Decompress JSON if gzipped
    let mut json_path = json_path;
    if json_path.to_string_lossy().ends_with(".json.gz") {
        let out = json_path.with_extension("").with_extension("json");
        if let Ok(gz) = std::fs::read(&json_path) {
            use std::io::Read;
            let mut decoder = flate2::read::GzDecoder::new(&gz[..]);
            let mut s = String::new();
            if decoder.read_to_string(&mut s).is_ok() {
                let _ = std::fs::write(&out, s);
                json_path = out;
            }
        }
    }

    // File metadata for the pre-check.
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let (file_size, file_ts) = match std::fs::metadata(&file_path) {
        Ok(m) => {
            let size = m.len();
            let ts = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (size, ts)
        }
        Err(_) => (0, 0),
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    // Pre-check duplicates.
    let precheck_url = format!(
        "https://gw2wingman.nevermindcreations.de/api/checkUpload?file={}&timestamp={}&filesize={}&account={}",
        file_name.replace(' ', "%20"),
        file_ts,
        file_size,
        account.replace(' ', "%20")
    );
    let mut known_outcome: Option<String> = None;
    if let Ok(resp) = client.get(&precheck_url).send().await {
        if let Ok(text) = resp.text().await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                // checkUpload returns "True"/"False"/"Error" as strings or booleans
                let ok = v.as_bool().or_else(|| {
                    v.as_str().map(|s| s.eq_ignore_ascii_case("true"))
                });
                if ok == Some(false) {
                    // Already exists or not uploadable
                    known_outcome = Some("imported".to_string());
                }
            } else {
                let t = text.trim().to_lowercase();
                if t == "false" {
                    known_outcome = Some("imported".to_string());
                }
            }
        }
    }

    let outcome = if let Some(o) = known_outcome {
        o
    } else {
        // Upload
        let raw_bytes = std::fs::read(&file_path).unwrap_or_default();
        let json_bytes = std::fs::read(&json_path).unwrap_or_default();
        let html_bytes = std::fs::read(&html_path).unwrap_or_default();

        let part_file = reqwest::multipart::Part::bytes(raw_bytes)
            .file_name(file_name.clone())
            .mime_str("application/octet-stream")
            .unwrap();
        let part_json = reqwest::multipart::Part::bytes(json_bytes)
            .file_name(json_path.file_name().unwrap_or_default().to_string_lossy().to_string())
            .mime_str("application/json")
            .unwrap();
        let part_html = reqwest::multipart::Part::bytes(html_bytes)
            .file_name(html_path.file_name().unwrap_or_default().to_string_lossy().to_string())
            .mime_str("text/html")
            .unwrap();

        let form = reqwest::multipart::Form::new()
            .part("file", part_file)
            .part("jsonfile", part_json)
            .part("htmlfile", part_html)
            .text("account", account.clone());

        match client
            .post("https://gw2wingman.nevermindcreations.de/uploadProcessed")
            .multipart(form)
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                eprintln!("[uploader] Wingman raw upload status: {}, body: {}", status, text);
                if status.is_success() {
                    "imported".to_string()
                } else {
                    "failed".to_string()
                }
            }
            Err(e) => {
                eprintln!("[uploader] Wingman raw upload error: {}", e);
                "failed".to_string()
            }
        }
    };

    // Cleanup generated files.
    let _ = std::fs::remove_file(&json_path);
    let _ = std::fs::remove_file(&html_path);

    set_wingman_status(&app, &file_path, &outcome);
    Ok(())
}

fn set_wingman_status(app: &AppHandle, file_path: &str, status: &str) {
    let outcome = status.to_string();
    let path = file_path.to_string();
    let _ = crate::config::with_history_mut(app, |history| {
        if let Some(idx) = history.iter().position(|r| r.file_path == path) {
            history[idx].wingman_status = Some(outcome.clone());
            let _ = app.emit("upload-status", history[idx].clone());
            true
        } else {
            false
        }
    });
    // Rotating audit log (D1): append terminal outcomes.
    if status == "failed" || status == "imported" || status == "done" {
        let _ = append_audit_log(app, &format!(r#"{{"file_path":"{}","status":"{}","ts":{}}}"#, file_path, status, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)));
    }
}

fn append_audit_log(app: &AppHandle, line: &str) -> Result<(), String> {
    use std::io::Write;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).ok();
    let p = dir.join("upload_audit.jsonl");
    // Rotate if > 10MB
    if let Ok(meta) = std::fs::metadata(&p) {
        if meta.len() > 10 * 1024 * 1024 {
            let rotated = dir.join("upload_audit.1.jsonl");
            let _ = std::fs::rename(&p, &rotated);
        }
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&p).map_err(|e| e.to_string())?;
    writeln!(f, "{}", line).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_vl_rank_catalog() -> &'static [crate::vl_ranks::VlEncounter] {
    crate::vl_ranks::catalog()
}

// Merge a single rank id into a log's rank set. `add=true` inserts (deduped),
// `add=false` removes it; an empty set normalizes to None. Module-level so the
// #[cfg(test)] suite can exercise it directly.
fn merge_vl_rank(existing: Option<Vec<String>>, rid: &str, add: bool) -> Option<Vec<String>> {
    let mut set: Vec<String> = existing
        .unwrap_or_default()
        .into_iter()
        .filter(|r| r != rid)
        .collect();
    if add {
        set.push(rid.to_string());
    }
    if set.is_empty() {
        None
    } else {
        Some(set)
    }
}

#[tauri::command]
async fn set_vl_ranks(
    app: AppHandle,
    file_path: String,
    rank_id: String,
    add: bool,
) -> Result<(), String> {
    let rid = rank_id.trim();
    if rid.is_empty() || rid == "none" {
        return Err("Rank id required".into());
    }

    // A log can live in history (Feed/History) AND/OR in config sessions
    // (Folders/Subfolders). Once its Feed copy is deleted it may exist ONLY in a
    // folder, so we must patch both stores and only fail if it's in neither.
    let config = config::load_config(&app);

    // Resolve the boss name from wherever the record currently lives (for rank
    // validation) — history first, then any session/subfolder copy.
    let hist_snapshot = config::load_history(&app);
    let boss = hist_snapshot
        .iter()
        .find(|r| r.file_path == file_path)
        .or_else(|| {
            config.sessions.iter().find_map(|s| {
                s.logs
                    .iter()
                    .find(|r| r.file_path == file_path)
                    .or_else(|| {
                        s.subfolders.as_ref().and_then(|subs| {
                            subs.iter()
                                .find_map(|sf| sf.logs.iter().find(|r| r.file_path == file_path))
                        })
                    })
            })
        })
        .map(|r| {
            r.boss_name
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .replace(|c: char| !c.is_ascii_alphanumeric(), "")
        });

    let Some(boss) = boss else {
        return Err("Log not found".into());
    };
    if !crate::vl_ranks::rank_is_valid(&boss, rid) {
        return Err(format!("Rank '{}' is not valid for this encounter", rid));
    }

    // Apply to history.json under the serialized history lock (RMW race guard).
    let path = file_path.clone();
    let rank = rid.to_string();
    config::with_history_mut(&app, |history| {
        let mut changed = false;
        for rec in history.iter_mut().filter(|r| r.file_path == path) {
            rec.vl_rank = merge_vl_rank(rec.vl_rank.clone(), &rank, add);
            changed = true;
        }
        changed
    })?;

    // Apply to config (Folders + Subfolders store) outside the history lock —
    // config has no concurrent writer, so no race there.
    let mut config = config;
    let mut cfg_changed = false;
    for session in config.sessions.iter_mut() {
        for rec in session.logs.iter_mut().filter(|r| r.file_path == file_path) {
            rec.vl_rank = merge_vl_rank(rec.vl_rank.clone(), rid, add);
            cfg_changed = true;
        }
        if let Some(subs) = session.subfolders.as_mut() {
            for sf in subs.iter_mut() {
                for rec in sf.logs.iter_mut().filter(|r| r.file_path == file_path) {
                    rec.vl_rank = merge_vl_rank(rec.vl_rank.clone(), rid, add);
                    cfg_changed = true;
                }
            }
        }
    }
    if cfg_changed {
        config::save_config(&app, &config)?;
    }

    // NOTE: intentionally do NOT emit `upload-status` here. That channel is the
    // upload-completion event the frontend uses to *add logs to the feed*; emitting
    // it for a rank change would re-surface a Folders/Subfolder log back into the
    // Uploads Feed. The frontend refreshes the badge in-place after this returns.
    Ok(())
}

// ─── Export / Import config + sessions (Settings → Data & Portability) ──────────
#[tauri::command]
async fn export_config(app: AppHandle) -> Result<String, String> {
    let config = config::load_config(&app);
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    rfd::AsyncFileDialog::new()
        .set_title("Export Portal Protocol settings")
        .add_filter("JSON", &["json"])
        .set_file_name("portal-protocol-settings.json")
        .save_file()
        .await
        .map(|p| p.path().to_string_lossy().to_string())
        .ok_or_else(|| "Export cancelled".to_string())
        .and_then(|path| {
            std::fs::write(&path, json).map_err(|e| format!("Write failed: {}", e))?;
            Ok(path)
        })
}

#[tauri::command]
async fn import_config(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let picked = rfd::AsyncFileDialog::new()
        .set_title("Import Portal Protocol settings")
        .add_filter("JSON", &["json"])
        .pick_file()
        .await;
    let path = match picked {
        Some(p) => p.path().to_string_lossy().to_string(),
        None => return Err("Import cancelled".to_string()),
    };
    let content = std::fs::read_to_string(&path).map_err(|e| format!("Read failed: {}", e))?;
    let imported: config::AppConfig =
        serde_json::from_str(&content).map_err(|e| format!("Not a valid settings file: {}", e))?;
    // Persist, re-sync autostart + watcher.
    config::save_config(&app, &imported)?;
    let _ = set_autostart(imported.autostart);
    match state.watcher.lock() {
        Ok(mut watcher) => {
            if imported.auto_upload && !imported.logs_directory.is_empty() {
                watcher.start(
                    &imported.logs_directory,
                    state.upload_tx.clone(),
                    imported.watch_stability_delay_ms,
                    imported.watch_poll_interval_ms,
                )?;
            } else {
                watcher.stop();
            }
        }
        Err(_) => { /* poisoned — skip watcher resync, non-fatal */ }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Set up mpsc channels for the uploader queue. `tx`/`rx` is the auto (watcher)
    // channel; `manual_tx`/`manual_rx` carries user-initiated uploads (drag-drop,
    // folder picker, explicit re-upload) so they can bypass the min-time auto-skip.
    let (tx, rx) = tokio::sync::mpsc::channel::<PathBuf>(100);
    let (manual_tx, manual_rx) = tokio::sync::mpsc::channel::<PathBuf>(100);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_window_state::Builder::new().build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEMwMkQxN0E4NjdGMjk5MTIKUldRU21mSm5xQmN0d09BRHhDM1FmTDlZbGtxUlRFNElCRldNTkVVYWNuODN4SmRNVXZKa21RYkIK")
                .build(),
        )
        .setup(move |app| {
            // CRASH DIAGNOSTICS (2026-07-27): capture any panic to
            // %LOCALAPPDATA%/Portal Protocol/crash.log so a full-process abort
            // during uploads is never silent again.
            install_panic_logger();

            let app_handle = app.handle().clone();
            // Capture a global handle so sync code (e.g. the dps.report outage flag
            // flip) can spawn async recovery work without threading an AppHandle through.
            crate::uploader::set_app_handle(app_handle.clone());
            crate::uploader::set_manual_tx(manual_tx.clone());

            // Spawn the tokio background loop for uploads. `rx` is the auto (watcher)
            // channel; `manual_rx` is the user-initiated (drag/picker) channel. Both
            // are drained by the same loop so manual uploads bypass the min-time ban.
            tauri::async_runtime::spawn(async move {
                uploader::start_upload_loop(app_handle, rx, manual_rx).await;
            });

            // One-time, non-blocking self-heal: re-derive CM/LCM flags in history.json
            // for pre-fix uploads that baked wrong values (e.g. dps.report names Temple
            // of Febe "Cerus"). Uses dps.report as source of truth; no-op once converged.
            let repair_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                uploader::repair_history_cm_flags(repair_handle).await;
            });

            // One-time self-heal: fix pre-fix VL rank auto-awards (a Legendary CM kill
            // was wrongly tagged with the plain "Conqueror" rank). No-op once converged.
            let vl_repair_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                uploader::repair_history_vl_ranks(vl_repair_handle).await;
            });

            // One-time self-heal: fetch group DPS for pre-existing Kitty Golem logs
            // so the DMG badge is populated without re-uploading them. No-op once done.
            let dps_repair_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                uploader::repair_history_group_dps(dps_repair_handle).await;
            });

            // One-time self-heal: re-classify pre-fix story logs stored under the
            // "Encounter <mapid>" fallback so they land in Personal Story. No-op once converged.
            let story_repair_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                uploader::repair_history_story_classification(story_repair_handle).await;
            });

            // Disabled: repair_history_incorrect_cm_flags was scanning every log on launch.
            // The repair was intended only for Quick Play Strikes/Fractals that reported Normal
            // mode, but it also processed all CM/LCM and convergence logs unnecessarily, causing
            // the self-heal banner to fire every launch and producing incorrect mode badges.
            // CM/LCM flags are already correctly set by repair_history_cm_flags and other
            // dedicated passes; Quick Play detection happens on upload.

            // One-time self-heal: re-derive Cerus Empowered-stack counts + the Petrified
            // rank with the corrected parser (pulls above 50% must NOT earn Petrified).
            // Strips any wrongly-awarded Petrified and re-adds only genuine <=50% reaches.
            // No-op once converged.
            let cerus_repair_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                uploader::repair_history_cerus_empowered_stacks(cerus_repair_handle).await;
            });

            // One-time self-heal: re-check any record parked in "Processing" at launch so a
            // stuck-forever log gets a fresh deferred EI re-check (closes the stuck-Processing gap).

            // Initialize watcher
            let mut watcher = LogWatcher::new();

            // Load config and automatically start watching/autostart setup
            let config = config::load_config(app.handle());
            // A1: restore any webhook recovery queue persisted before a mid-outage
            // restart, so queued posts drain once dps.report is back.
            crate::uploader::load_webhook_recovery(app.handle());
            // Populate the in-memory history file-path set from the persisted history.json
            // so that `already_in_history()` can do an O(1) contains check instead of
            // loading the full 2000+ record history from disk on every watcher detection.
            crate::config::load_history_into_set(app.handle());
            if config.auto_upload && !config.logs_directory.is_empty() {
                let _ = watcher.start(&config.logs_directory, tx.clone(), config.watch_stability_delay_ms, config.watch_poll_interval_ms);
                let cleanup_dir = config.logs_directory.clone();
                tauri::async_runtime::spawn(async move {
                    crate::ei_runner::cleanup_leftover_ei_files(std::path::Path::new(&cleanup_dir));
                });
            }

            // Start minimized to the system tray if enabled (window hidden until summoned).
            if config.hide_on_startup {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            // Sync autostart status on startup
            let _ = set_autostart(config.autostart);

            // Update native window title with app version
            if let Some(window) = app.get_webview_window("main") {
                let version = app.package_info().version.to_string();
                let _ = window.set_title(&format!("Portal Protocol - v{version}"));
            }

            // Set up System Tray Menu
            let show_item = tauri::menu::MenuItem::with_id(app, "show", "Show App", true, None::<&str>)?;
            let quit_item = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("no window icon"))
                .tooltip("Portal Protocol")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Register global AppState state
            app.manage(AppState {
                watcher: Arc::new(Mutex::new(watcher)),
                upload_tx: tx,
                manual_tx,
            });

            Ok(())
        })
        .on_window_event(|window, event| if let WindowEvent::CloseRequested { .. } = event {
            // Stop the file watcher so its background thread + open file handles
            // are released when the app exits (not just dropped on the floor).
            // Poison-tolerant: a poisoned Mutex (from a panic elsewhere) must NOT
            // panic HERE on the main thread — that would abort the whole process.
            {
                let state = window.state::<AppState>();
                let guard = state.watcher.lock();
                if let Ok(mut w) = guard {
                    w.stop();
                }
            }
            // Default behavior: close the window and exit the app entirely
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_watcher_status,
            stop_watcher,
            trigger_manual_upload,
            update_log_status,
            save_error_report,
            pick_log_files,
            check_dps_report_status,
            check_backup_dps_status,
            check_wingman_status,
            sweep_dps_processing,
            get_history_count,
            get_history_page,
            clear_history,
            crate::uploader::backfill_dps_history,
            crate::uploader::pause_backfill,
            crate::uploader::resume_backfill,
            crate::uploader::cancel_backfill,
            crate::uploader::get_backfill_status,
            crate::uploader::pause_uploads,
            crate::uploader::resume_uploads,
            crate::uploader::cancel_upload,
            crate::uploader::retry_upload,
            crate::uploader::get_upload_queue,
            delete_history_log,
            get_feed,
            save_feed,
            delete_history_logs,
            mark_log_deleted,
            open_in_explorer,
            open_settings_folder,
            reset_window_state,
            add_log_note,
            delete_log_note,
            retry_wingman_import,
            verify_wingman_status,
            retry_wingman_raw_upload,
            toggle_favorite,
            get_vl_rank_catalog,
            set_vl_ranks,
            export_config,
            import_config,
            parse_local_revealed_sources,
            load_stats_cache,
            store_stats_cache,
            run_local_ei_parse,
            crate::uploader::get_log_full,
            crate::uploader::get_local_log_full,
            crate::uploader::get_cache_size,
            crate::uploader::clear_log_cache,
            crate::uploader::prune_log_cache,
            crate::uploader::invalidate_log_cache,
            crate::uploader::get_history_cache_size,
            crate::uploader::clear_history_cache,
            crate::uploader::test_webhook,
            crate::uploader::read_webhook_log,
            crate::uploader::resend_failed_webhooks,
            crate::ei_runner::check_ei_runtime,
            check_bundled_ei,
            crate::ei_runner::open_ei_html_report,
            crate::ei_runner::clear_ei_html_cache,
            crate::ei_runner::get_ei_html_cache_info,
            crate::ei_runner::prune_ei_html_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_vl_rank_add_to_empty() {
        assert_eq!(
            merge_vl_rank(None, "conqueror", true),
            Some(vec!["conqueror".to_string()])
        );
    }

    #[test]
    fn merge_vl_rank_add_second_retains_first() {
        let set = merge_vl_rank(Some(vec!["conqueror".to_string()]), "petrified", true);
        let mut v = set.unwrap();
        v.sort();
        assert_eq!(v, vec!["conqueror".to_string(), "petrified".to_string()]);
    }

    #[test]
    fn merge_vl_rank_remove_leaves_others() {
        let set = merge_vl_rank(
            Some(vec!["conqueror".to_string(), "petrified".to_string()]),
            "conqueror",
            false,
        );
        assert_eq!(set, Some(vec!["petrified".to_string()]));
    }

    #[test]
    fn merge_vl_rank_remove_last_clears() {
        assert_eq!(
            merge_vl_rank(Some(vec!["conqueror".to_string()]), "conqueror", false),
            None
        );
    }

    #[test]
    fn merge_vl_rank_no_duplicate() {
        let set = merge_vl_rank(Some(vec!["conqueror".to_string()]), "conqueror", true);
        assert_eq!(set, Some(vec!["conqueror".to_string()]));
    }

    // Minimal shell that exercises ONLY the `vl_rank` (de)serialization logic,
    // independent of the full UploadRecord field set.
    #[derive(serde::Deserialize)]
    struct VlRankOnly {
        #[serde(default, deserialize_with = "crate::uploader::deserialize_vl_rank")]
        vl_rank: Option<Vec<String>>,
    }

    #[test]
    fn deserialize_vl_rank_migrates_old_string() {
        // Old single-string shape -> normalized to a one-element vec.
        let json = r#"{"vl_rank":"conqueror"}"#;
        let rec: VlRankOnly = serde_json::from_str(json).unwrap();
        assert_eq!(rec.vl_rank, Some(vec!["conqueror".to_string()]));
    }

    #[test]
    fn deserialize_vl_rank_accepts_new_array() {
        let json = r#"{"vl_rank":["conqueror","petrified"]}"#;
        let rec: VlRankOnly = serde_json::from_str(json).unwrap();
        let mut v = rec.vl_rank.unwrap();
        v.sort();
        assert_eq!(v, vec!["conqueror".to_string(), "petrified".to_string()]);
    }

    #[test]
    fn deserialize_vl_rank_null_is_none() {
        let json = r#"{"vl_rank":null}"#;
        let rec: VlRankOnly = serde_json::from_str(json).unwrap();
        assert_eq!(rec.vl_rank, None);
    }
}
