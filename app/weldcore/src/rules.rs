//! NDE rule-set persistence — the active examination rules, their revisions,
//! and the in-memory cache every engine call reads from.
//!
//! Document control: the active rule set is locked. A change is saved under a
//! new revision id and then activated; the previous revision is retired but
//! kept, because welds carry the id of the rule set they were judged against
//! (`welds.nde_rule_set`) and that provenance must stay resolvable.

use crate::nde::RuleSet;
use crate::welds::{apply_nde_snapshot, weld_from_row, COLS};
use crate::{Error, Result, Store, Weld};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// How long the cached active rule set is trusted before it is re-read, so a
/// rule set activated from another machine on a shared database takes effect
/// within moments everywhere.
const CACHE_TTL: Duration = Duration::from_secs(20);

pub const ACTIVE: &str = "active";
pub const DRAFT: &str = "draft";
pub const RETIRED: &str = "retired";

/// The cached active rule set.
pub struct RulesCache {
    current: Arc<RuleSet>,
    loaded: Instant,
}

impl RulesCache {
    pub fn new() -> std::sync::RwLock<RulesCache> {
        std::sync::RwLock::new(RulesCache {
            current: Arc::new(RuleSet::ep_5_5_1()),
            loaded: Instant::now(),
        })
    }
}

/// A rule set as listed: identity, status and how many welds were judged under it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleSetMeta {
    pub id: String,
    pub name: String,
    pub revision: String,
    pub status: String,
    pub builtin: bool,
    pub created_by: Option<String>,
    pub created_at: String,
    pub updated_by: Option<String>,
    pub updated_at: String,
    pub activated_at: Option<String>,
    /// Welds whose requirement snapshot was computed against this rule set.
    pub weld_count: i64,
}

/// What a re-evaluation pass did.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReevaluateOutcome {
    /// Live, not-yet-examined welds looked at.
    pub scanned: i64,
    /// Welds whose requirement snapshot changed.
    pub changed: i64,
    /// Welds left unresolved under the active rules.
    pub unresolved: i64,
    pub rule_set: String,
}

impl Store {
    /// The active rule set. Served from cache; re-read from the database once
    /// the cache is older than [`CACHE_TTL`]. Never blocks on the connection:
    /// if it is busy the cached copy is returned and the refresh waits.
    pub fn rules(&self) -> Arc<RuleSet> {
        {
            let c = self.rules.read().unwrap();
            if c.loaded.elapsed() < CACHE_TTL {
                return c.current.clone();
            }
        }
        match self.try_load_active_rules() {
            Some(Ok(rs)) => {
                let mut c = self.rules.write().unwrap();
                c.current = Arc::new(rs);
                c.loaded = Instant::now();
                c.current.clone()
            }
            _ => self.rules.read().unwrap().current.clone(),
        }
    }

    /// Force the cache to re-read the active rule set (after a local change).
    pub(crate) fn refresh_rules(&self) -> Result<()> {
        let rs = self.load_active_rules()?;
        let mut c = self.rules.write().unwrap();
        c.current = Arc::new(rs);
        c.loaded = Instant::now();
        Ok(())
    }

    fn try_load_active_rules(&self) -> Option<Result<RuleSet>> {
        let conn = self.conn.try_lock().ok()?;
        Some(load_active(&conn))
    }

    fn load_active_rules(&self) -> Result<RuleSet> {
        let conn = self.conn.lock().unwrap();
        load_active(&conn)
    }

