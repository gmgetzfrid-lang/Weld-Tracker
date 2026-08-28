//! weldcore — pure-Rust domain logic for the Kern Energy Weld Tracker.
//!
//! This crate owns the SQLite database, authentication, the weld/welder
//! records and every report that the original workbook computed with pivot
//! tables and `GETPIVOTDATA` formulas. It has no dependency on Tauri so it can
//! be unit-tested on its own.

// Several store methods (add_bubble_weld, upload package, wo_files insert) take
// the full set of a record's columns as positional arguments, and a handful of
// query helpers return the row as a wide tuple. Both are deliberate, readable
// data-layer shapes; splitting them into structs for the linter would add
// indirection without making the SQL any clearer.
#![allow(clippy::too_many_arguments, clippy::type_complexity)]

pub mod auth;
pub mod certs;
pub mod drawings;
pub mod models;
pub mod nde;
pub mod pipe;
pub mod reports;
pub mod search;
pub mod seed;
pub mod validate;
pub mod welders;
pub mod welds;
pub mod wo_files;

use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub use models::*;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("password hashing error: {0}")]
    Hash(String),
    #[error("not found")]
    NotFound,
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("account disabled")]
    AccountDisabled,
    #[error("permission denied")]
    PermissionDenied,
    #[error("{0}")]
    Invalid(String),
    /// Optimistic-concurrency clash: someone else changed this record since it
    /// was loaded. The caller should reload and re-apply the change.
    #[error("this record was changed by someone else since you opened it — reload and try again")]
    Conflict,
}

pub type Result<T> = std::result::Result<T, Error>;

/// The application data store. Wraps a single SQLite connection behind a mutex
/// so it can be shared as Tauri managed state.
pub struct Store {
    pub conn: Mutex<Connection>,
}

impl Store {
    /// Open (creating if needed) a database at `path`, run migrations and seed
    /// the reference data + default admin account.
    ///
    /// `network_safe` selects locking suited to a shared file on a network drive
    /// (multiple users, multiple machines): a rollback journal (WAL cannot work
    /// across an SMB share), full synchronous writes to survive disconnects, and
    /// a generous busy-timeout so concurrent writers retry instead of failing.
    /// For a purely local single-user database, WAL is faster.
    pub fn open<P: AsRef<Path>>(path: P, network_safe: bool) -> Result<Store> {
        let conn = Connection::open(path)?;
        if network_safe {
            conn.pragma_update(None, "journal_mode", "TRUNCATE")?;
            conn.pragma_update(None, "synchronous", "FULL")?;
        } else {
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "synchronous", "NORMAL")?;
        }
        conn.busy_timeout(std::time::Duration::from_secs(15))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // Fail fast on a corrupt file (a half-written copy on a network share,
        // a truncated download) rather than migrating and reading garbage. On a
        // healthy database quick_check returns the single row "ok".
        let integrity: String = conn
            .query_row("PRAGMA quick_check(1)", [], |r| r.get(0))
            .unwrap_or_else(|_| "unreadable".to_string());
        if integrity != "ok" {
            return Err(Error::Invalid(format!(
                "database integrity check failed ({integrity}); the file may be \
                 corrupt or was not fully copied. Restore from a backup."
            )));
        }
        let store = Store {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        seed::seed(&store)?;
        Ok(store)
    }

    /// Open an in-memory database (used by tests).
    pub fn open_memory() -> Result<Store> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let store = Store {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        seed::seed(&store)?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )?;
        let applied: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        const MIGRATIONS: &[(i64, &str)] = &[
            (1, include_str!("migrations/0001_init.sql")),
            (2, include_str!("migrations/0002_drawings.sql")),
            (3, include_str!("migrations/0003_nde.sql")),
            (4, include_str!("migrations/0004_spec_break.sql")),
            (5, include_str!("migrations/0005_welder_certs.sql")),
            (6, include_str!("migrations/0006_drop_welder_legacy.sql")),
            (7, include_str!("migrations/0007_doc_control.sql")),
            (8, include_str!("migrations/0008_nde_table4.sql")),
            (9, include_str!("migrations/0009_integrity_snapshot.sql")),
            (10, include_str!("migrations/0010_soft_delete_audit.sql")),
            (11, include_str!("migrations/0011_row_version.sql")),
            (12, include_str!("migrations/0012_repair_chain.sql")),
        ];

        let pending: Vec<&(i64, &str)> =
            MIGRATIONS.iter().filter(|(v, _)| *v > applied).collect();
        if pending.is_empty() {
            return Ok(());
        }

