// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

/// Process-wide guard for history.json read-modify-write sequences.
///
/// ~10 call sites (Tauri command handlers in lib.rs + upload tasks in uploader.rs)
/// each do `load_history() -> mutate -> save_history()`. They run as *separate*
/// concurrent tokio tasks, so two of them can read the same snapshot, mutate
/// independently, and the second `save_history` clobbers the first's change — a
/// classic lost-update race. This Mutex serializes the whole RMW so a concurrent
/// upload's status write can never drop a Wingman-rank edit (or vice-versa).
///
/// It lives here (not in AppState) because uploader.rs tasks don't hold an
/// AppState reference — both call sites grab the same global lock.
static HISTORY_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();

fn history_lock() -> &'static std::sync::Mutex<()> {
    HISTORY_LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

/// Run `f` on a freshly-loaded history, then persist the (mutated) result — all
/// under HISTORY_LOCK so no other task can interleave its own RMW. `f` returns
/// `false` to skip the save (e.g. when the target record wasn't found).
pub fn with_history_mut<F>(app: &AppHandle, f: F) -> Result<(), String>
where
    F: FnOnce(&mut Vec<crate::uploader::UploadRecord>) -> bool,
{
    let _guard = history_lock()
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    let mut history = load_history(app);
    if f(&mut history) {
        save_history(app, &history)?;
    }
    Ok(())
}

