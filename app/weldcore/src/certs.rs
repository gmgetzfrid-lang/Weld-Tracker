//! Welder qualifications (WPQ certs), document storage, and per-cert continuity.
//!
//! Each welder holds any number of certs. A cert is a named (alias) qualification
//! for a process, with the WPQ document stored on the welder's profile. Status is
//! computed, never stored: a cert is Active when an x-ray (RT) to a weld carrying
//! its alias happened within the last six months (a fresh qualification counts),
//! otherwise Inactive. The weld log records which cert each weld used, so an x-ray
//! automatically refreshes that cert's continuity.

use crate::{ContinuityEvent, Error, Result, Store, WelderCert, WelderContinuity};
use base64::Engine;
use rusqlite::{params, Row};

fn cert_base_from_row(r: &Row) -> rusqlite::Result<WelderCert> {
    Ok(WelderCert {
        id: r.get("id")?,
        welder_id: r.get("welder_id")?,
        alias: r.get("alias")?,
        process: r.get("process")?,
        qualified_date: r.get("qualified_date")?,
        file_name: r.get("file_name")?,
        has_file: r.get::<_, i64>("has_file")? != 0,
        notes: r.get("notes")?,
        status: String::new(),
        last_activity: None,
        continuous_through: None,
        weld_count: 0,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

const CERT_SELECT: &str = "SELECT id, welder_id, alias, process, qualified_date, file_name,
    (file_data IS NOT NULL) AS has_file, notes, created_at, updated_at FROM welder_certs";

impl Store {
    /// Today and the six-month continuity cutoff, as 'YYYY-MM-DD' from the DB clock.
    fn today_and_cutoff(&self) -> Result<(String, String)> {
        let conn = self.conn.lock().unwrap();
        let today: String = conn.query_row("SELECT date('now')", [], |r| r.get(0))?;
        let cutoff: String = conn.query_row("SELECT date('now','-6 months')", [], |r| r.get(0))?;
        Ok((today, cutoff))
    }

    /// The welder's certs with computed status, last activity and continuity.
    pub fn list_welder_certs(&self, welder_id: i64) -> Result<Vec<WelderCert>> {
        let (_today, cutoff) = self.today_and_cutoff()?;
        let conn = self.conn.lock().unwrap();
        let stamp: String = conn
            .query_row("SELECT stamp FROM welders WHERE id = ?1", params![welder_id], |r| r.get(0))
            .map_err(|_| Error::NotFound)?;
        // Gather each cert plus its latest x-ray date and weld count.
        let raw: Vec<(WelderCert, Option<String>, i64)> = {
            let mut stmt = conn.prepare(&format!(
                "{CERT_SELECT} WHERE welder_id = ?1 ORDER BY alias COLLATE NOCASE"
            ))?;
            let rows = stmt.query_map(params![welder_id], |r| Ok(cert_base_from_row(r)?))?;
            let mut v = Vec::new();
            for c in rows {
                let c = c?;
                let last_rt: Option<String> = conn
                    .query_row(
                        "SELECT MAX(rt_date) FROM welds
                         WHERE stamp_number = ?1 COLLATE NOCASE AND cert_alias = ?2 COLLATE NOCASE
                           AND rt_date IS NOT NULL AND rt_date <> ''",
                        params![stamp, c.alias],
                        |r| r.get(0),
                    )
                    .unwrap_or(None);
                let wc: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM welds
                         WHERE stamp_number = ?1 COLLATE NOCASE AND cert_alias = ?2 COLLATE NOCASE",
                        params![stamp, c.alias],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                v.push((c, last_rt, wc));
            }
            v
        };
        let mut out = Vec::new();
        for (mut c, last_rt, wc) in raw {
            c.weld_count = wc;
            c.last_activity = last_rt.clone();
            // Anchor = the most recent continuity event (a fresh qualification or
            // an x-ray). ISO dates compare correctly as strings.
            let anchor = [c.qualified_date.clone(), last_rt]
                .into_iter()
                .flatten()
                .max();
            c.status = match &anchor {
                Some(a) if a.as_str() >= cutoff.as_str() => "Active".to_string(),
                _ => "Inactive".to_string(),
            };
            c.continuous_through = match &anchor {
                Some(a) => conn
                    .query_row("SELECT date(?1, '+6 months')", params![a], |r| r.get(0))
                    .ok(),
                None => None,
            };
            out.push(c);
        }
        Ok(out)
    }

    /// Cert aliases available for the welder with this stamp — the weld-log picker.
    pub fn welder_cert_aliases(&self, stamp: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.alias FROM welder_certs c
             JOIN welders w ON w.id = c.welder_id
             WHERE w.stamp = ?1 COLLATE NOCASE
             ORDER BY c.alias COLLATE NOCASE",
        )?;
        let rows = stmt.query_map(params![stamp], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn create_welder_cert(&self, c: &WelderCert, actor: &str) -> Result<i64> {
        if c.alias.trim().is_empty() {
            return Err(Error::Invalid("a cert alias (name) is required".into()));
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO welder_certs (welder_id, alias, process, qualified_date, notes, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![c.welder_id, c.alias.trim(), c.process, c.qualified_date, c.notes, actor],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_welder_cert(&self, c: &WelderCert) -> Result<()> {
        if c.alias.trim().is_empty() {
            return Err(Error::Invalid("a cert alias (name) is required".into()));
        }
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE welder_certs SET alias=?1, process=?2, qualified_date=?3, notes=?4,
                updated_at=datetime('now') WHERE id=?5",
            params![c.alias.trim(), c.process, c.qualified_date, c.notes, c.id],
        )?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    pub fn delete_welder_cert(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("DELETE FROM welder_certs WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// Store the WPQ document (base64 from the front-end) on a cert.
    pub fn set_welder_cert_file(&self, id: i64, name: &str, b64: &str) -> Result<()> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| Error::Invalid(format!("invalid document data: {e}")))?;
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE welder_certs SET file_name=?1, file_data=?2, updated_at=datetime('now')
             WHERE id=?3",
            params![name, bytes, id],
        )?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// Fetch a cert's document as (filename, base64) for the front-end to open.
    pub fn get_welder_cert_file(&self, id: i64) -> Result<Option<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let row: Option<(Option<String>, Option<Vec<u8>>)> = conn
            .query_row(
                "SELECT file_name, file_data FROM welder_certs WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        match row {
            Some((name, Some(bytes))) => {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                Ok(Some((name.unwrap_or_default(), b64)))
            }
            _ => Ok(None),
        }
    }

    /// A welder's full continuity record for the on-screen view / PDF export.
    pub fn welder_continuity(&self, welder_id: i64) -> Result<WelderContinuity> {
        let certs = self.list_welder_certs(welder_id)?;
        let (today, _cutoff) = self.today_and_cutoff()?;
        let conn = self.conn.lock().unwrap();
        let (stamp, name): (String, String) = conn
            .query_row(
                "SELECT stamp, name FROM welders WHERE id = ?1",
                params![welder_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| Error::NotFound)?;
        let mut stmt = conn.prepare(
            "SELECT w.rt_date, w.cert_alias, w.weld_number, w.work_order, w.drawing_no,
                    CASE WHEN w.rt_rejected = 'Y' THEN 'Rejected'
                         WHEN w.rt_accepted = 'Y' THEN 'Accepted' ELSE '' END AS result,
                    (SELECT c.process FROM welder_certs c
                       WHERE c.welder_id = ?1 AND c.alias = w.cert_alias COLLATE NOCASE) AS process
             FROM welds w
             WHERE w.stamp_number = ?2 COLLATE NOCASE
               AND w.cert_alias IS NOT NULL AND w.cert_alias <> ''
               AND w.rt_date IS NOT NULL AND w.rt_date <> ''
             ORDER BY w.rt_date DESC, w.weld_number",
        )?;
        let events = stmt
            .query_map(params![welder_id, stamp], |r| {
                Ok(ContinuityEvent {
                    date: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    cert_alias: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    weld_number: r.get(2)?,
                    work_order: r.get(3)?,
                    drawing_no: r.get(4)?,
                    result: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    process: r.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(WelderContinuity {
            welder_id,
            stamp,
            name,
            certs,
            events,
            generated_on: today,
        })
    }
}
