//! The work-order quality package: the durable job file. Any document that
//! belongs to the whole work order rather than a single weld or drawing — the
//! final weld map, NDE reports, UT thickness readings, MTRs, hydro and PWHT
//! charts, PMI records. Files are stored as blobs so the package travels with
//! the record on a shared drive.

use crate::{Error, QualityFile, Result, Store};
use base64::Engine;
use rusqlite::params;

/// The categories a quality-package file can be filed under.
pub const CATEGORIES: &[&str] = &[
    "Weld Map",
    "NDE Report",
    "UT Thickness",
    "MTR",
    "Hydro Chart",
    "PWHT Chart",
    "PMI",
    "Other",
];

impl Store {
    /// Add a file to a work order's quality package. Returns the new file id.
    pub fn add_wo_file(
        &self,
        work_order: &str,
        category: Option<&str>,
        name: &str,
        mime: Option<&str>,
        b64: &str,
        note: Option<&str>,
        actor: &str,
    ) -> Result<i64> {
        let wo = work_order.trim();
        if wo.is_empty() {
            return Err(Error::Invalid("work order is required".into()));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| Error::Invalid(format!("invalid file data: {e}")))?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO wo_files (work_order, category, name, mime, data, note, uploaded_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![wo, category, name, mime, bytes, note, actor],
        )?;
        let id = conn.last_insert_rowid();
        drop(conn);
        self.audit(actor, "upload", "wo_file", &id.to_string(), name);
        Ok(id)
    }

    /// The quality-package file list for a work order (newest first, no bytes).
    pub fn list_wo_files(&self, work_order: &str) -> Result<Vec<QualityFile>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, work_order, category, name, mime, note,
                    (data IS NOT NULL) AS has_file, COALESCE(LENGTH(data), 0) AS size,
                    uploaded_by, uploaded_at
             FROM wo_files WHERE work_order = ?1 COLLATE NOCASE ORDER BY id DESC",
        )?;
        let rows = stmt.query_map(params![work_order], |r| {
            Ok(QualityFile {
                id: r.get(0)?,
                work_order: r.get(1)?,
                category: r.get(2)?,
                name: r.get(3)?,
                mime: r.get(4)?,
                note: r.get(5)?,
                has_file: r.get::<_, i64>(6)? != 0,
                size: r.get(7)?,
                uploaded_by: r.get(8)?,
                uploaded_at: r.get(9)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// A quality-package file's bytes as (name, mime, base64) for view/download.
    pub fn get_wo_file(&self, id: i64) -> Result<Option<(String, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let row: Option<(Option<String>, Option<String>, Option<Vec<u8>>)> = conn
            .query_row(
                "SELECT name, mime, data FROM wo_files WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        match row {
            Some((name, mime, Some(bytes))) => Ok(Some((
                name.unwrap_or_default(),
                mime.unwrap_or_else(|| "application/octet-stream".into()),
                base64::engine::general_purpose::STANDARD.encode(&bytes),
            ))),
            _ => Ok(None),
        }
    }

    /// Delete a quality-package file. A non-admin may delete only a file they
    /// uploaded; an admin may delete any.
    pub fn delete_wo_file(&self, id: i64, actor: &str, role: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let uploaded_by: Option<String> = conn
            .query_row(
                "SELECT uploaded_by FROM wo_files WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .map_err(|_| Error::NotFound)?;
        if role != "admin" && uploaded_by.as_deref() != Some(actor) {
            return Err(Error::PermissionDenied);
        }
        conn.execute("DELETE FROM wo_files WHERE id = ?1", params![id])?;
        drop(conn);
        self.audit(actor, "delete", "wo_file", &id.to_string(), "");
        Ok(())
    }
}