        // Pre-migration backup: before changing the schema of an existing
        // on-disk database, copy it aside so a botched upgrade is always
        // recoverable. Best-effort — a fresh (version 0) database has nothing
        // worth saving, and a backup failure must not block first-run creation.
        if applied > 0 {
            if let Some(path) = main_db_path(&conn) {
                let ts: String = conn
                    .query_row("SELECT strftime('%Y%m%d-%H%M%S','now')", [], |r| r.get(0))
                    .unwrap_or_else(|_| "backup".to_string());
                let dest = format!("{path}.pre-migrate-v{applied}-{ts}.bak");
                if let Err(e) = conn.backup(rusqlite::DatabaseName::Main, &dest, None) {
                    eprintln!("warning: pre-migration backup to {dest} failed: {e}");
                }
            }
        }

        // Each migration runs in its own transaction together with the row that
        // records it, so a failed migration rolls back cleanly and the version
        // counter never gets ahead of the schema.
        for (version, sql) in pending {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO schema_migrations (version) VALUES (?1)",
                [version],
            )?;
            tx.commit()?;
        }
        Ok(())
    }

    /// Record an entry in the audit log. Failures are swallowed (auditing must
    /// never block the primary action).
    pub fn audit(&self, username: &str, action: &str, entity: &str, entity_id: &str, detail: &str) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute(
                "INSERT INTO audit_log (username, action, entity, entity_id, detail)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![username, action, entity, entity_id, detail],
            );
        }
    }

    /// The most recent audit-log entries (the Activity log), newest first.
    /// `entity` optionally narrows to one kind (e.g. "weld"); `limit` is clamped
    /// to a sane range.
    pub fn recent_activity(
        &self,
        entity: Option<&str>,
        limit: i64,
    ) -> Result<Vec<models::AuditEntry>> {
        let limit = limit.clamp(1, 1000);
        let conn = self.conn.lock().unwrap();
        let ent = entity.map(|s| s.trim()).filter(|s| !s.is_empty());
        let sql = format!(
            "SELECT id, ts, username, action, entity, entity_id, detail
             FROM audit_log {} ORDER BY id DESC LIMIT {limit}",
            if ent.is_some() { "WHERE entity = ?1" } else { "" }
        );
        let mut stmt = conn.prepare(&sql)?;
        let map = |r: &rusqlite::Row| {
            Ok(models::AuditEntry {
                id: r.get("id")?,
                ts: r.get("ts")?,
                username: r.get("username")?,
                action: r.get("action")?,
                entity: r.get("entity")?,
                entity_id: r.get("entity_id")?,
                detail: r.get("detail")?,
            })
        };
        let rows: rusqlite::Result<Vec<models::AuditEntry>> = match ent {
            Some(e) => stmt.query_map(rusqlite::params![e], map)?.collect(),
            None => stmt.query_map([], map)?.collect(),
        };
        Ok(rows?)
    }

    /// Write a consistent snapshot of the live database to `dest` using SQLite's
    /// online backup API — safe to call while the app is running, and it works
    /// across the rollback-journal locking used on a network share. Returns the
    /// destination path on success.
    pub fn backup_to<P: AsRef<Path>>(&self, dest: P) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.backup(rusqlite::DatabaseName::Main, dest, None)?;
        Ok(())
    }

    /// Write a timestamped backup into `dir` (created if needed) and return the
    /// full path written, e.g. `.../backups/sentrix-backup-20260828-142530.db`.
    pub fn backup_now(&self, dir: &Path) -> Result<std::path::PathBuf> {
        std::fs::create_dir_all(dir)
            .map_err(|e| Error::Invalid(format!("cannot create backup folder: {e}")))?;
        let ts: String = {
            let conn = self.conn.lock().unwrap();
            conn.query_row("SELECT strftime('%Y%m%d-%H%M%S','now')", [], |r| r.get(0))?
        };
        let dest = dir.join(format!("sentrix-backup-{ts}.db"));
        self.backup_to(&dest)?;
        Ok(dest)
    }
}

/// The on-disk file backing the `main` database, or `None` for an in-memory or
/// unfiled connection. Read from `PRAGMA database_list`.
fn main_db_path(conn: &Connection) -> Option<String> {
    conn.query_row("PRAGMA database_list", [], |r| r.get::<_, String>(2))
        .ok()
        .filter(|p| !p.is_empty())
}

/// Diameter inches for a weld: the nominal pipe size itself (a 6" pipe weld is
/// 6 diameter-inches). This is the productivity metric welders track.
pub fn weld_inches(size: f64) -> f64 {
    size
}
