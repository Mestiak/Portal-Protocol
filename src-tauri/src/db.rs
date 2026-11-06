// Portal Protocol - SQLite history storage.
//
// Owns all SQLite access for upload history. Provides open_db() and init_schema()
// used at startup. Reader/writer call sites migrate here over time; until then
// the legacy JSON path remains the source of truth.

use rusqlite::{Connection, Result};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

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
