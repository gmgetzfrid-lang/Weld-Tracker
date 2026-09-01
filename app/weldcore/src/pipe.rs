//! Pipe schedule lookup and other reference data (lookups, settings, legend).

use crate::{CriteriaRow, Lookup, PipeRow, Result, Store};
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;

impl Store {
    /// Wall thickness for a nominal size + schedule (replaces the `INDEX/MATCH`
    /// against the Pipe Table). Returns None when the combination is unlisted.
    pub fn lookup_thickness(&self, nps: f64, schedule: &str) -> Result<Option<f64>> {
        let conn = self.conn.lock().unwrap();
        let wall: Option<f64> = conn
            .query_row(
                "SELECT wall FROM pipe_schedule
                 WHERE ABS(nps - ?1) < 0.0001 AND schedule = ?2 COLLATE NOCASE",
                params![nps, schedule],
                |r| r.get(0),
            )
            .optional()?;
        Ok(wall)
    }

    pub fn list_pipe(&self) -> Result<Vec<PipeRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, nps, od, schedule, wall FROM pipe_schedule ORDER BY nps, id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(PipeRow {
                id: r.get(0)?,
                nps: r.get(1)?,
                od: r.get(2)?,
                schedule: r.get(3)?,
                wall: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Distinct nominal sizes present in the pipe table (for size dropdowns).
    pub fn pipe_sizes(&self) -> Result<Vec<f64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT DISTINCT nps FROM pipe_schedule ORDER BY nps")?;
        let rows = stmt.query_map([], |r| r.get::<_, f64>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn list_lookups(&self) -> Result<Vec<Lookup>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT kind, value, sort FROM lookups ORDER BY kind, sort, value")?;
        let rows = stmt.query_map([], |r| {
            Ok(Lookup {
                kind: r.get(0)?,
                value: r.get(1)?,
                sort: r.get(2)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// All lookups grouped by kind (convenient for populating the UI at once).
    pub fn lookups_grouped(&self) -> Result<HashMap<String, Vec<String>>> {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        for l in self.list_lookups()? {
            map.entry(l.kind).or_default().push(l.value);
        }
        Ok(map)
    }

    pub fn add_lookup(&self, kind: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let next: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort), -1) + 1 FROM lookups WHERE kind = ?1",
                params![kind],
                |r| r.get(0),
            )
            .unwrap_or(0);
        conn.execute(
            "INSERT OR IGNORE INTO lookups (kind, value, sort) VALUES (?1, ?2, ?3)",
            params![kind, value.trim(), next],
        )?;
        Ok(())
    }

    pub fn remove_lookup(&self, kind: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM lookups WHERE kind = ?1 AND value = ?2",
            params![kind, value],
        )?;
        Ok(())
    }

    pub fn get_settings(&self) -> Result<HashMap<String, String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?;
        let mut map = HashMap::new();
        for row in rows {
            let (k, v) = row?;
            map.insert(k, v.unwrap_or_default());
        }
        Ok(map)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn list_criteria(&self) -> Result<Vec<CriteriaRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, category, description, rt_percent FROM criteria_legend ORDER BY id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(CriteriaRow {
                id: r.get(0)?,
                category: r.get(1)?,
                description: r.get(2)?,
                rt_percent: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}