/// Atomically write `contents` to `path`: write to a sibling `.tmp` file, flush+fsync,
/// then rename over the target. `std::fs::rename` on Windows uses MoveFileExW with
/// MOVEFILE_REPLACE_EXISTING, so the swap is atomic — a crash mid-write leaves EITHER
/// the old file intact OR the new one, never a half-written/truncated JSON. Prevents
/// history.json/config.json corruption if the app is killed during a save.
pub fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension(format!(
        "tmp.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(contents).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
        let _ = f.sync_all();
    }
    // Antivirus programs / search indexers on Windows frequently lock newly created
    // temp files for scanning, causing `fs::rename` to fail with sharing violations.
    // Try up to 5 times with a 50ms delay to let any scanning/indexing finish.
    let mut attempts = 0;
    loop {
        match fs::rename(&tmp, path) {
            Ok(_) => break,
            Err(e) => {
                attempts += 1;
                if attempts >= 5 {
                    let _ = fs::remove_file(&tmp);
                    return Err(format!(
                        "Failed to rename tmp file to destination after 5 attempts: {}",
                        e
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSubFolder {
    pub id: String,
    pub name: String,
    pub color: String,
    pub logs: Vec<crate::uploader::UploadRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSession {
    pub id: String,
    pub name: String,
    pub color: String,
    pub logs: Vec<crate::uploader::UploadRecord>,
    #[serde(default)]
    pub subfolders: Option<Vec<SavedSubFolder>>,
}

/// A single slot in a planned squad composition (Squad Planner tab).
/// camelCase on-disk to match the TS model (professionId / eliteSpecId / playerName).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadPlanSlot {
    pub id: String,
    #[serde(default)]
    pub profession_id: Option<u32>,
    #[serde(default)]
    pub elite_spec_id: Option<u32>,
    #[serde(default)]
    pub roles: Vec<String>,
    #[serde(default)]
    pub player_name: Option<String>,
}

/// A GW2 subgroup (always 5 slots in the planner UI).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadPlanSubgroup {
    pub id: String,
    pub slots: Vec<SquadPlanSlot>,
}

/// A saved squad composition (Squad Planner tab). Folders carry `children`;
/// rosters carry `subgroups`. camelCase on-disk to match the TS model.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadPlan {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: String, // "folder" | "roster"
    #[serde(default)]
    pub encounter_tag: Option<String>,
    #[serde(default)]
    pub banner: Option<String>,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub accent: Option<String>,
    pub subgroups: Vec<SquadPlanSubgroup>,
    #[serde(default)]
    pub children: Vec<SquadPlan>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub logs_directory: String,
    pub dps_report_token: String,
    /// Legacy single webhook URL (kept for backward-compatible loading only).
    /// New UI writes to `discord_webhooks`; this is migrated into that list on load.
    #[serde(default)]
    pub discord_webhook: String,
    /// All configured Discord webhooks. Each posts (independently) on upload.
    #[serde(default)]
    pub discord_webhooks: Vec<DiscordWebhook>,
    pub auto_upload: bool,
    pub autostart: bool,
    pub sound_notifications: bool,
    pub desktop_notifications: bool,
    pub sessions: Vec<SavedSession>,
    #[serde(default)]
    pub wingman_enabled: bool,
    #[serde(default)]
    pub wingman_account: String,
    /// When false (default), WvW logs (arcdps boss_id == 1) are never read or
    /// detected — the app stays PvE-focused. When true, WvW logs appear as their
    /// own "World vs World" group, excluded from Wingman uploads.
    #[serde(default)]
    pub wvw_enabled: bool,
    /// Max uploads processed concurrently. 0 = unbounded.
    #[serde(default)]
    pub max_concurrent_uploads: usize,
    /// Wait this many ms after a .evtc/.zevtc write settles before reading it,
    /// debouncing against ArcDPS partial writes. Default 500 (legacy behaviour).
    #[serde(default = "default_stability_delay")]
    pub watch_stability_delay_ms: u64,
    /// Retries for transient dps.report failures (5xx / network). Total attempts
    /// = 1 (initial) + max_upload_retries. Default 3 (was hardcoded 2).
    #[serde(default = "default_upload_retries")]
    pub max_upload_retries: u32,
    /// Skip logs shorter than this many seconds (instant wipes / fast /gg).
    /// 0 = disabled (never skip on duration).
    #[serde(default)]
    pub min_log_seconds: f64,
    /// Max number of parsed-log cache files kept on disk (the "dps.report Log
    /// Cache" shown in Settings). Oldest are evicted beyond this. Bounds disk
    /// growth from the Stats-button fast-load store. 0 = unbounded (legacy).
    #[serde(default = "default_log_cache_max_files")]
    pub log_cache_max_files: usize,
    /// Disable UI animations (accessibility / low-end).
    #[serde(default)]
    pub reduce_motion: bool,
    /// Start minimized to the system tray (window hidden until summoned).
    #[serde(default)]
    pub hide_on_startup: bool,
    /// UI accent color hex (no leading #). Drives --accent / --accent-h CSS vars.
    #[serde(default)]
    pub accent: String,
    /// Fallback to dps.report's backup domain `b.dps.report` when the primary is
    /// confirmed down. ON by default; when off, an outage parks logs as On Hold
    /// instead of routing to the backup.
    #[serde(default = "default_use_backup_dps")]
    pub use_backup_dps: bool,
    /// Compact UI mode (tighter card density, smaller fonts).
    #[serde(default)]
    pub compact_mode: bool,
    /// Selected UI font theme option
    #[serde(default = "default_app_font")]
    pub app_font: String,
    /// Whether the left sidebar is open. Persisted so restart restores the user's choice.
    #[serde(default = "default_sidebar_open")]
    pub app_sidebar_open: bool,
    /// Configured GW2 API accounts for tracking clears.
    #[serde(default)]
    pub gw2_accounts: Vec<Gw2Account>,
    /// Saved squad compositions from the Squad Planner tab.
    #[serde(default)]
    pub squad_plans: Vec<SquadPlan>,
}

fn default_app_font() -> String {
    "inter-outfit".to_string()
}

/// Default log-cache retention (matches the old hard-coded cap).
fn default_log_cache_max_files() -> usize {
    50
}

fn default_sidebar_open() -> bool {
    true
}

/// A Guild Wars 2 account API key record.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Gw2Account {
    pub name: String,
    pub api_key: String,
}

/// A single Discord incoming webhook (Phase 0: multi-webhook support).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DiscordWebhook {
    pub id: String,
    /// User-facing label shown in the settings list (e.g. "Raid kills").
    #[serde(default)]
    pub label: String,
    pub url: String,
    /// When false, this webhook is skipped on upload.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Routing filters (Phase 2A). An empty `filters` means "post everything".
    /// When non-empty, ALL set filters must match for the log to post here.
    /// `outcomes` is OR'd internally (kill OR wipe OR both).
    #[serde(default)]
    pub filters: WebhookFilters,
    /// Structured role pings (Tier D). Each entry is a friendly `label` plus a
    /// Discord `token` (e.g. `<@&ROLEID>`, `<@USERID>`, `@everyone`, `@here`, or
    /// raw text). All non-empty tokens are joined (space-separated) into the
    /// post `content` so Discord renders every ping. Empty = no mention.
    #[serde(default)]
    pub mention_roles: Vec<WebhookRole>,
    /// Legacy single mention string (Phase 2B). Retained ONLY for backward-compatible
    /// loading: if a stored webhook has `mention` set but no `mention_roles`, it is
    /// migrated into one `WebhookRole` on load (see `load_config`). New UI writes
    /// `mention_roles`; this field is ignored on read once migrated.
    #[serde(default)]
    pub mention: Option<String>,
    /// Optional Discord thread id (phase 2C: thread targeting). When set, the
    /// post is appended with `?thread_id=<id>` so it lands inside that thread
    /// instead of the channel root. `None`/empty = post to channel root.
    #[serde(default)]
    pub thread_id: Option<String>,
}

/// A single named Discord ping (Tier D). `label` is the user's friendly name
/// (e.g. "Raid pings"); `token` is the raw Discord token that becomes `content`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WebhookRole {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub token: String,
}

/// Per-webhook routing filters (Phase 2A). Each populated field narrows the
/// set of logs this webhook receives. `None` = no constraint on that axis.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WebhookFilters {
    /// Limit to specific encounter kinds. None | empty = any kind.
    #[serde(default)]
    pub kinds: Vec<EncounterKind>,
    /// Limit to outcomes. None | empty = any outcome (wipe or kill).
    #[serde(default)]
    pub outcomes: Vec<EncounterOutcome>,
    /// Only CM runs (true), only non-CM (false), or any (None).
    #[serde(default)]
    pub only_cm: Option<bool>,
    /// Only LCM runs (true), or any (None).
    #[serde(default)]
    pub only_lcm: Option<bool>,
    /// Only post these exact boss names (cleaned form, e.g. "ura").
    /// None | empty = any boss.
    #[serde(default)]
    pub bosses: Vec<String>,
}

/// High-level GW2 encounter category, derived from the same signals the app
/// already uses for embeds (raid/strike/fractal/convergence/golem).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EncounterKind {
    Raid,
    Strike,
    Fractal,
    Convergence,
    /// Kitty Golem (Special Forces Training Area) — benchmark/dummy logs.
    Golem,
}

