// Portal Protocol - SQLite history storage.
//
// Owns all SQLite access for upload history. Provides open_db() and init_schema()
// used at startup. Reader/writer call sites migrate here over time; until then
// the legacy JSON path remains the source of truth.

use rusqlite::{Connection, Result};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use std::sync::OnceLock;

static LAST_MIGRATION_COUNT: OnceLock<usize> = OnceLock::new();

pub fn set_last_migration_count(n: usize) {
    let _ = LAST_MIGRATION_COUNT.set(n);
}

pub fn last_migration_count() -> usize {
    LAST_MIGRATION_COUNT.get().copied().unwrap_or(0)
}

/// Returns the path to the SQLite history database.
pub fn get_db_path(app: &AppHandle) -> PathBuf {
    let mut dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&dir);
    dir.push("history.db");
    dir
}

/// Open (or create) the history database and apply the schema.
/// Uses WAL mode so reads never block writes (no UI freeze).
pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = get_db_path(app);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    // WAL = writes go to a sidecar file; reads see a consistent snapshot.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())?;

    init_schema(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
}

/// Create the history table + indexes if they don't exist yet.
pub fn init_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS history (
            file_path        TEXT PRIMARY KEY,
            file_name        TEXT NOT NULL,
            timestamp        TEXT,
            status           TEXT,
            stage            TEXT,
            url              TEXT,
            boss_name        TEXT,
            success          INTEGER,
            duration         REAL,
            is_cm            INTEGER,
            cm_verified      INTEGER,
            is_lcm           INTEGER,
            is_quick_play    INTEGER,
            num_players      INTEGER,
            players          TEXT,
            error_msg        TEXT,
            boss_hp_left     REAL,
            ca_arms          TEXT,
            twin_largos      TEXT,
            eyes             TEXT,
            voice_claw       TEXT,
            aetherblade      TEXT,
            old_lions_court  TEXT,
            diagnostics      TEXT,
            is_convergence   INTEGER,
            kaineng_phases   TEXT,
            ura_health_regen TEXT,
            is_wvw           INTEGER,
            wvw_enemy_count  INTEGER,
            recorded_account TEXT,
            recorded_at      TEXT,
            boss_duration    REAL,
            group_dps        REAL,
            is_story         INTEGER,
            map_id           INTEGER,
            notes            TEXT,
            wingman_status   TEXT,
            wingman_account  TEXT,
            discord_pending  INTEGER,
            ei_done          INTEGER,
            upload_done      INTEGER,
            vl_rank          TEXT,
            boss_icon        TEXT,
            instance_name    TEXT,
            bosses_hp        TEXT,
            bosses_phases    TEXT,
            local_fallback   INTEGER DEFAULT 0,
            dragonvoid_add_evidence TEXT,
            cerus_empowered_stacks INTEGER,
            is_favorite      INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_history_boss      ON history(boss_name);
        CREATE INDEX IF NOT EXISTS idx_history_status    ON history(status);
        CREATE INDEX IF NOT EXISTS idx_history_cm        ON history(is_cm);
        CREATE INDEX IF NOT EXISTS idx_history_favorite  ON history(is_favorite);",
    )?;
    Ok(())
}

/// Quick helper: does the DB file already exist on disk?
pub fn db_exists(app: &AppHandle) -> bool {
    get_db_path(app).exists()
}

/// Returns the path to the legacy history.json file.
pub fn get_json_path(app: &AppHandle) -> PathBuf {
    let mut dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&dir);
    dir.push("history.json");
    dir
}

