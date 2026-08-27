//! One-time seeding of reference data, dropdown lookups, settings and the
//! default administrator account. Every step is idempotent.

use crate::{auth, Result, Store};
use rusqlite::params;

const SEED_REFERENCE_SQL: &str = include_str!("migrations/seed_reference.sql");

/// Default administrator credentials created on a fresh install.
pub const DEFAULT_ADMIN_USERNAME: &str = "admin";
pub const DEFAULT_ADMIN_PASSWORD: &str = "password";

pub fn seed(store: &Store) -> Result<()> {
    seed_reference(store)?;
    seed_lookups(store)?;
    seed_settings(store)?;
    ensure_default_admin(store)?;
    Ok(())
}

fn seed_reference(store: &Store) -> Result<()> {
    let conn = store.conn.lock().unwrap();
    let pipe_rows: i64 = conn.query_row("SELECT COUNT(*) FROM pipe_schedule", [], |r| r.get(0))?;
    if pipe_rows == 0 {
        conn.execute_batch(SEED_REFERENCE_SQL)?;
    }
    Ok(())
}

fn seed_lookups(store: &Store) -> Result<()> {
    let groups: &[(&str, &[&str])] = &[
        ("joint_type", &["BW", "SW", "O-Let", "Fillet", "Other"]),
        (
            "material",
            &["CS", "1.25Cr", "2.25Cr", "5Cr", "9Cr", "12Cr", "SS", "Alloy"],
        ),
        (
            "schedule",
            &[
                "n/a", "5", "5s", "10", "10s", "20", "30", "40", "STD/40s", "60", "80", "XH",
                "100", "120", "140", "160", "XXH",
            ],
        ),
        ("shift", &["Day", "Night"]),
        ("crew", &["WWW", "TIMEC"]),
        (
            "status",
            &["Required", "Requested", "Pending", "PWHT", "Clear"],
        ),
        ("shop_field", &["SHOP", "FW"]),
        ("process", &["SMAW", "GMAW", "GTAW", "FCAW", "SAW"]),
        (
            "groove_type",
            &[
                "Single-V", "Single-Bevel", "Double-V", "Square", "U-Groove", "J-Groove",
                "Fillet", "Socket",
            ],
        ),
        ("old_to_new", &["Y", "N"]),
    ];
    let conn = store.conn.lock().unwrap();
    for (kind, values) in groups {
        for (i, v) in values.iter().enumerate() {
            conn.execute(
                "INSERT OR IGNORE INTO lookups (kind, value, sort) VALUES (?1, ?2, ?3)",
                params![kind, v, i as i64],
            )?;
        }
    }
    Ok(())
}

fn seed_settings(store: &Store) -> Result<()> {
    let defaults: &[(&str, &str)] = &[
        ("company_name", "Kern Energy"),
        ("company_tagline", "We Fuel the Future"),
        ("app_title", "Weld Tracker"),
        ("primary_color", "#0a1f6b"),
        ("accent_color", "#2f9e7e"),
        ("reject_rate_warn_pct", "5"),
        ("logo_path", ""),
    ];
    let conn = store.conn.lock().unwrap();
    for (k, v) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            params![k, v],
        )?;
    }
    Ok(())
}

fn ensure_default_admin(store: &Store) -> Result<()> {
    let needs = store.needs_bootstrap()?;
    if needs {
        let hash = auth::hash_password(DEFAULT_ADMIN_PASSWORD)?;
        let conn = store.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (username, display_name, role, password_hash, must_change_password, active)
             VALUES (?1, 'Administrator', 'admin', ?2, 1, 1)",
            params![DEFAULT_ADMIN_USERNAME, hash],
        )?;
    }
    Ok(())
}
