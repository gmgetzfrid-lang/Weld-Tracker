//! Drawing markups (redlines) and the Tool Chest.
//!
//! The store treats a markup's geometry as an opaque JSON document: the
//! frontend owns the shapes (lines, clouds, symbols, groups) and renders them
//! both on screen and into the flattened weld-map PDF. What the backend
//! guarantees is the record: which sheet and page, who drew it and when,
//! status, draw order, and that a locked markup is not silently changed.

use crate::{Error, Result, Store};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Markup {
    #[serde(default)]
    pub id: i64,
    pub drawing_id: i64,
    #[serde(default = "one")]
    pub page: i64,
    pub kind: String,
    /// JSON geometry + style (page-normalized coordinates).
    pub data: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default = "open")]
    pub status: String,
    #[serde(default)]
    pub z: i64,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_by: Option<String>,
    #[serde(default)]
    pub updated_at: String,
}

fn one() -> i64 {
    1
}
fn open() -> String {
    "Open".to_string()
}
fn drawing_mode() -> String {
    "drawing".to_string()
}

/// A reusable markup in the Tool Chest.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MarkupTool {
    #[serde(default)]
    pub id: i64,
    pub category: String,
    pub name: String,
    pub kind: String,
    /// JSON template: unit-box geometry, style, and the pixel size it was
    /// saved at (so Drawing mode reproduces the same size).
    pub data: String,
    #[serde(default = "drawing_mode")]
    pub mode: String,
    #[serde(default)]
    pub sort: i64,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

const MARKUP_COLS: &str = "id, drawing_id, page, kind, data, subject, comment, status, z, locked,
    created_by, created_at, updated_by, updated_at";

fn markup_from_row(r: &rusqlite::Row) -> rusqlite::Result<Markup> {
    Ok(Markup {
        id: r.get(0)?,
        drawing_id: r.get(1)?,
        page: r.get(2)?,
        kind: r.get(3)?,
        data: r.get(4)?,
        subject: r.get(5)?,
        comment: r.get(6)?,
        status: r.get(7)?,
        z: r.get(8)?,
        locked: r.get::<_, i64>(9)? != 0,
        created_by: r.get(10)?,
        created_at: r.get(11)?,
        updated_by: r.get(12)?,
        updated_at: r.get(13)?,
    })
}

const TOOL_COLS: &str = "id, category, name, kind, data, mode, sort, created_by, created_at";

fn tool_from_row(r: &rusqlite::Row) -> rusqlite::Result<MarkupTool> {
    Ok(MarkupTool {
        id: r.get(0)?,
        category: r.get(1)?,
        name: r.get(2)?,
        kind: r.get(3)?,
        data: r.get(4)?,
        mode: r.get(5)?,
        sort: r.get(6)?,
        created_by: r.get(7)?,
        created_at: r.get(8)?,
    })
}

const KINDS: &[&str] = &[
    "line", "arrow", "polyline", "pen", "rect", "ellipse", "cloud", "text", "callout", "dimension",
    "highlight", "group",
];

fn check_kind(kind: &str) -> Result<()> {
    if KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(Error::Invalid(format!("unknown markup kind '{kind}'")))
    }
}

fn check_json(data: &str) -> Result<()> {
    if data.len() > 512 * 1024 {
        return Err(Error::Invalid("markup data is too large".into()));
    }
    serde_json::from_str::<serde_json::Value>(data)
        .map(|_| ())
        .map_err(|e| Error::Invalid(format!("markup data is not valid JSON: {e}")))
}

fn clean(s: Option<&str>) -> Option<String> {
    s.map(str::trim).filter(|s| !s.is_empty()).map(|s| s.chars().take(2000).collect())
}

impl Store {
    // ---- Markups ----------------------------------------------------------

