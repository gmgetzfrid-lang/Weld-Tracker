//! NDE lots — ASME B31.3 lot-based random examination.
//!
//! A lot bounds the population a random-examination percentage is judged
//! against, so "5% of this welder's welds" stays a meaningful, recent number
//! instead of a fraction of everything they ever welded. It is also the unit
//! progressive sampling (341.3.4) escalates within: a reject means two more of
//! that welder's welds from the same lot, and so on to 100%.
//!
//! Model
//! * Every live weld belongs to at most one lot (`welds.nde_lot_id`).
//! * Exactly one lot is the receiving (default) lot; new welds fall into it.
//!   Work orders can be pinned to another Open lot, and several lots may run
//!   at once. A late-logged weld goes to the lot that was receiving on its
//!   weld date, as long as that lot has not been closed.
//! * Lifecycle: Open → Closing (no new welds, results still land) → Closed
//!   (frozen; reopen with a reason). Film comes back days after welding, so a
//!   turned-over lot sits in Closing until its coverage is met — then it closes
//!   itself. Closing short is allowed, never silent: a reason is required and
//!   what was owed is frozen onto the record.
//! * Turnover: after the configured length (default three months) the lot is
//!   either rolled automatically or the user is prompted, per configuration.

use crate::reports::{
    canonical_spec_index, spec_predicate_sql, NdeSpecStat, PerformanceReport, PerformanceRow,
    ReportScope,
};
use crate::{Error, Result, Store, Weld};
use chrono::{Local, Months, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const OPEN: &str = "Open";
pub const CLOSING: &str = "Closing";
pub const CLOSED: &str = "Closed";

const SYSTEM: &str = "system";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Lot behaviour, stored in `settings`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LotConfig {
    /// Lots on at all. Off = every weld is unassigned and reports are date-based.
    pub enabled: bool,
    /// Expected lot length in calendar months (the shop convention is 3).
    pub target_months: i64,
    /// At the target the system turns the lot over itself; otherwise it asks.
    pub auto_rollover: bool,
    /// Lot number prefix: `{prefix}-{year}-{nn}`.
    pub prefix: String,
    /// Turnover prompt snoozed until this date (manual mode).
    pub snooze_until: Option<String>,
    /// The setup wizard has run once.
    pub setup_done: bool,
}

impl Default for LotConfig {
    fn default() -> Self {
        LotConfig {
            enabled: false,
            target_months: 3,
            auto_rollover: false,
            prefix: "LOT".to_string(),
            snooze_until: None,
            setup_done: false,
        }
    }
}

/// One lot with its live figures.
#[derive(Debug, Clone, Serialize)]
pub struct NdeLot {
    pub id: i64,
    pub lot_no: String,
    pub label: Option<String>,
    pub status: String,
    pub is_default: bool,
    pub was_default: bool,
    pub opened_on: String,
    pub target_days: i64,
    pub closing_on: Option<String>,
    pub closed_on: Option<String>,
    pub closed_by: Option<String>,
    pub close_reason: Option<String>,
    pub closed_short: bool,
    pub shortfall_snapshot: Option<String>,
    pub notes: Option<String>,
    pub created_by: Option<String>,
    // ---- live figures --------------------------------------------------
    pub weld_count: i64,
    pub weld_inches: f64,
    pub first_weld: Option<String>,
    pub last_weld: Option<String>,
    pub work_order_count: i64,
    pub welder_count: i64,
    pub examined: i64,
    pub rejects: i64,
    /// Examinations still owed across every welder and spec (progressive
    /// sampling included).
    pub owed: i64,
    /// Welds whose Table 4 requirement could not be resolved (block a clean close).
    pub unresolved: i64,
    pub age_days: i64,
    pub due_on: String,
    pub overdue_days: i64,
}

/// A work order's footprint inside one lot.
#[derive(Debug, Clone, Serialize)]
pub struct LotWorkOrder {
    pub work_order: String,
    pub weld_count: i64,
    pub weld_inches: f64,
    pub examined: i64,
    pub rejects: i64,
    pub first_weld: Option<String>,
    pub last_weld: Option<String>,
    /// The work order also has live welds outside this lot (it spans lots).
    pub spans_other_lots: bool,
    pub welders: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NdeTypeCount {
    pub method: String,
    pub count: i64,
}

/// The lot card: everything the closeout record shows.
#[derive(Debug, Serialize)]
pub struct LotCard {
    pub lot: NdeLot,
    /// Per-welder coverage (progressive sampling applied), fleet by-spec, totals.
    pub report: PerformanceReport,
    pub work_orders: Vec<LotWorkOrder>,
    pub nde_by_type: Vec<NdeTypeCount>,
    pub owed: i64,
    pub unresolved: i64,
    /// Nothing owed and nothing unresolved: the lot can close clean.
    pub clean: bool,
    pub spanning_work_orders: i64,
    pub generated_on: String,
}

/// Something the user must not be allowed to forget.
#[derive(Debug, Clone, Serialize)]
pub struct AttentionItem {
    /// turnover_due | closeout | closeout_ready | current_owed | unresolved | wo_nde
    pub kind: String,
    /// error | warning | info
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub lot_id: Option<i64>,
    pub lot_no: Option<String>,
    pub work_order: Option<String>,
    pub count: i64,
}

/// What the autonomous maintenance pass did (and what it wants to ask).
#[derive(Debug, Clone, Serialize, Default)]
pub struct MaintainOutcome {
    pub enabled: bool,
    pub created_default: Option<String>,
    /// [old lot no, new lot no] when a turnover happened.
    pub turned_over: Option<[String; 2]>,
    pub auto_closed: Vec<String>,
    /// Manual mode: the receiving lot has reached its target — ask the user.
    pub turnover_due: Option<NdeLot>,
}

/// A weld suggested for examination to meet what a welder owes.
#[derive(Debug, Clone, Serialize)]
pub struct SuggestedExam {
    pub weld_id: i64,
    pub weld_number: Option<String>,
    pub work_order: Option<String>,
    pub drawing_no: Option<String>,
    pub stamp: String,
    pub name: String,
    pub spec: String,
    pub joint_type: Option<String>,
    pub size: Option<f64>,
    pub date_welded: Option<String>,
    pub required_nde_method: Option<String>,
    pub reason: String,
}

/// One welder/spec debt that a given work order could help pay down.
#[derive(Debug, Clone, Serialize)]
pub struct WoLotOwed {
    pub lot_id: i64,
    pub lot_no: String,
    pub lot_status: String,
    pub stamp: String,
    pub name: String,
    pub spec: String,
    pub owed: i64,
    /// Un-examined welds by this welder, carrying this spec, on this work order.
    pub candidates_here: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct WoLotRef {
    pub lot_id: i64,
    pub lot_no: String,
    pub status: String,
    pub weld_count: i64,
}

/// A work order's lot picture for its record page.
#[derive(Debug, Clone, Serialize, Default)]
pub struct WoLotSummary {
    pub enabled: bool,
    pub lots: Vec<WoLotRef>,
    pub pinned_lot_id: Option<i64>,
    pub owed: Vec<WoLotOwed>,
    /// Examinations that could be satisfied on this work order right now.
    pub total_owed_here: i64,
}

/// A work order as the pin/move dialog lists it.
#[derive(Debug, Clone, Serialize)]
pub struct LotWoChoice {
    pub work_order: String,
    pub weld_count: i64,
    pub lots: Vec<String>,
    pub pinned_lot_id: Option<i64>,
    pub last_activity: Option<String>,
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

fn today() -> NaiveDate {
    Local::now().date_naive()
}
fn today_str() -> String {
    today().format("%Y-%m-%d").to_string()
}
fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok()
}
fn fmt(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}
/// Days in `months` calendar months starting at `from`.
fn months_to_days(from: NaiveDate, months: i64) -> i64 {
    let m = months.clamp(1, 120) as u32;
    let due = from.checked_add_months(Months::new(m)).unwrap_or(from);
    (due - from).num_days().max(1)
}

/// Canonical spec index (0=5%, 1=10%, 2=20%, 3=100%, 4=API 570) from a spec
/// stat's label.
fn spec_index_of(spec: &str) -> usize {
    ["5%", "10%", "20%", "100%", "API 570"]
        .iter()
        .position(|l| *l == spec)
        .unwrap_or(0)
}

fn nonblank(s: Option<&str>) -> Option<&str> {
    s.map(str::trim).filter(|s| !s.is_empty())
}

// ---------------------------------------------------------------------------
// Row reading
// ---------------------------------------------------------------------------

const LOT_COLS: &str = "id, lot_no, label, status, is_default, was_default, opened_on, target_days,
    closing_on, closed_on, closed_by, close_reason, closed_short, shortfall_snapshot, notes, created_by";

fn lot_from_row(r: &rusqlite::Row) -> rusqlite::Result<NdeLot> {
    let opened_on: String = r.get(6)?;
    let target_days: i64 = r.get(7)?;
    let closing_on: Option<String> = r.get(8)?;
    let closed_on: Option<String> = r.get(9)?;
    let t = today();
    let opened = parse_date(&opened_on).unwrap_or(t);
    // A lot's age stops when it stops taking welds.
    let end = closing_on
        .as_deref()
        .or(closed_on.as_deref())
        .and_then(parse_date)
        .unwrap_or(t);
    let age_days = (end - opened).num_days().max(0);
    let due = opened + chrono::Duration::days(target_days);
    let overdue_days = if closing_on.is_none() && closed_on.is_none() {
        (t - due).num_days().max(0)
    } else {
        0
    };
    Ok(NdeLot {
        id: r.get(0)?,
        lot_no: r.get(1)?,
        label: r.get(2)?,
        status: r.get(3)?,
        is_default: r.get::<_, i64>(4)? != 0,
        was_default: r.get::<_, i64>(5)? != 0,
        opened_on,
        target_days,
        closing_on,
        closed_on,
        closed_by: r.get(10)?,
        close_reason: r.get(11)?,
        closed_short: r.get::<_, i64>(12)? != 0,
        shortfall_snapshot: r.get(13)?,
        notes: r.get(14)?,
        created_by: r.get(15)?,
        weld_count: 0,
        weld_inches: 0.0,
        first_weld: None,
        last_weld: None,
        work_order_count: 0,
        welder_count: 0,
        examined: 0,
        rejects: 0,
        owed: 0,
        unresolved: 0,
        age_days,
        due_on: fmt(due),
        overdue_days,
    })
}

/// `WHERE` fragment selecting the live, counted welds of lot ?1.
const LIVE_IN_LOT: &str = "nde_lot_id = ?1 AND count_omission = 0 AND voided_at IS NULL";
const EXAMINED_SQL: &str = "((nde_result IS NOT NULL AND TRIM(nde_result) <> '') OR (rt_date IS NOT NULL AND TRIM(rt_date) <> ''))";
const REJECTED_SQL: &str = "(nde_result = 'Rejected' OR rt_rejected = 'Y')";

impl Store {
    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    pub fn lot_config(&self) -> Result<LotConfig> {
        let s = self.get_settings()?;
        let d = LotConfig::default();
        let flag = |k: &str, dflt: bool| {
            s.get(k)
                .map(|v| matches!(v.trim(), "1" | "true" | "yes"))
                .unwrap_or(dflt)
        };
        Ok(LotConfig {
            enabled: flag("lots_enabled", d.enabled),
            target_months: s
                .get("lot_target_months")
                .and_then(|v| v.trim().parse::<i64>().ok())
                .filter(|m| (1..=120).contains(m))
                .unwrap_or(d.target_months),
            auto_rollover: flag("lot_auto_rollover", d.auto_rollover),
            prefix: s
                .get("lot_prefix")
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .unwrap_or(d.prefix),
            snooze_until: s
                .get("lot_snooze_until")
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            setup_done: flag("lot_setup_done", d.setup_done),
        })
    }

    /// Save the lot configuration. A new expected length also re-targets every
    /// lot still taking welds, so the change is felt immediately.
    pub fn set_lot_config(&self, cfg: &LotConfig, actor: &str) -> Result<LotConfig> {
        if !(1..=120).contains(&cfg.target_months) {
            return Err(Error::Invalid(
                "expected lot length must be 1 to 120 months".into(),
            ));
        }
        let prefix: String = cfg
            .prefix
            .trim()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .take(12)
            .collect::<String>()
            .to_uppercase();
        if prefix.is_empty() {
            return Err(Error::Invalid(
                "lot prefix is required (letters/numbers)".into(),
            ));
        }
        self.set_setting("lots_enabled", if cfg.enabled { "1" } else { "0" })?;
        self.set_setting("lot_target_months", &cfg.target_months.to_string())?;
        self.set_setting(
            "lot_auto_rollover",
            if cfg.auto_rollover { "1" } else { "0" },
        )?;
        self.set_setting("lot_prefix", &prefix)?;
        self.set_setting("lot_setup_done", if cfg.setup_done { "1" } else { "0" })?;
        self.audit(
            actor,
            "configure",
            "lot",
            "config",
            &format!(
                "lots {} · {} month{} · {} rollover · prefix {}",
                if cfg.enabled { "on" } else { "off" },
                cfg.target_months,
                if cfg.target_months == 1 { "" } else { "s" },
                if cfg.auto_rollover {
                    "automatic"
                } else {
                    "prompted"
                },
                prefix
            ),
        );
        self.lot_config()
    }

    /// First-run setup: save the configuration, open the first receiving lot
    /// and optionally sweep existing unassigned welds into it. `history` is
    /// "all", "none", or "from:YYYY-MM-DD". Returns (lot, welds swept).
    pub fn setup_lots(&self, cfg: &LotConfig, history: &str, actor: &str) -> Result<(NdeLot, i64)> {
        let mut cfg = cfg.clone();
        cfg.enabled = true;
        cfg.setup_done = true;
        let cfg = self.set_lot_config(&cfg, actor)?;
        let from_date: Option<String> = match history.trim() {
            "all" => {
                let conn = self.conn.lock().unwrap();
                conn.query_row(
                    "SELECT MIN(date_welded) FROM welds WHERE nde_lot_id IS NULL AND voided_at IS NULL
                       AND date_welded IS NOT NULL AND TRIM(date_welded) <> ''",
                    [],
                    |r| r.get::<_, Option<String>>(0),
                )?
            }
            h if h.starts_with("from:") => parse_date(&h[5..]).map(fmt),
            _ => None,
        };
        let lot = match self.default_lot()? {
            Some(l) => l,
            None => {
                let opened_on = from_date
                    .as_deref()
                    .and_then(parse_date)
                    .map(fmt)
                    .unwrap_or_else(today_str);
                let label = if history.trim() == "all" {
                    Some("Historical".to_string())
                } else {
                    None
                };
                self.create_lot_with(actor, label, true, &opened_on, &cfg, None)?
            }
        };
        let swept = match history.trim() {
            "none" | "" => 0,
            "all" => {
                let conn = self.conn.lock().unwrap();
                conn.execute(
                    "UPDATE welds SET nde_lot_id = ?1 WHERE nde_lot_id IS NULL AND voided_at IS NULL",
                    params![lot.id],
                )? as i64
            }
            _ => {
                let d = from_date
                    .clone()
                    .ok_or_else(|| Error::Invalid("history start date is invalid".into()))?;
                let conn = self.conn.lock().unwrap();
                conn.execute(
                    "UPDATE welds SET nde_lot_id = ?1 WHERE nde_lot_id IS NULL AND voided_at IS NULL
                       AND date_welded IS NOT NULL AND date_welded >= ?2",
                    params![lot.id, d],
                )? as i64
            }
        };
        if swept > 0 {
            self.audit(
                actor,
                "sweep",
                "lot",
                &lot.id.to_string(),
                &format!("{swept} existing welds placed in {}", lot.lot_no),
            );
        }
        Ok((self.get_lot(lot.id)?, swept))
    }

    pub fn snooze_turnover(&self, days: i64, actor: &str) -> Result<LotConfig> {
        let until = today() + chrono::Duration::days(days.clamp(1, 365));
        self.set_setting("lot_snooze_until", &fmt(until))?;
        self.audit(
            actor,
            "snooze",
            "lot",
            "turnover",
            &format!("turnover prompt snoozed until {}", fmt(until)),
        );
        self.lot_config()
    }

    // -----------------------------------------------------------------------
    // Reading lots
    // -----------------------------------------------------------------------

    fn lot_row(&self, id: i64) -> Result<NdeLot> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            &format!("SELECT {LOT_COLS} FROM nde_lots WHERE id = ?1"),
            [id],
            lot_from_row,
        )
        .map_err(|_| Error::NotFound)
    }

    /// Fill a lot's live figures (counts, dates, coverage owed).
    fn hydrate(&self, mut lot: NdeLot) -> Result<NdeLot> {
        {
            let conn = self.conn.lock().unwrap();
            let sql = format!(
                "SELECT COUNT(*), COALESCE(SUM(weld_inches), 0), MIN(date_welded), MAX(date_welded),
                        COUNT(DISTINCT CASE WHEN work_order IS NOT NULL AND work_order <> '' THEN UPPER(work_order) END),
                        COUNT(DISTINCT CASE WHEN stamp_number IS NOT NULL AND stamp_number <> '' THEN UPPER(stamp_number) END),
                        SUM(CASE WHEN {EXAMINED_SQL} THEN 1 ELSE 0 END),
                        SUM(CASE WHEN {REJECTED_SQL} THEN 1 ELSE 0 END),
                        SUM(CASE WHEN COALESCE(expected_nde_resolved, 1) = 0 THEN 1 ELSE 0 END)
                 FROM welds WHERE {LIVE_IN_LOT}"
            );
            conn.query_row(&sql, [lot.id], |r| {
                lot.weld_count = r.get(0)?;
                lot.weld_inches = r.get(1)?;
                lot.first_weld = r.get(2)?;
                lot.last_weld = r.get(3)?;
                lot.work_order_count = r.get(4)?;
                lot.welder_count = r.get(5)?;
                lot.examined = r.get::<_, Option<i64>>(6)?.unwrap_or(0);
                lot.rejects = r.get::<_, Option<i64>>(7)?.unwrap_or(0);
                lot.unresolved = r.get::<_, Option<i64>>(8)?.unwrap_or(0);
                Ok(())
            })?;
        }
        if lot.weld_count > 0 {
            let rep = self.report_performance_scoped(ReportScope::Lot(lot.id))?;
            lot.owed = rep.by_spec.iter().map(|s| s.shortfall).sum();
        }
        Ok(lot)
    }

    pub fn get_lot(&self, id: i64) -> Result<NdeLot> {
        let lot = self.lot_row(id)?;
        self.hydrate(lot)
    }

    /// Every lot, receiving lot first, then open lots, then the rest newest first.
    pub fn list_lots(&self) -> Result<Vec<NdeLot>> {
        let rows: Vec<NdeLot> = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare(&format!(
                "SELECT {LOT_COLS} FROM nde_lots
                 ORDER BY is_default DESC,
                          CASE status WHEN 'Open' THEN 0 WHEN 'Closing' THEN 1 ELSE 2 END,
                          opened_on DESC, id DESC"
            ))?;
            let rows = stmt.query_map([], lot_from_row)?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        rows.into_iter().map(|l| self.hydrate(l)).collect()
    }

    pub fn default_lot(&self) -> Result<Option<NdeLot>> {
        let row = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                &format!("SELECT {LOT_COLS} FROM nde_lots WHERE is_default = 1"),
                [],
                lot_from_row,
            )
            .optional()?
        };
        match row {
            Some(l) => Ok(Some(self.hydrate(l)?)),
            None => Ok(None),
        }
    }

    fn lot_status(&self, id: i64) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row("SELECT status FROM nde_lots WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .optional()?)
    }

    // -----------------------------------------------------------------------
    // Creating lots
    // -----------------------------------------------------------------------

    fn next_lot_no(conn: &Connection, prefix: &str, year: i32) -> Result<String> {
        let like = format!("{prefix}-{year}-%");
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM nde_lots WHERE lot_no LIKE ?1",
            [&like],
            |r| r.get(0),
        )?;
        // Sequence within the year; skip past anything that already exists.
        let mut k = n + 1;
        loop {
            let candidate = format!("{prefix}-{year}-{k:02}");
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM nde_lots WHERE lot_no = ?1",
                [&candidate],
                |r| r.get(0),
            )?;
            if exists == 0 {
                return Ok(candidate);
            }
            k += 1;
        }
    }

    fn insert_lot(
        conn: &Connection,
        actor: &str,
        label: Option<String>,
        make_default: bool,
        opened_on: &str,
        cfg: &LotConfig,
        target_months: Option<i64>,
    ) -> Result<i64> {
        let opened = parse_date(opened_on).unwrap_or_else(today);
        let year = parse_date(opened_on)
            .map(|d| chrono::Datelike::year(&d))
            .unwrap_or_else(|| chrono::Datelike::year(&today()));
        let lot_no = Self::next_lot_no(conn, &cfg.prefix, year)?;
        if make_default {
            conn.execute(
                "UPDATE nde_lots SET is_default = 0 WHERE is_default = 1",
                [],
            )?;
        }
        conn.execute(
            "INSERT INTO nde_lots (lot_no, label, status, is_default, was_default, opened_on, target_days, created_by)
             VALUES (?1, ?2, 'Open', ?3, ?3, ?4, ?5, ?6)",
            params![
                lot_no,
                label.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                make_default as i64,
                fmt(opened),
                months_to_days(opened, target_months.unwrap_or(cfg.target_months)),
                actor
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    fn create_lot_with(
        &self,
        actor: &str,
        label: Option<String>,
        make_default: bool,
        opened_on: &str,
        cfg: &LotConfig,
        target_months: Option<i64>,
    ) -> Result<NdeLot> {
        if let Some(m) = target_months {
            if !(1..=120).contains(&m) {
                return Err(Error::Invalid(
                    "expected lot length must be 1 to 120 months".into(),
                ));
            }
        }
        let id = {
            let conn = self.conn.lock().unwrap();
            Self::insert_lot(
                &conn,
                actor,
                label,
                make_default,
                opened_on,
                cfg,
                target_months,
            )?
        };
        let lot = self.get_lot(id)?;
        self.audit(
            actor,
            "create",
            "lot",
            &id.to_string(),
            &format!(
                "{}{}",
                lot.lot_no,
                if make_default { " (receiving)" } else { "" }
            ),
        );
        Ok(lot)
    }

    /// Open a new lot. `make_default` makes it the receiving lot. A lot may
    /// carry its own expected length; `None` takes the default.
    pub fn create_lot(
        &self,
        actor: &str,
        label: Option<String>,
        make_default: bool,
        target_months: Option<i64>,
    ) -> Result<NdeLot> {
        let cfg = self.lot_config()?;
        if !cfg.enabled {
            return Err(Error::Invalid(
                "NDE lots are turned off — enable them in lot settings first".into(),
            ));
        }
        self.create_lot_with(
            actor,
            label,
            make_default,
            &today_str(),
            &cfg,
            target_months,
        )
    }

    /// The receiving lot, created if lots are on and none exists.
    pub fn ensure_default_lot(&self, actor: &str) -> Result<Option<NdeLot>> {
        let cfg = self.lot_config()?;
        if !cfg.enabled {
            return Ok(None);
        }
        if let Some(l) = self.default_lot()? {
            return Ok(Some(l));
        }
        Ok(Some(self.create_lot_with(
            actor,
            None,
            true,
            &today_str(),
            &cfg,
            None,
        )?))
    }

    // -----------------------------------------------------------------------
    // Assigning welds
    // -----------------------------------------------------------------------

    /// The lot a newly created weld belongs to. In order: a lot the caller
    /// already chose that still accepts welds (a repair inherits its parent's);
    /// the lot its work order is pinned to, if Open; the lot that was receiving
    /// on the weld date, if it has not closed; otherwise the receiving lot.
    pub fn lot_for_new_weld(&self, w: &Weld) -> Result<Option<i64>> {
        let cfg = self.lot_config()?;
        if !cfg.enabled {
            return Ok(None);
        }
        if let Some(id) = w.nde_lot_id {
            if let Some(st) = self.lot_status(id)? {
                if st != CLOSED {
                    return Ok(Some(id));
                }
            }
        }
        {
            let conn = self.conn.lock().unwrap();
            if let Some(wo) = nonblank(w.work_order.as_deref()) {
                let pinned: Option<(i64, String)> = conn
                    .query_row(
                        "SELECT l.id, l.status FROM nde_lot_pins p JOIN nde_lots l ON l.id = p.lot_id
                         WHERE p.work_order = ?1",
                        [wo],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?;
                if let Some((id, st)) = pinned {
                    if st == OPEN {
                        return Ok(Some(id));
                    }
                }
            }
            if let Some(d) = w.date_welded.as_deref().and_then(parse_date) {
                let by_date: Option<i64> = conn
                    .query_row(
                        "SELECT id FROM nde_lots
                         WHERE was_default = 1 AND status <> 'Closed'
                           AND opened_on <= ?1 AND (closing_on IS NULL OR closing_on > ?1)
                         ORDER BY opened_on DESC, id DESC LIMIT 1",
                        [fmt(d)],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(id) = by_date {
                    return Ok(Some(id));
                }
            }
        }
        Ok(self.ensure_default_lot(SYSTEM)?.map(|l| l.id))
    }

    /// Pin a work order to an Open lot and move its live welds there (welds
    /// already frozen in a Closed lot stay put). Returns welds moved.
    pub fn pin_work_order(&self, work_order: &str, lot_id: i64, actor: &str) -> Result<i64> {
        let wo = nonblank(Some(work_order))
            .ok_or_else(|| Error::Invalid("work order is required".into()))?;
        let lot = self.lot_row(lot_id)?;
        if lot.status != OPEN {
            return Err(Error::Invalid(format!(
                "{} is {} — only an Open lot can receive a pinned work order",
                lot.lot_no,
                lot.status.to_lowercase()
            )));
        }
        let moved = {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO nde_lot_pins (work_order, lot_id, pinned_by) VALUES (?1, ?2, ?3)
                 ON CONFLICT(work_order) DO UPDATE SET lot_id = excluded.lot_id,
                     pinned_by = excluded.pinned_by, pinned_at = datetime('now')",
                params![wo, lot_id, actor],
            )?;
            Self::move_wo_welds(&conn, wo, lot_id)?
        };
        self.audit(
            actor,
            "pin",
            "lot",
            &lot_id.to_string(),
            &format!(
                "work order {wo} pinned to {} ({moved} welds moved)",
                lot.lot_no
            ),
        );
        Ok(moved)
    }

    pub fn unpin_work_order(&self, work_order: &str, actor: &str) -> Result<()> {
        let wo = nonblank(Some(work_order))
            .ok_or_else(|| Error::Invalid("work order is required".into()))?;
        let n = {
            let conn = self.conn.lock().unwrap();
            conn.execute("DELETE FROM nde_lot_pins WHERE work_order = ?1", [wo])?
        };
        if n > 0 {
            self.audit(
                actor,
                "unpin",
                "lot",
                "-",
                &format!("work order {wo} unpinned"),
            );
        }
        Ok(())
    }

    fn move_wo_welds(conn: &Connection, wo: &str, lot_id: i64) -> Result<i64> {
        Ok(conn.execute(
            "UPDATE welds SET nde_lot_id = ?1
             WHERE work_order = ?2 COLLATE NOCASE AND voided_at IS NULL
               AND (nde_lot_id IS NULL OR nde_lot_id <> ?1)
               AND (nde_lot_id IS NULL OR nde_lot_id NOT IN (SELECT id FROM nde_lots WHERE status = 'Closed'))",
            params![lot_id, wo],
        )? as i64)
    }

    /// Move a work order's live welds into a lot (Open or Closing) without
    /// pinning it. Welds frozen in a Closed lot stay. Returns welds moved.
    pub fn move_work_order(&self, work_order: &str, lot_id: i64, actor: &str) -> Result<i64> {
        let wo = nonblank(Some(work_order))
            .ok_or_else(|| Error::Invalid("work order is required".into()))?;
        let lot = self.lot_row(lot_id)?;
        if lot.status == CLOSED {
            return Err(Error::Invalid(format!(
                "{} is closed — reopen it before moving welds in",
                lot.lot_no
            )));
        }
        let moved = {
            let conn = self.conn.lock().unwrap();
            Self::move_wo_welds(&conn, wo, lot_id)?
        };
        self.audit(
            actor,
            "move",
            "lot",
            &lot_id.to_string(),
            &format!("work order {wo}: {moved} welds moved to {}", lot.lot_no),
        );
        Ok(moved)
    }

    /// Move one weld (the escape hatch). `None` takes it out of lots entirely.
    pub fn set_weld_lot(&self, weld_id: i64, lot_id: Option<i64>, actor: &str) -> Result<()> {
        if let Some(id) = lot_id {
            let lot = self.lot_row(id)?;
            if lot.status == CLOSED {
                return Err(Error::Invalid(format!(
                    "{} is closed — reopen it first",
                    lot.lot_no
                )));
            }
        }
        let n = {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE welds SET nde_lot_id = ?1 WHERE id = ?2",
                params![lot_id, weld_id],
            )?
        };
        if n == 0 {
            return Err(Error::NotFound);
        }
        self.audit(
            actor,
            "move",
            "weld",
            &weld_id.to_string(),
            &format!(
                "lot → {}",
                lot_id
                    .map(|i| i.to_string())
                    .unwrap_or_else(|| "none".into())
            ),
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /// Turn the receiving lot over: it stops taking welds (Closing) and a new
    /// receiving lot opens. Pins to the old lot are released so those work
    /// orders flow on into the new lot. Returns (old, new).
    pub fn turn_over(&self, actor: &str, reason: Option<&str>) -> Result<(Option<NdeLot>, NdeLot)> {
        let cfg = self.lot_config()?;
        if !cfg.enabled {
            return Err(Error::Invalid("NDE lots are turned off".into()));
        }
        let old = self.default_lot()?;
        let new_id = {
            let mut conn = self.conn.lock().unwrap();
            let tx = conn.transaction()?;
            if let Some(o) = &old {
                tx.execute(
                    "UPDATE nde_lots SET status = CASE WHEN status = 'Open' THEN 'Closing' ELSE status END,
                        closing_on = COALESCE(closing_on, ?2), is_default = 0, updated_at = datetime('now')
                     WHERE id = ?1",
                    params![o.id, today_str()],
                )?;
                tx.execute("DELETE FROM nde_lot_pins WHERE lot_id = ?1", [o.id])?;
            }
            let id = Self::insert_lot(&tx, actor, None, true, &today_str(), &cfg, None)?;
            tx.commit()?;
            id
        };
        let new = self.get_lot(new_id)?;
        if let Some(o) = &old {
            self.audit(
                actor,
                "turnover",
                "lot",
                &o.id.to_string(),
                &format!(
                    "{} stopped taking welds after {} days; {} is now receiving{}",
                    o.lot_no,
                    o.age_days,
                    new.lot_no,
                    reason.map(|r| format!(" — {r}")).unwrap_or_default()
                ),
            );
        } else {
            self.audit(
                actor,
                "create",
                "lot",
                &new.id.to_string(),
                &format!("{} (receiving)", new.lot_no),
            );
        }
        // A turnover satisfies any pending prompt.
        let _ = self.set_setting("lot_snooze_until", "");
        let old = match old {
            Some(o) => Some(self.get_lot(o.id)?),
            None => None,
        };
        Ok((old, new))
    }

    /// Stop a lot taking welds. On the receiving lot this is a turnover.
    pub fn stop_intake(&self, id: i64, actor: &str) -> Result<NdeLot> {
        let lot = self.lot_row(id)?;
        if lot.is_default {
            let (old, _) = self.turn_over(actor, Some("closed out by user"))?;
            return old.ok_or(Error::NotFound);
        }
        if lot.status != OPEN {
            return self.hydrate(lot);
        }
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE nde_lots SET status = 'Closing', closing_on = ?2, updated_at = datetime('now') WHERE id = ?1",
                params![id, today_str()],
            )?;
            conn.execute("DELETE FROM nde_lot_pins WHERE lot_id = ?1", [id])?;
        }
        self.audit(
            actor,
            "closing",
            "lot",
            &id.to_string(),
            &format!("{} stopped taking welds", lot.lot_no),
        );
        self.get_lot(id)
    }

    /// Close a lot. Clean when nothing is owed and every weld's requirement is
    /// resolved. Otherwise it closes only with `force` AND a reason, and what
    /// was owed is frozen onto the record as `shortfall_snapshot`. Closing the
    /// receiving lot turns it over first so new welds have somewhere to go.
    pub fn close_lot(
        &self,
        id: i64,
        actor: &str,
        reason: Option<&str>,
        force: bool,
    ) -> Result<NdeLot> {
        let lot = self.lot_row(id)?;
        if lot.status == CLOSED {
            return Err(Error::Invalid(format!("{} is already closed", lot.lot_no)));
        }
        if lot.is_default {
            self.turn_over(actor, Some("closed out by user"))?;
        }
        let card = self.lot_card(id)?;
        let reason = nonblank(reason);
        let (short, snapshot) = if card.clean {
            (false, None)
        } else {
            if !force {
                return Err(Error::Invalid(format!(
                    "{} has {} examination{} owed and {} weld{} with an unresolved requirement — record the NDE, or close short with a reason",
                    card.lot.lot_no,
                    card.owed,
                    if card.owed == 1 { "" } else { "s" },
                    card.unresolved,
                    if card.unresolved == 1 { "" } else { "s" },
                )));
            }
            if reason.is_none() {
                return Err(Error::Invalid(
                    "a reason is required to close a lot with examinations owed".into(),
                ));
            }
            let welders: Vec<serde_json::Value> = card
                .report
                .rows
                .iter()
                .flat_map(|r| {
                    r.specs.iter().filter(|s| s.shortfall > 0).map(move |s| {
                        serde_json::json!({
                            "stamp": r.stamp, "name": r.name, "spec": s.spec,
                            "owed": s.shortfall, "required": s.required, "examined": s.examined,
                            "population": s.population, "sampling": s.sampling_level,
                        })
                    })
                })
                .collect();
            let snap = serde_json::json!({
                "owed": card.owed, "unresolved": card.unresolved, "welders": welders,
            });
            (true, Some(snap.to_string()))
        };
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE nde_lots SET status = 'Closed', is_default = 0, closing_on = COALESCE(closing_on, ?2),
                    closed_on = ?2, closed_by = ?3, close_reason = ?4, closed_short = ?5,
                    shortfall_snapshot = ?6, updated_at = datetime('now')
                 WHERE id = ?1",
                params![id, today_str(), actor, reason, short as i64, snapshot],
            )?;
            conn.execute("DELETE FROM nde_lot_pins WHERE lot_id = ?1", [id])?;
        }
        self.audit(
            actor,
            "close",
            "lot",
            &id.to_string(),
            &if short {
                format!(
                    "{} closed SHORT — {} owed, {} unresolved — {}",
                    card.lot.lot_no,
                    card.owed,
                    card.unresolved,
                    reason.unwrap_or("")
                )
            } else {
                format!(
                    "{} closed clean ({} welds, {} examined)",
                    card.lot.lot_no, card.lot.weld_count, card.lot.examined
                )
            },
        );
        self.get_lot(id)
    }

    /// Reopen a closed lot into Closing (results can land, no new welds).
    pub fn reopen_lot(&self, id: i64, actor: &str, reason: &str) -> Result<NdeLot> {
        let reason = nonblank(Some(reason))
            .ok_or_else(|| Error::Invalid("a reason is required to reopen a lot".into()))?;
        let lot = self.lot_row(id)?;
        if lot.status != CLOSED {
            return Err(Error::Invalid(format!("{} is not closed", lot.lot_no)));
        }
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE nde_lots SET status = 'Closing', closed_on = NULL, closed_by = NULL, close_reason = NULL,
                    closed_short = 0, shortfall_snapshot = NULL, updated_at = datetime('now')
                 WHERE id = ?1",
                [id],
            )?;
        }
        self.audit(
            actor,
            "reopen",
            "lot",
            &id.to_string(),
            &format!(
                "{} reopened — {} (was closed {} by {}{})",
                lot.lot_no,
                reason,
                lot.closed_on.as_deref().unwrap_or("?"),
                lot.closed_by.as_deref().unwrap_or("?"),
                if lot.closed_short { ", short" } else { "" }
            ),
        );
        self.get_lot(id)
    }

    /// A lot's own settings: label, notes and expected length. Only lots that
    /// are still open or awaiting closeout can change — a closed lot is a
    /// controlled record and stays exactly as it was signed off.
    pub fn update_lot_notes(
        &self,
        id: i64,
        label: Option<&str>,
        notes: Option<&str>,
        target_months: Option<i64>,
        actor: &str,
    ) -> Result<NdeLot> {
        let lot = self.lot_row(id)?;
        if lot.status == CLOSED {
            return Err(Error::Invalid(format!(
                "{} is closed — a closed lot is locked (document control); an admin can reopen it",
                lot.lot_no
            )));
        }
        if let Some(m) = target_months {
            if !(1..=120).contains(&m) {
                return Err(Error::Invalid(
                    "expected lot length must be 1 to 120 months".into(),
                ));
            }
        }
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE nde_lots SET label = ?2, notes = ?3, updated_at = datetime('now') WHERE id = ?1",
                params![id, nonblank(label), nonblank(notes)],
            )?;
            if let Some(m) = target_months {
                let from = parse_date(&lot.opened_on).unwrap_or_else(today);
                conn.execute(
                    "UPDATE nde_lots SET target_days = ?1, updated_at = datetime('now') WHERE id = ?2",
                    params![months_to_days(from, m), id],
                )?;
            }
        }
        self.audit(
            actor,
            "update",
            "lot",
            &id.to_string(),
            &format!(
                "{} settings edited{}",
                lot.lot_no,
                target_months
                    .map(|m| format!(
                        " · expected length {m} month{}",
                        if m == 1 { "" } else { "s" }
                    ))
                    .unwrap_or_default()
            ),
        );
        self.get_lot(id)
    }

    // -----------------------------------------------------------------------
    // The card
    // -----------------------------------------------------------------------

    pub fn lot_card(&self, id: i64) -> Result<LotCard> {
        let lot = self.get_lot(id)?;
        let report = self.report_performance_scoped(ReportScope::Lot(id))?;
        let (work_orders, raw_types, generated_on) = {
            let conn = self.conn.lock().unwrap();
            let sql = format!(
                "SELECT work_order, COUNT(*), COALESCE(SUM(weld_inches), 0),
                        SUM(CASE WHEN {EXAMINED_SQL} THEN 1 ELSE 0 END),
                        SUM(CASE WHEN {REJECTED_SQL} THEN 1 ELSE 0 END),
                        MIN(date_welded), MAX(date_welded),
                        EXISTS(SELECT 1 FROM welds o WHERE o.work_order = w.work_order COLLATE NOCASE
                                 AND o.count_omission = 0 AND o.voided_at IS NULL AND o.nde_lot_id IS NOT ?1),
                        (SELECT GROUP_CONCAT(DISTINCT s.stamp_number) FROM welds s
                          WHERE s.work_order = w.work_order COLLATE NOCASE AND s.nde_lot_id = ?1
                            AND s.count_omission = 0 AND s.voided_at IS NULL
                            AND s.stamp_number IS NOT NULL AND s.stamp_number <> '')
                 FROM welds w
                 WHERE {LIVE_IN_LOT} AND work_order IS NOT NULL AND work_order <> ''
                 GROUP BY work_order COLLATE NOCASE ORDER BY work_order"
            );
            let mut stmt = conn.prepare(&sql)?;
            let wos: Vec<LotWorkOrder> = stmt
                .query_map([id], |r| {
                    Ok(LotWorkOrder {
                        work_order: r.get(0)?,
                        weld_count: r.get(1)?,
                        weld_inches: r.get(2)?,
                        examined: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                        rejects: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                        first_weld: r.get(5)?,
                        last_weld: r.get(6)?,
                        spans_other_lots: r.get::<_, i64>(7)? != 0,
                        welders: r.get::<_, Option<String>>(8)?.unwrap_or_default(),
                    })
                })?
                .collect::<rusqlite::Result<_>>()?;
            drop(stmt);
            let mut stmt = conn.prepare(&format!(
                "SELECT nde_types, rt_date, pt_mt_final FROM welds WHERE {LIVE_IN_LOT} AND {EXAMINED_SQL}"
            ))?;
            let raw: Vec<(Option<String>, Option<String>, Option<String>)> = stmt
                .query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect::<rusqlite::Result<_>>()?;
            drop(stmt);
            let today: String = conn.query_row("SELECT date('now')", [], |r| r.get(0))?;
            (wos, raw, today)
        };

        // Examinations by method, from the recorded NDE types (an RT date or a
        // PT/MT final counts even when the type list was left blank).
        let mut counts: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
        for (types, rt_date, pt_final) in &raw_types {
            let mut methods: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
            for t in types.as_deref().unwrap_or("").split(',') {
                let u = t.trim().to_uppercase();
                if u.is_empty() {
                    continue;
                }
                let m = if u.starts_with("RT") || u.contains(" RT") || u.contains("RADIO") {
                    "RT"
                } else if u.starts_with("PT") || u.contains("PENETRANT") {
                    "PT"
                } else if u.starts_with("MT") || u.contains("MAGNETIC") {
                    "MT"
                } else if u.starts_with("UT") || u.contains("ULTRA") {
                    "UT"
                } else if u.starts_with("VT") || u.contains("VISUAL") {
                    "VT"
                } else {
                    "Other"
                };
                methods.insert(m.to_string());
            }
            if nonblank(rt_date.as_deref()).is_some() {
                methods.insert("RT".to_string());
            }
            if methods.is_empty() && nonblank(pt_final.as_deref()).is_some() {
                methods.insert("PT".to_string());
            }
            for m in methods {
                *counts.entry(m).or_insert(0) += 1;
            }
        }
        let order = ["RT", "PT", "MT", "UT", "VT", "Other"];
        let nde_by_type: Vec<NdeTypeCount> = order
            .iter()
            .filter_map(|m| {
                counts.get(*m).map(|c| NdeTypeCount {
                    method: m.to_string(),
                    count: *c,
                })
            })
            .collect();

        let owed: i64 = report.by_spec.iter().map(|s| s.shortfall).sum();
        let unresolved = lot.unresolved;
        let spanning = work_orders.iter().filter(|w| w.spans_other_lots).count() as i64;
        Ok(LotCard {
            clean: owed == 0 && unresolved == 0,
            owed,
            unresolved,
            lot,
            report,
            work_orders,
            nde_by_type,
            spanning_work_orders: spanning,
            generated_on,
        })
    }

    // -----------------------------------------------------------------------
    // Work-order view + candidates
    // -----------------------------------------------------------------------

    /// Un-examined, resolvable welds per (work order, welder, spec) in a lot —
    /// the pool an owed examination can be drawn from.
    fn lot_candidates(&self, lot_id: i64) -> Result<Vec<(String, String, usize, i64)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT COALESCE(work_order, ''), stamp_number, nde_percent, COUNT(*)
             FROM welds
             WHERE {LIVE_IN_LOT} AND NOT {EXAMINED_SQL}
               AND stamp_number IS NOT NULL AND stamp_number <> ''
               AND COALESCE(expected_nde_resolved, 1) = 1
             GROUP BY UPPER(work_order), UPPER(stamp_number), nde_percent"
        ))?;
        let rows = stmt.query_map([lot_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (wo, stamp, pct, n) = row?;
            if let Some(idx) = canonical_spec_index(pct.as_deref()) {
                out.push((wo, stamp, idx, n));
            }
        }
        Ok(out)
    }

    /// A work order's lots, its pin, and the examinations it could satisfy:
    /// for every lot it touches that still takes results, each welder/spec
    /// debt in that lot that has un-examined candidate welds on this work order.
    pub fn wo_lot_summary(&self, work_order: &str) -> Result<WoLotSummary> {
        let cfg = self.lot_config()?;
        if !cfg.enabled {
            return Ok(WoLotSummary::default());
        }
        let wo = nonblank(Some(work_order)).unwrap_or("");
        let (lots, pinned) = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT l.id, l.lot_no, l.status, COUNT(*)
                 FROM welds w JOIN nde_lots l ON l.id = w.nde_lot_id
                 WHERE w.work_order = ?1 COLLATE NOCASE AND w.count_omission = 0 AND w.voided_at IS NULL
                 GROUP BY l.id ORDER BY l.opened_on DESC",
            )?;
            let lots: Vec<WoLotRef> = stmt
                .query_map([wo], |r| {
                    Ok(WoLotRef {
                        lot_id: r.get(0)?,
                        lot_no: r.get(1)?,
                        status: r.get(2)?,
                        weld_count: r.get(3)?,
                    })
                })?
                .collect::<rusqlite::Result<_>>()?;
            drop(stmt);
            let pinned: Option<i64> = conn
                .query_row(
                    "SELECT lot_id FROM nde_lot_pins WHERE work_order = ?1",
                    [wo],
                    |r| r.get(0),
                )
                .optional()?;
            (lots, pinned)
        };
        let mut owed: Vec<WoLotOwed> = Vec::new();
        for l in lots.iter().filter(|l| l.status != CLOSED) {
            let rep = self.report_performance_scoped(ReportScope::Lot(l.lot_id))?;
            let cands = self.lot_candidates(l.lot_id)?;
            for row in &rep.rows {
                for s in row.specs.iter().filter(|s| s.shortfall > 0) {
                    let idx = spec_index_of(&s.spec);
                    if let Some((_, _, _, n)) = cands.iter().find(|(cwo, stamp, cidx, _)| {
                        cwo.eq_ignore_ascii_case(wo)
                            && stamp.eq_ignore_ascii_case(&row.stamp)
                            && *cidx == idx
                    }) {
                        owed.push(WoLotOwed {
                            lot_id: l.lot_id,
                            lot_no: l.lot_no.clone(),
                            lot_status: l.status.clone(),
                            stamp: row.stamp.clone(),
                            name: row.name.clone(),
                            spec: s.spec.clone(),
                            owed: s.shortfall,
                            candidates_here: *n,
                        });
                    }
                }
            }
        }
        let total: i64 = owed.iter().map(|o| o.owed.min(o.candidates_here)).sum();
        Ok(WoLotSummary {
            enabled: true,
            lots,
            pinned_lot_id: pinned,
            owed,
            total_owed_here: total,
        })
    }

    /// Work orders for the pin / move dialog.
    pub fn lot_work_order_choices(&self) -> Result<Vec<LotWoChoice>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT w.work_order, COUNT(*), MAX(w.updated_at),
                    (SELECT GROUP_CONCAT(DISTINCT l.lot_no) FROM welds x JOIN nde_lots l ON l.id = x.nde_lot_id
                      WHERE x.work_order = w.work_order COLLATE NOCASE AND x.count_omission = 0 AND x.voided_at IS NULL),
                    (SELECT lot_id FROM nde_lot_pins p WHERE p.work_order = w.work_order)
             FROM welds w
             WHERE w.work_order IS NOT NULL AND w.work_order <> '' AND w.count_omission = 0 AND w.voided_at IS NULL
             GROUP BY w.work_order COLLATE NOCASE ORDER BY MAX(w.updated_at) DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(LotWoChoice {
                work_order: r.get(0)?,
                weld_count: r.get(1)?,
                last_activity: r.get(2)?,
                lots: r
                    .get::<_, Option<String>>(3)?
                    .map(|s| {
                        s.split(',')
                            .map(|x| x.trim().to_string())
                            .filter(|x| !x.is_empty())
                            .collect()
                    })
                    .unwrap_or_default(),
                pinned_lot_id: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    // -----------------------------------------------------------------------
    // Suggestions
    // -----------------------------------------------------------------------

    /// Randomly pick un-examined welds to meet what each welder owes in a lot
    /// (optionally one welder). A helper, not a cage: the list is advisory and
    /// re-rolls on every call. API 570 welds are listed exhaustively, since
    /// every one of them needs its two NDE forms.
    pub fn suggest_examinations(
        &self,
        lot_id: i64,
        stamp: Option<&str>,
    ) -> Result<Vec<SuggestedExam>> {
        let rep = self.report_performance_scoped(ReportScope::Lot(lot_id))?;
        let mut out = Vec::new();
        let conn = self.conn.lock().unwrap();
        for row in rep.rows.iter().filter(|r| {
            stamp
                .map(|s| s.eq_ignore_ascii_case(&r.stamp))
                .unwrap_or(true)
        }) {
            for s in row.specs.iter().filter(|s| s.shortfall > 0) {
                let idx = spec_index_of(&s.spec);
                let limit = if idx == 4 { i64::MAX } else { s.shortfall };
                let sql = format!(
                    "SELECT id, weld_number, work_order, drawing_no, joint_type, size, date_welded, required_nde_method
                     FROM welds
                     WHERE {LIVE_IN_LOT} AND stamp_number = ?2 COLLATE NOCASE
                       AND NOT {EXAMINED_SQL}
                       AND COALESCE(expected_nde_resolved, 1) = 1
                       AND {}
                     ORDER BY RANDOM() LIMIT ?3",
                    spec_predicate_sql(idx)
                );
                let mut stmt = conn.prepare(&sql)?;
                let reason = if s.progressive_extra > 0 {
                    format!(
                        "{} spec — {} owed ({} of that is progressive sampling: {})",
                        s.spec, s.shortfall, s.progressive_extra, s.sampling_level
                    )
                } else if idx == 4 {
                    format!(
                        "API 570 — every weld needs its two NDE forms ({} short)",
                        s.shortfall
                    )
                } else {
                    format!(
                        "{} spec — {} owed to reach {} of {}",
                        s.spec, s.shortfall, s.required, s.population
                    )
                };
                let rows = stmt.query_map(params![lot_id, row.stamp, limit], |r| {
                    Ok(SuggestedExam {
                        weld_id: r.get(0)?,
                        weld_number: r.get(1)?,
                        work_order: r.get(2)?,
                        drawing_no: r.get(3)?,
                        stamp: row.stamp.clone(),
                        name: row.name.clone(),
                        spec: s.spec.clone(),
                        joint_type: r.get(4)?,
                        size: r.get(5)?,
                        date_welded: r.get(6)?,
                        required_nde_method: r.get(7)?,
                        reason: reason.clone(),
                    })
                })?;
                for r in rows {
                    out.push(r?);
                }
            }
        }
        Ok(out)
    }

    // -----------------------------------------------------------------------
    // Attention + autonomous maintenance
    // -----------------------------------------------------------------------

    /// Everything the user must not be allowed to forget, most urgent first:
    /// lot turnover / closeout / owed NDE (when lots are on) and welds left
    /// without attributes on any work order (always).
    pub fn lot_attention(&self) -> Result<Vec<AttentionItem>> {
        let cfg = self.lot_config()?;
        let mut items: Vec<AttentionItem> = Vec::new();
        if cfg.enabled {
            items.extend(self.lot_items(&cfg)?);
        }
        for wo in self.incomplete_work_orders()? {
            let fields = wo
                .missing
                .iter()
                .map(|(k, v)| format!("{k} {v}"))
                .collect::<Vec<_>>()
                .join(" · ");
            items.push(AttentionItem {
                kind: "wo_incomplete".into(),
                severity: if wo.count >= 10 {
                    "error".into()
                } else {
                    "warning".into()
                },
                title: format!(
                    "WO {}: {} weld{} missing attributes",
                    wo.work_order,
                    wo.count,
                    if wo.count == 1 { "" } else { "s" }
                ),
                detail: format!("Missing {fields} · Fill attributes starts at the first one"),
                lot_id: None,
                lot_no: None,
                work_order: Some(wo.work_order.clone()),
                count: wo.count,
            });
        }
        let rank = |s: &str| match s {
            "error" => 0,
            "warning" => 1,
            _ => 2,
        };
        items.sort_by(|a, b| {
            rank(&a.severity)
                .cmp(&rank(&b.severity))
                .then(b.count.cmp(&a.count))
        });
        Ok(items)
    }

    fn lot_items(&self, cfg: &LotConfig) -> Result<Vec<AttentionItem>> {
        let lots = self.list_lots()?;
        let mut items: Vec<AttentionItem> = Vec::new();
        let snoozed = cfg
            .snooze_until
            .as_deref()
            .and_then(parse_date)
            .map(|d| today() < d)
            .unwrap_or(false);
        for lot in &lots {
            let lref =
                |kind: &str, sev: &str, title: String, detail: String, count: i64| AttentionItem {
                    kind: kind.into(),
                    severity: sev.into(),
                    title,
                    detail,
                    lot_id: Some(lot.id),
                    lot_no: Some(lot.lot_no.clone()),
                    work_order: None,
                    count,
                };
            match lot.status.as_str() {
                OPEN if lot.is_default => {
                    if lot.overdue_days > 0 && !cfg.auto_rollover && !snoozed {
                        items.push(lref(
                            "turnover_due",
                            "warning",
                            format!("{} has run {} days — time to turn it over", lot.lot_no, lot.age_days),
                            format!(
                                "The expected lot length is {} month{}. Turning over freezes this population so each welder's NDE percentage stays meaningful.",
                                cfg.target_months,
                                if cfg.target_months == 1 { "" } else { "s" }
                            ),
                            lot.overdue_days,
                        ));
                    }
                    if lot.unresolved > 0 {
                        items.push(lref(
                            "unresolved",
                            "error",
                            format!("{} weld{} in {} can't be scored", lot.unresolved, if lot.unresolved == 1 { "" } else { "s" }, lot.lot_no),
                            "Their Table 4 drivers are missing, so the required NDE % is unknown. Fix them before the lot closes.".into(),
                            lot.unresolved,
                        ));
                    }
                    if lot.owed > 0 {
                        items.push(lref(
                            "current_owed",
                            "info",
                            format!(
                                "{} examination{} owed so far in {}",
                                lot.owed,
                                if lot.owed == 1 { "" } else { "s" },
                                lot.lot_no
                            ),
                            "Running tally for the receiving lot".into(),
                            lot.owed,
                        ));
                    }
                }
                CLOSING => {
                    if lot.owed > 0 || lot.unresolved > 0 {
                        items.push(lref(
                            "closeout",
                            if lot.unresolved > 0 {
                                "error"
                            } else {
                                "warning"
                            },
                            format!(
                                "{} is awaiting closeout — {} owed{}",
                                lot.lot_no,
                                lot.owed,
                                if lot.unresolved > 0 {
                                    format!(", {} unresolved", lot.unresolved)
                                } else {
                                    String::new()
                                }
                            ),
                            format!(
                                "Stopped taking welds {} · record the NDE and it closes itself",
                                lot.closing_on.as_deref().unwrap_or("")
                            ),
                            lot.owed + lot.unresolved,
                        ));
                    } else {
                        items.push(lref(
                            "closeout_ready",
                            "info",
                            format!(
                                "{} is complete — it will close on the next check",
                                lot.lot_no
                            ),
                            "Every welder met their coverage and nothing is unresolved.".into(),
                            0,
                        ));
                    }
                }
                _ => {}
            }
        }
        // Per work order: where can the owed examinations actually be shot?
        let mut per_wo: std::collections::BTreeMap<String, (i64, Vec<String>)> =
            std::collections::BTreeMap::new();
        for lot in lots.iter().filter(|l| l.status != CLOSED && l.owed > 0) {
            let rep = self.report_performance_scoped(ReportScope::Lot(lot.id))?;
            let cands = self.lot_candidates(lot.id)?;
            for row in &rep.rows {
                for s in row.specs.iter().filter(|s| s.shortfall > 0) {
                    let idx = spec_index_of(&s.spec);
                    let mut left = s.shortfall;
                    for (wo, stamp, cidx, n) in &cands {
                        if left == 0 {
                            break;
                        }
                        if *cidx == idx && stamp.eq_ignore_ascii_case(&row.stamp) && !wo.is_empty()
                        {
                            let here = left.min(*n);
                            left -= here;
                            let e = per_wo.entry(wo.clone()).or_insert((0, Vec::new()));
                            e.0 += here;
                            let who = if row.name.is_empty() {
                                row.stamp.clone()
                            } else {
                                row.name.clone()
                            };
                            if !e.1.contains(&who) {
                                e.1.push(who);
                            }
                        }
                    }
                }
            }
        }
        for (wo, (n, who)) in per_wo {
            items.push(AttentionItem {
                kind: "wo_nde".into(),
                severity: "warning".into(),
                title: format!(
                    "WO {wo}: {n} examination{} can be shot here",
                    if n == 1 { "" } else { "s" }
                ),
                detail: format!("Owed by {}", who.join(", ")),
                lot_id: None,
                lot_no: None,
                work_order: Some(wo),
                count: n,
            });
        }
        let rank = |s: &str| match s {
            "error" => 0,
            "warning" => 1,
            _ => 2,
        };
        items.sort_by(|a, b| {
            rank(&a.severity)
                .cmp(&rank(&b.severity))
                .then(b.count.cmp(&a.count))
        });
        Ok(items)
    }

    /// The autonomous pass, run at every login: make sure a receiving lot
    /// exists, roll it over when configured to and due, close any Closing lot
    /// whose coverage is complete, and report whether to prompt for turnover.
    pub fn lots_auto_maintain(&self) -> Result<MaintainOutcome> {
        let cfg = self.lot_config()?;
        let mut out = MaintainOutcome {
            enabled: cfg.enabled,
            ..Default::default()
        };
        if !cfg.enabled {
            return Ok(out);
        }
        let had_default = self.default_lot()?.is_some();
        let default = self.ensure_default_lot(SYSTEM)?;
        if let (false, Some(d)) = (had_default, &default) {
            out.created_default = Some(d.lot_no.clone());
        }
        if let Some(d) = &default {
            if d.overdue_days > 0 {
                if cfg.auto_rollover {
                    let (old, new) = self.turn_over(
                        SYSTEM,
                        Some("automatic rollover at the configured lot length"),
                    )?;
                    out.turned_over = Some([old.map(|o| o.lot_no).unwrap_or_default(), new.lot_no]);
                } else {
                    let snoozed = cfg
                        .snooze_until
                        .as_deref()
                        .and_then(parse_date)
                        .map(|s| today() < s)
                        .unwrap_or(false);
                    if !snoozed {
                        out.turnover_due = Some(d.clone());
                    }
                }
            }
        }
        for lot in self.list_lots()? {
            if lot.status == CLOSING && lot.owed == 0 && lot.unresolved == 0 {
                let closed = self.close_lot(lot.id, SYSTEM, Some("coverage complete"), false)?;
                out.auto_closed.push(closed.lot_no);
            }
        }
        Ok(out)
    }
}

/// Convenience for callers that need the welder rows of a lot card.
pub fn lot_welders(card: &LotCard) -> &[PerformanceRow] {
    &card.report.rows
}

/// Sum of examinations still owed across a set of spec stats.
pub fn owed_total(specs: &[NdeSpecStat]) -> i64 {
    specs.iter().map(|s| s.shortfall).sum()
}