/// Upload outcome for routing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EncounterOutcome {
    Kill,
    Wipe,
}

fn default_true() -> bool {
    true
}

fn default_stability_delay() -> u64 {
    500
}
fn default_upload_retries() -> u32 {
    3
}
fn default_use_backup_dps() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        // Fallback default path for Windows
        let default_path = if cfg!(target_os = "windows") {
            if let Some(proj_dirs) = directories::UserDirs::new() {
                proj_dirs
                    .document_dir()
                    .map(|d| {
                        d.join("Guild Wars 2")
                            .join("addons")
                            .join("arcdps")
                            .join("arcdps.cbtlogs")
                    })
                    .unwrap_or_else(|| PathBuf::from("C:\\"))
            } else {
                PathBuf::from("C:\\")
            }
        } else {
            // Linux path fallback (Proton)
            if let Some(home_dir) = directories::BaseDirs::new().map(|b| b.home_dir().to_path_buf())
            {
                home_dir.join(".steam/steam/steamapps/compatdata/228200/pfx/drive_c/users/steamuser/Documents/Guild Wars 2/addons/arcdps/arcdps.cbtlogs")
            } else {
                PathBuf::from("/")
            }
        };

        Self {
            logs_directory: default_path.to_string_lossy().to_string(),
            dps_report_token: String::new(),
            discord_webhook: String::new(),
            discord_webhooks: Vec::new(),
            auto_upload: true,
            autostart: false,
            sound_notifications: true,
            desktop_notifications: true,
            sessions: Vec::new(),
            wingman_enabled: false,
            wingman_account: String::new(),
            wvw_enabled: false,
            max_concurrent_uploads: 2,
            watch_stability_delay_ms: default_stability_delay(),
            max_upload_retries: default_upload_retries(),
            min_log_seconds: 0.0,
            log_cache_max_files: default_log_cache_max_files(),
            reduce_motion: false,
            hide_on_startup: false,
            accent: String::new(),
            use_backup_dps: true,
            compact_mode: false,
            app_font: default_app_font(),
            app_sidebar_open: default_sidebar_open(),
            gw2_accounts: Vec::new(),
            squad_plans: Vec::new(),
        }
    }
}