    /// Every markup on a sheet (all pages), bottom-most first.
    pub fn list_markups(&self, drawing_id: i64) -> Result<Vec<Markup>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {MARKUP_COLS} FROM markups WHERE drawing_id = ?1 ORDER BY page, z, id"
        ))?;
        let rows = stmt.query_map([drawing_id], markup_from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn get_markup(&self, id: i64) -> Result<Markup> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(&format!("SELECT {MARKUP_COLS} FROM markups WHERE id = ?1"), [id], markup_from_row)
            .map_err(|_| Error::NotFound)
    }

    pub fn create_markup(&self, m: &Markup, actor: &str) -> Result<Markup> {
        check_kind(&m.kind)?;
        check_json(&m.data)?;
        let id = {
            let conn = self.conn.lock().unwrap();
            let exists: bool = conn
                .query_row("SELECT 1 FROM drawings WHERE id = ?1", [m.drawing_id], |_| Ok(true))
                .unwrap_or(false);
            if !exists {
                return Err(Error::NotFound);
            }
            // New markups land on top of the page.
            let z: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(z), 0) + 1 FROM markups WHERE drawing_id = ?1 AND page = ?2",
                    params![m.drawing_id, m.page],
                    |r| r.get(0),
                )
                .unwrap_or(1);
            conn.execute(
                "INSERT INTO markups (drawing_id, page, kind, data, subject, comment, status, z, locked, created_by, updated_by)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'Open', ?7, ?8, ?9, ?9)",
                params![
                    m.drawing_id,
                    m.page.max(1),
                    m.kind,
                    m.data,
                    clean(m.subject.as_deref()),
                    clean(m.comment.as_deref()),
                    z,
                    m.locked as i64,
                    actor
                ],
            )?;
            conn.last_insert_rowid()
        };
        self.audit(actor, "create", "markup", &id.to_string(), &format!("{} on drawing {} p{}", m.kind, m.drawing_id, m.page));
        self.get_markup(id)
    }

    /// Replace a markup's geometry / text / flags. A locked markup only
    /// accepts a change that unlocks it (so nothing moves by accident).
    pub fn update_markup(&self, m: &Markup, actor: &str) -> Result<Markup> {
        check_kind(&m.kind)?;
        check_json(&m.data)?;
        let cur = self.get_markup(m.id)?;
        if cur.locked && m.locked && (cur.data != m.data || cur.page != m.page) {
            return Err(Error::Invalid("this markup is locked — unlock it to move or edit it".into()));
        }
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE markups SET page = ?2, kind = ?3, data = ?4, subject = ?5, comment = ?6, status = ?7,
                    z = ?8, locked = ?9, updated_by = ?10, updated_at = datetime('now')
                 WHERE id = ?1",
                params![
                    m.id,
                    m.page.max(1),
                    m.kind,
                    m.data,
                    clean(m.subject.as_deref()),
                    clean(m.comment.as_deref()),
                    if m.status == "Resolved" { "Resolved" } else { "Open" },
                    m.z,
                    m.locked as i64,
                    actor
                ],
            )?;
        }
        self.get_markup(m.id)
    }

    /// Editors may delete any redline (a markup is a note, not a record of
    /// work); the deletion is audited with what it was.
    pub fn delete_markup(&self, id: i64, actor: &str) -> Result<()> {
        let cur = self.get_markup(id)?;
        if cur.locked {
            return Err(Error::Invalid("this markup is locked — unlock it first".into()));
        }
        {
            let conn = self.conn.lock().unwrap();
            conn.execute("DELETE FROM markups WHERE id = ?1", [id])?;
        }
        self.audit(
            actor,
            "delete",
            "markup",
            &id.to_string(),
            &format!("{} on drawing {} p{}{}", cur.kind, cur.drawing_id, cur.page, cur.subject.map(|s| format!(" — {s}")).unwrap_or_default()),
        );
        Ok(())
    }

    /// Set the draw order of several markups at once (bring to front / send
    /// to back): `order` lists (id, z).
    pub fn reorder_markups(&self, order: &[(i64, i64)]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for (id, z) in order {
            tx.execute("UPDATE markups SET z = ?2, updated_at = datetime('now') WHERE id = ?1", params![id, z])?;
        }
        tx.commit()?;
        Ok(())
    }

    // ---- Tool Chest -------------------------------------------------------

    pub fn list_markup_tools(&self) -> Result<Vec<MarkupTool>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {TOOL_COLS} FROM markup_tools ORDER BY category COLLATE NOCASE, sort, name COLLATE NOCASE, id"
        ))?;
        let rows = stmt.query_map([], tool_from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn create_markup_tool(&self, t: &MarkupTool, actor: &str) -> Result<MarkupTool> {
        check_kind(&t.kind)?;
        check_json(&t.data)?;
        let category = clean(Some(&t.category)).ok_or_else(|| Error::Invalid("a tool set name is required".into()))?;
        let name = clean(Some(&t.name)).ok_or_else(|| Error::Invalid("a tool name is required".into()))?;
        let mode = if t.mode == "properties" && t.kind != "group" { "properties" } else { "drawing" };
        let id = {
            let conn = self.conn.lock().unwrap();
            let sort: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(sort), 0) + 1 FROM markup_tools WHERE category = ?1 COLLATE NOCASE",
                    [&category],
                    |r| r.get(0),
                )
                .unwrap_or(1);
            conn.execute(
                "INSERT INTO markup_tools (category, name, kind, data, mode, sort, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![category, name, t.kind, t.data, mode, sort, actor],
            )?;
            conn.last_insert_rowid()
        };
        self.audit(actor, "create", "markup_tool", &id.to_string(), &format!("{name} in {category}"));
        let conn = self.conn.lock().unwrap();
        conn.query_row(&format!("SELECT {TOOL_COLS} FROM markup_tools WHERE id = ?1"), [id], tool_from_row)
            .map_err(|_| Error::NotFound)
    }

    /// Rename / re-file / re-mode a tool (data may be replaced too).
    pub fn update_markup_tool(&self, t: &MarkupTool, actor: &str) -> Result<MarkupTool> {
        check_kind(&t.kind)?;
        check_json(&t.data)?;
        let category = clean(Some(&t.category)).ok_or_else(|| Error::Invalid("a tool set name is required".into()))?;
        let name = clean(Some(&t.name)).ok_or_else(|| Error::Invalid("a tool name is required".into()))?;
        let mode = if t.mode == "properties" && t.kind != "group" { "properties" } else { "drawing" };
        let n = {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE markup_tools SET category = ?2, name = ?3, kind = ?4, data = ?5, mode = ?6, sort = ?7, updated_at = datetime('now') WHERE id = ?1",
                params![t.id, category, name, t.kind, t.data, mode, t.sort],
            )?
        };
        if n == 0 {
            return Err(Error::NotFound);
        }
        self.audit(actor, "update", "markup_tool", &t.id.to_string(), &format!("{name} in {category}"));
        let conn = self.conn.lock().unwrap();
        conn.query_row(&format!("SELECT {TOOL_COLS} FROM markup_tools WHERE id = ?1"), [t.id], tool_from_row)
            .map_err(|_| Error::NotFound)
    }

    pub fn delete_markup_tool(&self, id: i64, actor: &str) -> Result<()> {
        let name: Option<String> = {
            let conn = self.conn.lock().unwrap();
            let name = conn
                .query_row("SELECT name || ' (' || category || ')' FROM markup_tools WHERE id = ?1", [id], |r| r.get(0))
                .optional()?;
            conn.execute("DELETE FROM markup_tools WHERE id = ?1", [id])?;
            name
        };
        if let Some(n) = name {
            self.audit(actor, "delete", "markup_tool", &id.to_string(), &n);
        }
        Ok(())
    }

    /// Rename a tool set (category) everywhere.
    pub fn rename_markup_category(&self, from: &str, to: &str, actor: &str) -> Result<i64> {
        let to = clean(Some(to)).ok_or_else(|| Error::Invalid("a tool set name is required".into()))?;
        let n = {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE markup_tools SET category = ?2, updated_at = datetime('now') WHERE category = ?1 COLLATE NOCASE",
                params![from.trim(), to],
            )? as i64
        };
        if n > 0 {
            self.audit(actor, "rename", "markup_tool", "-", &format!("tool set '{}' → '{}' ({n} tools)", from.trim(), to));
        }
        Ok(n)
    }
}