    /// Seed the shipped rule sets. The EP 5-5-1 default becomes active on a
    /// database that has no active rule set; the ASME B31.3 template is added
    /// as a draft. Never overwrites a rule set that already exists.
    pub(crate) fn seed_rule_sets(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let has_active: i64 = conn.query_row(
            "SELECT COUNT(*) FROM nde_rule_sets WHERE status = 'active'",
            [],
            |r| r.get(0),
        )?;
        for (key, status) in [
            ("ep-5-5-1", if has_active == 0 { ACTIVE } else { DRAFT }),
            ("asme-b31.3", DRAFT),
        ] {
            let rs = RuleSet::preset(key).expect("shipped preset");
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM nde_rule_sets WHERE id = ?1",
                params![rs.id],
                |r| r.get(0),
            )?;
            if exists > 0 {
                continue;
            }
            let json = serde_json::to_string(&rs).map_err(|e| Error::Invalid(e.to_string()))?;
            conn.execute(
                "INSERT INTO nde_rule_sets (id, name, revision, status, builtin, json, created_by, updated_by, activated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, 'system', 'system', CASE WHEN ?4 = 'active' THEN datetime('now') ELSE NULL END)",
                params![rs.id, rs.name, rs.revision, status, json],
            )?;
        }
        // Self-heal: a database whose only active rule set was deleted by hand
        // falls back to the shipped default rather than running with none.
        let has_active: i64 = conn.query_row(
            "SELECT COUNT(*) FROM nde_rule_sets WHERE status = 'active'",
            [],
            |r| r.get(0),
        )?;
        if has_active == 0 {
            let def = RuleSet::ep_5_5_1();
            conn.execute(
                "UPDATE nde_rule_sets SET status = 'active', activated_at = datetime('now') WHERE id = ?1",
                params![def.id],
            )?;
        }
        Ok(())
    }

    /// Test hook: run the seeding again (must be idempotent).
    #[doc(hidden)]
    pub fn seed_rule_sets_for_test(&self) {
        self.seed_rule_sets().expect("seed rule sets");
    }

    /// Every rule set, active first, then drafts, then retired (newest first).
    pub fn list_rule_sets(&self) -> Result<Vec<RuleSetMeta>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT r.id, r.name, COALESCE(r.revision, ''), r.status, r.builtin, r.created_by, r.created_at,
                    r.updated_by, r.updated_at, r.activated_at,
                    (SELECT COUNT(*) FROM welds w WHERE w.nde_rule_set = r.id) AS weld_count
             FROM nde_rule_sets r
             ORDER BY CASE r.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, r.updated_at DESC, r.id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(RuleSetMeta {
                id: r.get(0)?,
                name: r.get(1)?,
                revision: r.get(2)?,
                status: r.get(3)?,
                builtin: r.get::<_, i64>(4)? != 0,
                created_by: r.get(5)?,
                created_at: r.get(6)?,
                updated_by: r.get(7)?,
                updated_at: r.get(8)?,
                activated_at: r.get(9)?,
                weld_count: r.get(10)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// One rule set by id.
    pub fn get_rule_set(&self, id: &str) -> Result<RuleSet> {
        let conn = self.conn.lock().unwrap();
        let json: Option<String> = conn
            .query_row(
                "SELECT json FROM nde_rule_sets WHERE id = ?1",
                params![id.trim()],
                |r| r.get(0),
            )
            .optional()?;
        let json = json.ok_or(Error::NotFound)?;
        serde_json::from_str(&json)
            .map_err(|e| Error::Invalid(format!("stored rule set is unreadable: {e}")))
    }

    fn rule_set_meta(&self, id: &str) -> Result<RuleSetMeta> {
        self.list_rule_sets()?
            .into_iter()
            .find(|m| m.id == id)
            .ok_or(Error::NotFound)
    }

    /// Save a rule set as a draft (new, or replacing an existing draft).
    /// Refused for the active rule set, for a shipped preset, and for any
    /// revision that has already judged welds — those are history.
    pub fn save_rule_set(&self, rs: &RuleSet, actor: &str) -> Result<RuleSetMeta> {
        let problems = rs.validate();
        if !problems.is_empty() {
            return Err(Error::Invalid(problems.join(" ")));
        }
        let id = rs.id.trim().to_string();
        {
            let conn = self.conn.lock().unwrap();
            let existing: Option<(String, i64)> = conn
                .query_row(
                    "SELECT status, builtin FROM nde_rule_sets WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((status, builtin)) = existing {
                if status == ACTIVE {
                    return Err(Error::Invalid(format!(
                        "{id} is the active rule set and is locked (document control). Save your changes under a new revision id, then activate it."
                    )));
                }
                if builtin != 0 {
                    return Err(Error::Invalid(format!(
                        "{id} is shipped with the app and can't be changed. Save your changes under a new id."
                    )));
                }
                let used: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM welds WHERE nde_rule_set = ?1",
                    params![id],
                    |r| r.get(0),
                )?;
                if used > 0 {
                    return Err(Error::Invalid(format!(
                        "{id} has already judged {used} weld{}; its record can't change. Save your changes under a new revision id.",
                        if used == 1 { "" } else { "s" }
                    )));
                }
            }
            let json = serde_json::to_string(rs).map_err(|e| Error::Invalid(e.to_string()))?;
            conn.execute(
                "INSERT INTO nde_rule_sets (id, name, revision, status, builtin, json, created_by, updated_by)
                 VALUES (?1, ?2, ?3, 'draft', 0, ?4, ?5, ?5)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, revision = excluded.revision,
                    json = excluded.json, updated_by = excluded.updated_by, updated_at = datetime('now')",
                params![id, rs.name.trim(), rs.revision.trim(), json, actor],
            )?;
        }
        self.audit(
            actor,
            "save",
            "nde_rules",
            &id,
            &format!("{} — {} (draft)", rs.name.trim(), rs.revision.trim()),
        );
        self.rule_set_meta(&id)
    }

    /// Make a rule set the one every new judgement uses. The previous active
    /// rule set is retired (kept for provenance).
    pub fn activate_rule_set(&self, id: &str, actor: &str) -> Result<RuleSetMeta> {
        let id = id.trim().to_string();
        let rs = self.get_rule_set(&id)?;
        let problems = rs.validate();
        if !problems.is_empty() {
            return Err(Error::Invalid(format!(
                "Can't activate: {}",
                problems.join(" ")
            )));
        }
        let previous: Option<String> = {
            let mut conn = self.conn.lock().unwrap();
            let tx = conn.transaction()?;
            let prev: Option<String> = tx
                .query_row(
                    "SELECT id FROM nde_rule_sets WHERE status = 'active'",
                    [],
                    |r| r.get(0),
                )
                .optional()?;
            if prev.as_deref() == Some(id.as_str()) {
                return self.rule_set_meta(&id);
            }
            tx.execute(
                "UPDATE nde_rule_sets SET status = 'retired' WHERE status = 'active'",
                [],
            )?;
            let n = tx.execute(
                "UPDATE nde_rule_sets SET status = 'active', activated_at = datetime('now'), updated_by = ?2, updated_at = datetime('now') WHERE id = ?1",
                params![id, actor],
            )?;
            if n == 0 {
                return Err(Error::NotFound);
            }
            tx.commit()?;
            prev
        };
        self.refresh_rules()?;
        self.audit(
            actor,
            "activate",
            "nde_rules",
            &id,
            &format!(
                "{} — {} now governs new welds{}",
                rs.name,
                rs.revision,
                previous
                    .map(|p| format!(" (replaces {p})"))
                    .unwrap_or_default()
            ),
        );
        self.rule_set_meta(&id)
    }

    /// Remove a draft or retired rule set that never judged a weld. Shipped
    /// presets and the active rule set can't be deleted.
    pub fn delete_rule_set(&self, id: &str, actor: &str) -> Result<()> {
        let id = id.trim().to_string();
        {
            let conn = self.conn.lock().unwrap();
            let row: Option<(String, i64)> = conn
                .query_row(
                    "SELECT status, builtin FROM nde_rule_sets WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let (status, builtin) = row.ok_or(Error::NotFound)?;
            if status == ACTIVE {
                return Err(Error::Invalid(
                    "The active rule set can't be deleted — activate another one first.".into(),
                ));
            }
            if builtin != 0 {
                return Err(Error::Invalid(
                    "Rule sets shipped with the app can't be deleted.".into(),
                ));
            }
            let used: i64 = conn.query_row(
                "SELECT COUNT(*) FROM welds WHERE nde_rule_set = ?1",
                params![id],
                |r| r.get(0),
            )?;
            if used > 0 {
                return Err(Error::Invalid(format!(
                    "{id} judged {used} weld{} and stays on record. It can be retired but not deleted.",
                    if used == 1 { "" } else { "s" }
                )));
            }
            conn.execute("DELETE FROM nde_rule_sets WHERE id = ?1", params![id])?;
        }
        self.audit(actor, "delete", "nde_rules", &id, "rule set deleted");
        Ok(())
    }

    /// Recompute the requirement snapshot of every live weld that has not been
    /// examined yet, against the active rule set. Examined welds and voided
    /// welds are left exactly as judged. Returns what changed.
    pub fn reevaluate_unexamined_welds(&self, actor: &str) -> Result<ReevaluateOutcome> {
        let rules = self.rules();
        let welds: Vec<Weld> = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLS} FROM welds
                 WHERE voided_at IS NULL
                   AND (nde_result IS NULL OR TRIM(nde_result) = '')
                   AND (rt_date IS NULL OR TRIM(rt_date) = '')
                 ORDER BY id"
            ))?;
            let rows = stmt.query_map([], weld_from_row)?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let mut changed = 0i64;
        let mut unresolved = 0i64;
        {
            let mut conn = self.conn.lock().unwrap();
            let tx = conn.transaction()?;
            for old in &welds {
                let mut w = old.clone();
                apply_nde_snapshot(&rules, &mut w);
                if !w.expected_nde_resolved {
                    unresolved += 1;
                }
                let same = w.expected_nde_percent == old.expected_nde_percent
                    && w.expected_nde_method == old.expected_nde_method
                    && w.expected_nde_note == old.expected_nde_note
                    && w.expected_nde_resolved == old.expected_nde_resolved
                    && w.expected_nde_blockers == old.expected_nde_blockers
                    && w.nde_rule_set == old.nde_rule_set
                    && w.required_nde_method == old.required_nde_method;
                if same {
                    continue;
                }
                tx.execute(
                    "UPDATE welds SET expected_nde_percent = ?2, expected_nde_method = ?3, expected_nde_note = ?4,
                        expected_nde_resolved = ?5, expected_nde_blockers = ?6, nde_rule_set = ?7, required_nde_method = ?8
                     WHERE id = ?1",
                    params![
                        w.id,
                        w.expected_nde_percent,
                        w.expected_nde_method,
                        w.expected_nde_note,
                        w.expected_nde_resolved as i64,
                        w.expected_nde_blockers,
                        w.nde_rule_set,
                        w.required_nde_method
                    ],
                )?;
                changed += 1;
            }
            tx.commit()?;
        }
        let outcome = ReevaluateOutcome {
            scanned: welds.len() as i64,
            changed,
            unresolved,
            rule_set: rules.id.clone(),
        };
        self.audit(
            actor,
            "reevaluate",
            "nde_rules",
            &rules.id,
            &format!(
                "re-evaluated {} unexamined weld{}: {} changed, {} unresolved",
                outcome.scanned,
                if outcome.scanned == 1 { "" } else { "s" },
                changed,
                unresolved
            ),
        );
        Ok(outcome)
    }
}

fn load_active(conn: &rusqlite::Connection) -> Result<RuleSet> {
    let json: Option<String> = conn
        .query_row(
            "SELECT json FROM nde_rule_sets WHERE status = 'active'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    match json {
        Some(j) => serde_json::from_str(&j)
            .map_err(|e| Error::Invalid(format!("active rule set is unreadable: {e}"))),
        None => Ok(RuleSet::ep_5_5_1()),
    }
}
