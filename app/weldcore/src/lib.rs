//! weldcore — pure-Rust domain logic for the Kern Energy Weld Tracker.
//!
//! This crate owns the SQLite database, authentication, the weld/welder
//! records and every report that the original workbook computed with pivot
//! tables and `GETPIVOTDATA` formulas. It has no dependency on Tauri so it can
//! be unit-tested on its own.

pub mod auth;
pub mod certs;
pub mod drawings;
pub mod models;
pub mod pipe;
pub mod reports;
pub mod seed;
pub mod welders;
pub mod welds;

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
        let conn = self.conn.lock().unwrap();
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
        ];

        for (version, sql) in MIGRATIONS {
            if *version > applied {
                conn.execute_batch(sql)?;
                conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES (?1)",
                    [version],
                )?;
            }
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
}

/// Diameter inches for a weld: the nominal pipe size itself (a 6" pipe weld is
/// 6 diameter-inches). This is the productivity metric welders track.
pub fn weld_inches(size: f64) -> f64 {
    size
}