/// Returns the full path to config.json in the OS app config directory.
pub fn get_config_path(app: &AppHandle) -> PathBuf {
    let mut config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    // Ensure directory exists
    let _ = fs::create_dir_all(&config_dir);
    config_dir.push("config.json");
    config_dir
}

/// Directory holding config.json, history.json, deleted_paths.json, etc.
pub fn get_config_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Load AppConfig from disk. Returns defaults if the file is missing or corrupt — never overwrites disk on parse failure.
pub fn load_config(app: &AppHandle) -> AppConfig {
    let path = get_config_path(app);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(mut config) = serde_json::from_str::<AppConfig>(&content) {
                // Migrate legacy single webhook → list (Phase 0, idempotent).
                if config.discord_webhooks.is_empty() && !config.discord_webhook.trim().is_empty() {
                    let ts = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis())
                        .unwrap_or(0);
                    config.discord_webhooks.push(DiscordWebhook {
                        id: format!("wh_{}", ts),
                        label: String::new(),
                        url: config.discord_webhook.trim().to_string(),
                        enabled: true,
                        filters: crate::config::WebhookFilters::default(),
                        mention_roles: Vec::new(),
                        mention: None,
                        thread_id: None,
                    });
                    // Persist the migrated form so future loads don't re-seed.
                    let _ = save_config(app, &config);
                }
                // Migrate legacy single `mention` → structured `mention_roles` (Tier D).
                // Idempotent: only fires when a webhook has the old string but no roles yet.
                let mut migrated = false;
                for wh in config.discord_webhooks.iter_mut() {
                    if wh.mention_roles.is_empty() {
                        if let Some(m) = wh.mention.as_ref() {
                            let m = m.trim().to_string();
                            if !m.is_empty() {
                                wh.mention_roles.push(WebhookRole {
                                    label: "Mention".to_string(),
                                    token: m,
                                });
                                migrated = true;
                            }
                        }
                    }
                    // Always clear the legacy field once roles drive the payload.
                    if wh.mention.is_some() {
                        wh.mention = None;
                        migrated = true;
                    }
                }
                if migrated {
                    let _ = save_config(app, &config);
                }
                return config;
            }
        }
    }
    // If not exists or error, return default config WITHOUT overwriting disk.
    // Writing back a default config would silently wipe user settings on a
    // deserialization failure (missing/renamed field, schema drift, etc.).
    AppConfig::default()
}

/// Persist AppConfig to config.json atomically (write to .tmp, then rename).
pub fn save_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = get_config_path(app);
    // Merge with the existing on-disk config instead of blind-overwriting it.
    // The frontend builds `AppConfig` from individual `$state` vars and may omit
    // fields (e.g. `hide_on_startup`) or fire a persist before `loadConfig` has
    // populated the vars (first-paint race) — a raw overwrite would reset those
    // omitted fields to Rust `Default` and silently wipe user settings. A
    // JSON-level deep merge keeps every key the caller didn't send, so a partial
    // write can never destroy stored config. Incoming values always win.
    let incoming = serde_json::to_value(config).map_err(|e| e.to_string())?;
    let merged = if path.exists() {
        if let Ok(existing_text) = fs::read_to_string(&path) {
            if let Ok(mut existing) = serde_json::from_str::<serde_json::Value>(&existing_text) {
                if existing.is_object() {
                    existing
                        .as_object_mut()
                        .unwrap()
                        .extend(incoming.as_object().cloned().unwrap_or_default());
                    existing
                } else {
                    incoming
                }
            } else {
                incoming
            }
        } else {
            incoming
        }
    } else {
        incoming
    };
    let json = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    write_atomic(&path, json.as_bytes())
}

/// Returns the full path to history.json.
pub fn get_history_path(app: &AppHandle) -> PathBuf {
    let mut config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&config_dir);
    config_dir.push("history.json");
    config_dir
}

/// Load the full upload history from disk. Returns an empty Vec if missing or corrupt.
pub fn load_history(app: &AppHandle) -> Vec<crate::uploader::UploadRecord> {
    let path = get_history_path(app);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(history) =
                serde_json::from_str::<Vec<crate::uploader::UploadRecord>>(&content)
            {
                return history;
            }
        }
    }
    Vec::new()
}