/// One-time migration: if history.db is missing but history.json exists, import
/// all rows into SQLite in a single transaction, then rename the JSON to .bak.
/// Emits "history-migration" events so the UI can show progress. Returns the
/// number of rows migrated (0 if nothing to do).
pub fn migrate_from_json_if_needed(app: &AppHandle) -> Result<usize, String> {
    let db_path = get_db_path(app);
    let json_path = get_json_path(app);

    // Already migrated, or fresh install with no JSON: nothing to do.
    if db_path.exists() || !json_path.exists() {
        return Ok(0);
    }

    let content = std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let records: Vec<crate::uploader::UploadRecord> =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let total = records.len();

    let _ = app.clone().emit(
        "history-migration",
        serde_json::json!({
            "stage": "start",
            "total": total,
            "message": format!("Migrating {} logs into the new database…", total)
        }),
    );

    let conn = open_db(app)?;
    let mut conn = conn;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for rec in &records {
        crate::db::insert_record_pub(&tx, rec).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    // Rename JSON to .bak only after a successful commit (rollback safety).
    let bak_path = json_path.with_extension("json.bak");
    let _ = std::fs::rename(&json_path, &bak_path);

    let _ = app.clone().emit(
        "history-migration",
        serde_json::json!({
            "stage": "done",
            "total": total,
            "message": format!("Migration complete — {} logs imported.", total)
        }),
    );

    crate::db::set_last_migration_count(total);
    Ok(total)
}

/// Insert one UploadRecord into the history table.
pub fn insert_record_pub(conn: &Connection, r: &crate::uploader::UploadRecord) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR REPLACE INTO history (
            file_path, file_name, timestamp, status, stage, url, boss_name, success,
            duration, is_cm, cm_verified, is_lcm, is_quick_play, num_players, players,
            error_msg, boss_hp_left, ca_arms, twin_largos, eyes, voice_claw, aetherblade,
            old_lions_court, diagnostics, is_convergence, kaineng_phases, ura_health_regen,
            is_wvw, wvw_enemy_count, recorded_account, recorded_at, boss_duration, group_dps,
            is_story, map_id, notes, wingman_status, wingman_account, discord_pending,
            ei_done, upload_done, vl_rank, boss_icon, instance_name, bosses_hp,
            bosses_phases, local_fallback, dragonvoid_add_evidence, cerus_empowered_stacks,
            is_favorite
        ) VALUES (
            ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,
            ?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35,?36,?37,?38,
            ?39,?40,?41,?42,?43,?44,?45,?46,?47,?48,?49,?50
        )",
        rusqlite::params![
            r.file_path,
            r.file_name,
            r.timestamp,
            r.status,
            r.stage,
            r.url,
            r.boss_name,
            r.success.map(|b| b as i64),
            r.duration,
            r.is_cm.map(|b| b as i64),
            r.cm_verified.map(|b| b as i64),
            r.is_lcm.map(|b| b as i64),
            r.is_quick_play.map(|b| b as i64),
            r.num_players.map(|n| n as i64),
            r.players.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.error_msg,
            r.boss_hp_left,
            r.ca_arms.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.twin_largos.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.eyes.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.voice_claw.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.aetherblade.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.old_lions_court.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.diagnostics.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.is_convergence.map(|b| b as i64),
            r.kaineng_phases.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.ura_health_regen,
            r.is_wvw.map(|b| b as i64),
            r.wvw_enemy_count.map(|n| n as i64),
            r.recorded_account,
            r.recorded_at,
            r.boss_duration,
            r.group_dps,
            r.is_story.map(|b| b as i64),
            r.map_id.map(|n| n as i64),
            serde_json::to_string(&r.notes).unwrap_or_else(|_| "[]".to_string()),
            r.wingman_status,
            r.wingman_account,
            r.discord_pending.map(|b| b as i64),
            r.ei_done.map(|b| b as i64),
            r.upload_done.map(|b| b as i64),
            r.vl_rank.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.boss_icon,
            r.instance_name,
            r.bosses_hp.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.bosses_phases.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.local_fallback as i64,
            r.dragonvoid_add_evidence.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
            r.cerus_empowered_stacks.map(|n| n as i64),
            r.is_favorite.map(|b| b as i64),
        ],
    )?;
    Ok(())
}
