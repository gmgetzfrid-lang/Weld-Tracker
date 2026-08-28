//! Welder roster CRUD (from the workbook "WELDER ROSTER" / "Welder List").

use crate::{Error, Result, Store, Welder};
use rusqlite::{params, Row};

fn welder_from_row(r: &Row) -> rusqlite::Result<Welder> {
    Ok(Welder {
        id: r.get("id")?,
        stamp: r.get("stamp")?,
        name: r.get("name")?,
        active: r.get::<_, i64>("active")? != 0,
        training: r.get("training")?,
        notes: r.get("notes")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

const COLS: &str = "id, stamp, name, active, training, notes, created_at, updated_at";

impl Store {
    /// List welders. `include_inactive` false returns only active welders.
    /// `sort_by` accepts "name" or "stamp".
    pub fn list_welders(&self, include_inactive: bool, sort_by: &str) -> Result<Vec<Welder>> {
        let order = if sort_by == "stamp" {
            "stamp COLLATE NOCASE"
        } else {
            "name COLLATE NOCASE"
        };
        let where_clause = if include_inactive {
            ""
        } else {
            "WHERE active = 1"
        };
        let sql = format!("SELECT {COLS} FROM welders {where_clause} ORDER BY {order}");
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], welder_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_welder(&self, id: i64) -> Result<Welder> {
        let conn = self.conn.lock().unwrap();
        let sql = format!("SELECT {COLS} FROM welders WHERE id = ?1");
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(params![id])?;
        let row = rows.next()?.ok_or(Error::NotFound)?;
        welder_from_row(row).map_err(Error::from)
    }

    pub fn create_welder(&self, w: &Welder) -> Result<i64> {
        if w.stamp.trim().is_empty() {
            return Err(Error::Invalid("welder stamp is required".into()));
        }
        if w.name.trim().is_empty() {
            return Err(Error::Invalid("welder name is required".into()));
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO welders (stamp, name, active, training, notes)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                w.stamp.trim(), w.name.trim(), w.active as i64, w.training, w.notes
            ],
        )
        .map_err(dup_stamp)?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_welder(&self, w: &Welder) -> Result<()> {
        if w.stamp.trim().is_empty() {
            return Err(Error::Invalid("welder stamp is required".into()));
        }
        let conn = self.conn.lock().unwrap();
        let n = conn
            .execute(
                "UPDATE welders SET stamp=?1, name=?2, active=?3,
                    training=?4, notes=?5, updated_at=datetime('now')
                 WHERE id=?6",
                params![
                    w.stamp.trim(), w.name.trim(), w.active as i64,
                    w.training, w.notes, w.id
                ],
            )
            .map_err(dup_stamp)?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// Delete a welder. Blocked when welds reference the welder's stamp; callers
    /// should deactivate instead to preserve history.
    pub fn delete_welder(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let stamp: String = conn
            .query_row("SELECT stamp FROM welders WHERE id = ?1", params![id], |r| {
                r.get(0)
            })
            .map_err(|_| Error::NotFound)?;
        let refs: i64 = conn.query_row(
            "SELECT COUNT(*) FROM welds WHERE stamp_number = ?1 COLLATE NOCASE",
            params![stamp],
            |r| r.get(0),
        )?;
        if refs > 0 {
            return Err(Error::Invalid(format!(
                "welder {stamp} has {refs} welds on record — deactivate instead of deleting"
            )));
        }
        conn.execute("DELETE FROM welders WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn dup_stamp(e: rusqlite::Error) -> Error {
    match e {
        rusqlite::Error::SqliteFailure(err, _)
            if err.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Error::Invalid("a welder with that stamp already exists".into())
        }
        other => Error::Db(other),
    }
}