/// Persist the upload history slice to history.json atomically.
pub fn save_history(
    app: &AppHandle,
    history: &[crate::uploader::UploadRecord],
) -> Result<(), String> {
    let path = get_history_path(app);
    let json = serde_json::to_string(history).map_err(|e| e.to_string())?;
    write_atomic(&path, json.as_bytes())
}

/// Normalize a log file path: forward slashes, trim, lowercase — for dedup comparisons.
pub fn normalize_path(p: &str) -> String {
    p.replace('/', "\\").to_lowercase()
}

/// Persisted set of log file paths the user deleted from the Uploads Feed.
/// arcdps keeps re-writing/re-touching the source .zevtc, so a purely in-memory
/// removal would re-trigger the watcher and re-add the same path. We remember
/// deleted paths here and skip re-detected ones at queue time.
pub fn load_deleted_paths(app: &AppHandle) -> std::collections::HashSet<String> {
    let path = get_deleted_paths_path(app);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(arr) = serde_json::from_str::<Vec<String>>(&content) {
                return arr.into_iter().map(|s| normalize_path(&s)).collect();
            }
        }
    }
    std::collections::HashSet::new()
}

/// Persist the set of user-deleted log paths (so the watcher won't re-add them).
pub fn save_deleted_paths(
    app: &AppHandle,
    paths: &std::collections::HashSet<String>,
) -> Result<(), String> {
    let path = get_deleted_paths_path(app);
    let normalized_paths: std::collections::HashSet<String> =
        paths.iter().map(|s| normalize_path(s)).collect();
    let json = serde_json::to_string(&normalized_paths.iter().collect::<Vec<_>>())
        .map_err(|e| e.to_string())?;
    write_atomic(&path, json.as_bytes())
}

/// Returns the path to deleted_paths.json.
pub fn get_deleted_paths_path(app: &AppHandle) -> PathBuf {
    let mut config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&config_dir);
    config_dir.push("deleted_paths.json");
    config_dir
}

/// Merge precomputed record updates into history under the history lock.
///
/// Used by the startup self-heals / status poll in uploader.rs: they do their
/// (possibly network-bound) computation on a *snapshot* copy, then apply just the
/// changed records here so a concurrent upload's lock-guarded write is preserved
/// instead of clobbered. `updates` is keyed by `file_path`; matching history rows
/// are replaced in place. Returns true if anything changed.
pub fn merge_history_updates(
    app: &AppHandle,
    updates: &std::collections::HashMap<String, crate::uploader::UploadRecord>,
) -> Result<(), String> {
    if updates.is_empty() {
        return Ok(());
    }
    with_history_mut(app, |history| {
        let mut changed = false;
        for rec in history.iter_mut() {
            if let Some(u) = updates.get(&rec.file_path) {
                *rec = u.clone();
                changed = true;
            }
        }
        changed
    })
}

/// Append a single UploadRecord to history.json. Adds to the front; dedupes by file_path.
pub fn add_to_history(
    app: &AppHandle,
    record: crate::uploader::UploadRecord,
) -> Result<(), String> {
    with_history_mut(app, |history| {
        // Remove if duplicate path already exists to avoid duplicate entries
        history.retain(|r| r.file_path != record.file_path);
        history.insert(0, record.clone()); // prepend so newest logs appear first
        true
    })
}

/// Persisted ordering of the Uploads Feed: only the ordered `file_path`s,
/// resolved against history.json on launch. Keeps the Feed faithful across
/// restarts without duplicating the record data.
pub fn get_feed_path(app: &AppHandle) -> PathBuf {
    let mut config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&config_dir);
    config_dir.push("feed.json");
    config_dir
}

/// Load the current upload-feed file paths (for the Feed tab) from disk.
pub fn load_feed(app: &AppHandle) -> Vec<String> {
    let path = get_feed_path(app);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(paths) = serde_json::from_str::<Vec<String>>(&content) {
                // Drop any duplicate entries so the Feed never shows a path twice.
                let mut seen = std::collections::HashSet::new();
                return paths
                    .into_iter()
                    .filter(|p| seen.insert(p.clone()))
                    .collect();
            }
        }
    }
    Vec::new()
}

/// Persist the feed file paths to feed.json.
pub fn save_feed(app: &AppHandle, paths: &[String]) -> Result<(), String> {
    let path = get_feed_path(app);
    let json = serde_json::to_string(paths).map_err(|e| e.to_string())?;
    write_atomic(&path, json.as_bytes())
}
