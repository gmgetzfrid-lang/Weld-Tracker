//! Reporting / analytics. These queries replace every pivot table and
//! `GETPIVOTDATA` formula in the original workbook.
//!
//! Counting rules (matching the workbook pivots):
//!   * count-omitted welds (`count_omission = 1`) are excluded everywhere;
//!   * an "RT" is a weld with a non-empty `rt_date` ("Count of RT DATE");
//!   * "accepted"/"rejected" count `rt_accepted='Y'` / `rt_rejected='Y'`;
//!   * "PT/MT" counts a non-empty `pt_mt_final`;
//!   * "Brinnel" counts a non-empty `brinnel_complete`;
//!   * RT %   = RT'd / welds   and   Reject rate = rejected / RT'd.

use crate::{Result, Store};
use rusqlite::{types::Value, Row};
use serde::Serialize;

/// The seven aggregate measures collected for a slice of the weld log.
const AGG: &str = "
    COUNT(*) AS welds,
    SUM(CASE WHEN rt_date IS NOT NULL AND rt_date <> '' THEN 1 ELSE 0 END) AS rt,
    SUM(CASE WHEN rt_accepted = 'Y' THEN 1 ELSE 0 END) AS accepted,
    SUM(CASE WHEN rt_rejected = 'Y' THEN 1 ELSE 0 END) AS rejected,
    SUM(CASE WHEN pt_mt_final IS NOT NULL AND pt_mt_final <> '' THEN 1 ELSE 0 END) AS pt_mt,
    SUM(CASE WHEN brinnel_complete IS NOT NULL AND brinnel_complete <> '' THEN 1 ELSE 0 END) AS brinnel,
    COALESCE(SUM(weld_inches), 0) AS inches";

#[derive(Debug, Clone, Default, Serialize)]
pub struct JointStat {
    pub joint_type: String,
    pub welds: i64,
    pub rt: i64,
    pub accepted: i64,
    pub rejected: i64,
    pub pt_mt: i64,
    pub brinnel: i64,
    pub inches: f64,
    pub rt_pct: f64,      // rt / welds
    pub reject_rate: f64, // rejected / rt
}

impl JointStat {
    fn finish(mut self) -> Self {
        self.rt_pct = ratio(self.rt, self.welds);
        self.reject_rate = ratio(self.rejected, self.rt);
        self
    }
    fn add(&mut self, o: &JointStat) {
        self.welds += o.welds;
        self.rt += o.rt;
        self.accepted += o.accepted;
        self.rejected += o.rejected;
        self.pt_mt += o.pt_mt;
        self.brinnel += o.brinnel;
        self.inches += o.inches;
    }
}

fn ratio(a: i64, b: i64) -> f64 {
    if b == 0 {
        0.0
    } else {
        a as f64 / b as f64
    }
}

/// Read the seven aggregate columns starting at `agg_start`. When `joint_col`
/// is set, the joint-type label is read from that column index.
fn read_aggs(r: &Row, joint_col: Option<usize>, agg_start: usize) -> rusqlite::Result<JointStat> {
    Ok(JointStat {
        joint_type: match joint_col {
            Some(i) => r.get::<_, Option<String>>(i)?.unwrap_or_default(),
            None => String::new(),
        },
        welds: r.get(agg_start)?,
        rt: r.get(agg_start + 1)?,
        accepted: r.get(agg_start + 2)?,
        rejected: r.get(agg_start + 3)?,
        pt_mt: r.get(agg_start + 4)?,
        brinnel: r.get(agg_start + 5)?,
        inches: r.get(agg_start + 6)?,
        rt_pct: 0.0,
        reject_rate: 0.0,
    })
}

#[derive(Debug, Serialize)]
pub struct SummaryReport {
    pub by_joint: Vec<JointStat>,
    pub total: JointStat,
    pub welder_count: i64,
    pub active_welder_count: i64,
}

#[derive(Debug, Serialize)]
pub struct WelderStatRow {
    pub stamp: String,
    pub name: String,
    pub active: bool,
    pub by_joint: Vec<JointStat>,
    pub total: JointStat,
}

#[derive(Debug, Serialize)]
pub struct WelderStatsReport {
    pub level: String,
    pub rows: Vec<WelderStatRow>,
    pub total: JointStat,
}

#[derive(Debug, Serialize)]
pub struct MonthlyJoint {
    pub joint_type: String,
    pub welds: Vec<i64>,    // 12 months
    pub accepted: Vec<i64>,
    pub rejected: Vec<i64>,
    pub inches: Vec<f64>,
}

#[derive(Debug, Serialize)]
pub struct MonthlyReport {
    pub year: i32,
    pub joints: Vec<MonthlyJoint>,
    pub total_welds: Vec<i64>,
    pub total_rt: Vec<i64>,
    pub total_rejected: Vec<i64>,
    pub total_inches: Vec<f64>,
}

#[derive(Debug, Serialize)]
pub struct DailyRow {
    pub date: String,
    pub welds: i64,
    pub rt: i64,
    pub rejected: i64,
    pub inches: f64,
}

#[derive(Debug, Serialize)]
pub struct DailyReport {
    pub date: String,
    pub by_joint: Vec<JointStat>,
    pub total: JointStat,
    pub recent: Vec<DailyRow>, // last 14 active days
}

#[derive(Debug, Serialize)]
pub struct JobReport {
    pub work_order: String,
    pub butt: JointStat,
    pub other: JointStat, // SW + Fillet + O-Let + Other combined
    pub total_welds: i64,
    /// Examined = butt welds RT'd + other welds PT/MT'd (matches the workbook
    /// Job Report, which tracks socket/fillet/olet completion by PT/MT Final).
    pub total_examined: i64,
    pub total_examined_pct: f64,
}

/// One NDE coverage spec's compliance picture for a single welder (or, in the
/// fleet roll-up, for everyone). `examined` is the number of that welder's welds
/// carrying this spec that have actually had the required NDE performed;
/// `required` is the minimum they must reach to stay at or above the spec.
#[derive(Debug, Clone, Serialize)]
pub struct NdeSpecStat {
    pub spec: String,      // "5%", "10%", "20%", "100%", "API 570"
    pub required_pct: f64, // coverage the spec demands (100 for API 570)
    pub population: i64,    // welds carrying this spec (count-omitted excluded)
    pub examined: i64,      // of those, how many satisfy the NDE requirement
    pub required: i64,      // minimum examinations to stay compliant (ceil)
    pub shortfall: i64,     // examinations still owed (0 when compliant)
    pub rejected: i64,      // examined welds that were rejected
    pub actual_pct: f64,    // examined / population * 100
    pub compliant: bool,    // examined >= required
}

impl NdeSpecStat {
    fn empty(spec: &str, required_pct: f64) -> Self {
        NdeSpecStat {
            spec: spec.to_string(),
            required_pct,
            population: 0,
            examined: 0,
            required: 0,
            shortfall: 0,
            rejected: 0,
            actual_pct: 0.0,
            compliant: true,
        }
    }
    /// Finalise a per-welder spec: required = ceil(population * pct / 100), or
    /// the whole population for API 570 (every weld needs its two NDE forms).
    fn finish_welder(mut self, is_api570: bool) -> Self {
        self.required = if is_api570 {
            self.population
        } else {
            // integer ceil of population * pct / 100
            let pct = self.required_pct.round() as i64;
            (self.population * pct + 99) / 100
        };
        self.shortfall = (self.required - self.examined).max(0);
        self.compliant = self.examined >= self.required;
        self.actual_pct = if self.population == 0 {
            0.0
        } else {
            self.examined as f64 / self.population as f64 * 100.0
        };
        self
    }
}

/// Per-welder NDE compliance across every spec they have welded to.
#[derive(Debug, Clone, Serialize)]
pub struct WelderNdeCompliance {
    pub stamp: String,
    pub name: String,
    pub active: bool,
    pub specs: Vec<NdeSpecStat>,
    pub total_welds: i64,
    pub total_examined: i64,   // welds meeting their spec's requirement
    pub total_inspected: i64,  // welds with a recorded NDE result (reject-rate base)
    pub total_rejected: i64,
    pub reject_rate: f64, // rejected / inspected
    pub compliant: bool,  // every spec at or above requirement
    pub worst_gap: i64,   // largest single-spec shortfall (0 when all clear)
}

#[derive(Debug, Serialize)]
pub struct NdeComplianceReport {
    pub welders: Vec<WelderNdeCompliance>,
    /// Fleet-wide roll-up per spec (summed per-welder requirements), for the
    /// dashboard quick reference.
    pub by_spec: Vec<NdeSpecStat>,
    pub welder_count: i64,
    pub noncompliant_count: i64,
    /// Welds whose logged NDE % contradicts their shop/field/tie-in rule.
    pub spec_mismatch_count: i64,
}

/// One welder's line in the performance report: throughput plus whether they
/// stayed at or above every NDE spec they welded to, over the report window.
#[derive(Debug, Clone, Serialize)]
pub struct PerformanceRow {
    pub stamp: String,
    pub name: String,
    pub active: bool,
    pub weld_count: i64,      // countable welds in the window
    pub weld_inches: f64,     // sum of diameter inches
    pub inspected: i64,       // welds with a recorded NDE result (RT/PT)
    pub rt_pct: f64,          // inspected / weld_count (0..1)
    pub rejects: i64,
    pub reject_rate: f64,     // rejects / inspected (0..1)
    pub specs: Vec<NdeSpecStat>,   // per assigned spec: required vs actual coverage
    pub assigned_specs: String,    // e.g. "5%, 100%"
    pub min_actual_pct: f64,       // lowest actual coverage across specs (0..100)
    pub in_spec: bool,             // at or above requirement on every spec
    pub worst_gap: i64,            // largest single-spec shortfall (0 when clear)
    pub last_rt: Option<String>,   // most recent examination date
    pub processes: Option<String>, // qualified process(es) from certs
}

/// Per-work-order throughput roll-up for the report window.
#[derive(Debug, Clone, Serialize)]
pub struct PerfWorkOrder {
    pub work_order: String,
    pub weld_count: i64,
    pub weld_inches: f64,
    pub inspected: i64,
    pub rt_pct: f64,
    pub rejects: i64,
    pub reject_rate: f64,
}

/// The full performance & NDE-compliance report — the data behind the
/// distribution PDF.
#[derive(Debug, Serialize)]
pub struct PerformanceReport {
    pub period_label: String,
    pub from: Option<String>,
    pub to: Option<String>,
    pub generated_on: String,
    pub total_welds: i64,
    pub total_inches: f64,
    pub total_inspected: i64,
    pub fleet_rt_pct: f64,
    pub total_rejects: i64,
    pub fleet_reject_rate: f64,
    pub welders_in_spec: i64,
    pub welders_below_spec: i64,
    pub by_spec: Vec<NdeSpecStat>,
    pub rows: Vec<PerformanceRow>,
    pub work_orders: Vec<PerfWorkOrder>,
}

#[derive(Debug, Serialize)]
pub struct ClientReportRow {
    pub stamp: String,
    pub name: String,
    /// The welder's qualified process(es), derived from their certs.
    pub process: Option<String>,
    pub weld_count: i64,
    pub inches: f64,
    pub rt_count: i64,
    pub rt_pct: f64,
    pub rejects: i64,
    pub reject_rate: f64, // rejects / weld_count (Chevron/TSA convention)
    pub last_rt_date: Option<String>,
}

impl Store {
    /// Aggregate the weld log grouped by joint type, with an optional extra
    /// `AND ...` predicate.
    fn agg_by_joint(&self, extra_where: &str, args: &[Value]) -> Result<Vec<JointStat>> {
        let sql = format!(
            "SELECT joint_type, {AGG} FROM welds
             WHERE count_omission = 0 {extra_where}
             GROUP BY joint_type ORDER BY joint_type"
        );
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;
        let rows =
            stmt.query_map(rusqlite::params_from_iter(args), |r| read_aggs(r, Some(0), 1))?;
        Ok(rows
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .map(JointStat::finish)
            .collect())
    }

    fn total_of(list: &[JointStat]) -> JointStat {
        let mut t = JointStat::default();
        for s in list {
            t.add(s);
        }
        t.finish()
    }

    // ---- Summary / dashboard (Summary + Weld Count PVT) --------------------
    pub fn report_summary(&self) -> Result<SummaryReport> {
        let by_joint = self.agg_by_joint("", &[])?;
        let total = Self::total_of(&by_joint);
        let (welder_count, active_welder_count) = {
            let conn = self.conn.lock().unwrap();
            let all: i64 = conn.query_row("SELECT COUNT(*) FROM welders", [], |r| r.get(0))?;
            let act: i64 =
                conn.query_row("SELECT COUNT(*) FROM welders WHERE active = 1", [], |r| r.get(0))?;
            (all, act)
        };
        Ok(SummaryReport {
            by_joint,
            total,
            welder_count,
            active_welder_count,
        })
    }

    // ---- Job report (Job Report) -------------------------------------------
    pub fn report_job(&self, work_order: &str) -> Result<JobReport> {
        let by_joint =
            self.agg_by_joint("AND work_order = ?1 COLLATE NOCASE", &[Value::from(work_order.to_string())])?;
        let mut butt = JointStat::default();
        let mut other = JointStat::default();
        for s in &by_joint {
            if s.joint_type.eq_ignore_ascii_case("BW") {
                butt.add(s);
            } else {
                other.add(s);
            }
        }
        butt = butt.finish();
        other = other.finish();
        let total_welds = butt.welds + other.welds;
        // Butt welds are examined by RT; socket/fillet/olet by PT/MT Final.
        let total_examined = butt.rt + other.pt_mt;
        Ok(JobReport {
            work_order: work_order.to_string(),
            total_welds,
            total_examined,
            total_examined_pct: ratio(total_examined, total_welds),
            butt,
            other,
        })
    }

    // ---- Daily weld count (Daily Weld Count) -------------------------------
    pub fn report_daily(&self, date: &str) -> Result<DailyReport> {
        // Weld counts are by date welded; RT accepted/rejected are by RT date,
        // matching the workbook's Daily Weld Count sheet.
        let by_joint = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT joint_type,
                        SUM(CASE WHEN date_welded = ?1 THEN 1 ELSE 0 END) AS welds,
                        SUM(CASE WHEN rt_date = ?1 THEN 1 ELSE 0 END) AS rt,
                        SUM(CASE WHEN rt_date = ?1 AND rt_accepted = 'Y' THEN 1 ELSE 0 END) AS accepted,
                        SUM(CASE WHEN rt_date = ?1 AND rt_rejected = 'Y' THEN 1 ELSE 0 END) AS rejected,
                        SUM(CASE WHEN date_welded = ?1 AND pt_mt_final IS NOT NULL AND pt_mt_final <> '' THEN 1 ELSE 0 END) AS pt_mt,
                        SUM(CASE WHEN date_welded = ?1 AND brinnel_complete IS NOT NULL AND brinnel_complete <> '' THEN 1 ELSE 0 END) AS brinnel,
                        COALESCE(SUM(CASE WHEN date_welded = ?1 THEN weld_inches ELSE 0 END), 0) AS inches
                 FROM welds
                 WHERE count_omission = 0 AND (date_welded = ?1 OR rt_date = ?1)
                 GROUP BY joint_type
                 HAVING welds > 0 OR rt > 0
                 ORDER BY joint_type",
            )?;
            let rows = stmt.query_map([date], |r| read_aggs(r, Some(0), 1))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
                .into_iter()
                .map(JointStat::finish)
                .collect::<Vec<_>>()
        };
        let total = Self::total_of(&by_joint);
        let recent = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT d,
                        (SELECT COUNT(*) FROM welds w WHERE w.count_omission = 0 AND w.date_welded = d),
                        (SELECT COUNT(*) FROM welds w WHERE w.count_omission = 0 AND w.rt_date = d),
                        (SELECT COUNT(*) FROM welds w WHERE w.count_omission = 0 AND w.rt_date = d AND w.rt_rejected = 'Y'),
                        (SELECT COALESCE(SUM(weld_inches), 0) FROM welds w WHERE w.count_omission = 0 AND w.date_welded = d)
                 FROM (
                    SELECT date_welded AS d FROM welds WHERE date_welded IS NOT NULL AND date_welded <> ''
                    UNION SELECT rt_date FROM welds WHERE rt_date IS NOT NULL AND rt_date <> ''
                 )
                 ORDER BY d DESC LIMIT 14",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(DailyRow {
                    date: r.get(0)?,
                    welds: r.get(1)?,
                    rt: r.get(2)?,
                    rejected: r.get(3)?,
                    inches: r.get(4)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        Ok(DailyReport {
            date: date.to_string(),
            by_joint,
            total,
            recent,
        })
    }

    // ---- Monthly report (Monthly Report) -----------------------------------
    pub fn report_monthly(&self, year: i32) -> Result<MonthlyReport> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT joint_type,
                    CAST(strftime('%m', date_welded) AS INTEGER) AS m,
                    COUNT(*),
                    SUM(CASE WHEN rt_accepted = 'Y' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN rt_rejected = 'Y' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN rt_date IS NOT NULL AND rt_date <> '' THEN 1 ELSE 0 END),
                    COALESCE(SUM(weld_inches), 0)
             FROM welds
             WHERE count_omission = 0 AND strftime('%Y', date_welded) = ?1
             GROUP BY joint_type, m",
        )?;
        let year_s = year.to_string();
        let mut joints: std::collections::BTreeMap<String, MonthlyJoint> =
            std::collections::BTreeMap::new();
        let mut total_welds = vec![0i64; 12];
        let mut total_rt = vec![0i64; 12];
        let mut total_rejected = vec![0i64; 12];
        let mut total_inches = vec![0f64; 12];
        let mut rows = stmt.query([&year_s])?;
        while let Some(r) = rows.next()? {
            let jt: Option<String> = r.get(0)?;
            let jt = jt.unwrap_or_default();
            let m: Option<i64> = r.get(1)?;
            let Some(m) = m else { continue };
            let idx = (m - 1).clamp(0, 11) as usize;
            let welds: i64 = r.get(2)?;
            let accepted: i64 = r.get(3)?;
            let rejected: i64 = r.get(4)?;
            let rt: i64 = r.get(5)?;
            let inches: f64 = r.get(6)?;
            let entry = joints.entry(jt.clone()).or_insert_with(|| MonthlyJoint {
                joint_type: jt.clone(),
                welds: vec![0; 12],
                accepted: vec![0; 12],
                rejected: vec![0; 12],
                inches: vec![0.0; 12],
            });
            entry.welds[idx] += welds;
            entry.accepted[idx] += accepted;
            entry.rejected[idx] += rejected;
            entry.inches[idx] += inches;
            total_welds[idx] += welds;
            total_rt[idx] += rt;
            total_rejected[idx] += rejected;
            // The workbook's monthly "weld inches" row tracks butt-weld inches.
            if jt.eq_ignore_ascii_case("BW") {
                total_inches[idx] += inches;
            }
        }
        Ok(MonthlyReport {
            year,
            joints: joints.into_values().collect(),
            total_welds,
            total_rt,
            total_rejected,
            total_inches,
        })
    }

    // ---- Per-welder stats (WELDER % / WELDER REPORT) -----------------------
    /// `level` is one of "all","5","10","20","25","50","100".
    pub fn report_welder_stats(&self, level: &str) -> Result<WelderStatsReport> {
        let level_clause = match level {
            "5" => "AND spec_5 = 1",
            "10" => "AND spec_10 = 1",
            "20" => "AND spec_20 = 1",
            "25" => "AND spec_25 = 1",
            "50" => "AND spec_50 = 1",
            "100" => "AND spec_100 = 1",
            _ => "",
        };
        let sql = format!(
            "SELECT stamp_number, joint_type, {AGG} FROM welds
             WHERE count_omission = 0 AND stamp_number IS NOT NULL AND stamp_number <> '' {level_clause}
             GROUP BY stamp_number, joint_type"
        );
        // welder name lookup
        let welders = self.list_welders(true, "name")?;
        let name_of = |stamp: &str| -> (String, bool) {
            welders
                .iter()
                .find(|w| w.stamp.eq_ignore_ascii_case(stamp))
                .map(|w| (w.name.clone(), w.active))
                .unwrap_or_else(|| (String::new(), false))
        };

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query([])?;
        let mut by_stamp: std::collections::BTreeMap<String, Vec<JointStat>> =
            std::collections::BTreeMap::new();
        while let Some(r) = rows.next()? {
            let stamp: String = r.get::<_, Option<String>>(0)?.unwrap_or_default();
            let mut js = read_aggs(r, Some(1), 2)?.finish();
            if js.joint_type.is_empty() {
                js.joint_type = "(none)".into();
            }
            by_stamp.entry(stamp).or_default().push(js);
        }
        drop(rows);
        drop(stmt);
        drop(conn);

        let mut result_rows = Vec::new();
        let mut grand = JointStat::default();
        for (stamp, list) in by_stamp {
            let total = Self::total_of(&list);
            grand.add(&total);
            let (name, active) = name_of(&stamp);
            result_rows.push(WelderStatRow {
                stamp,
                name,
                active,
                by_joint: list,
                total,
            });
        }
        result_rows.sort_by_key(|a| a.name.to_lowercase());
        Ok(WelderStatsReport {
            level: level.to_string(),
            rows: result_rows,
            total: grand.finish(),
        })
    }

    /// Single-welder detail across joint types (WELDER REPORT).
    pub fn report_welder(&self, stamp: &str) -> Result<WelderStatRow> {
        let by_joint = self.agg_by_joint(
            "AND stamp_number = ?1 COLLATE NOCASE",
            &[Value::from(stamp.to_string())],
        )?;
        let total = Self::total_of(&by_joint);
        let (name, active) = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT name, active FROM welders WHERE stamp = ?1 COLLATE NOCASE",
                [stamp],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)),
            )
            .unwrap_or((String::new(), false))
        };
        Ok(WelderStatRow {
            stamp: stamp.to_string(),
            name,
            active,
            by_joint,
            total,
        })
    }

    // ---- Client / TSA monthly summary (Chevron Report) ---------------------
    /// `month` 1..12 and `year`. Matches the Chevron/TSA sheet: weld count,
    /// RTs and rejects are for BUTT WELDS only, while weld inches sum all joint
    /// types. Reject rate = rejects / butt-weld count. Stamps are matched
    /// case-insensitively.
    pub fn report_client(&self, month: u32, year: i32) -> Result<Vec<ClientReportRow>> {
        let ym = format!("{year:04}-{month:02}");
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT stamp_number,
                    SUM(CASE WHEN joint_type = 'BW' COLLATE NOCASE THEN 1 ELSE 0 END) AS weld_count,
                    COALESCE(SUM(weld_inches),0) AS inches,
                    SUM(CASE WHEN joint_type = 'BW' COLLATE NOCASE AND rt_date IS NOT NULL AND rt_date <> '' THEN 1 ELSE 0 END) AS rt_count,
                    SUM(CASE WHEN joint_type = 'BW' COLLATE NOCASE AND rt_rejected = 'Y' THEN 1 ELSE 0 END) AS rejects,
                    MAX(rt_date) AS last_rt
             FROM welds
             WHERE count_omission = 0 AND stamp_number IS NOT NULL AND stamp_number <> ''
               AND strftime('%Y-%m', date_welded) = ?1
             GROUP BY stamp_number COLLATE NOCASE",
        )?;
        let mut map: std::collections::HashMap<String, ClientReportRow> =
            std::collections::HashMap::new();
        let mut rows = stmt.query([&ym])?;
        while let Some(r) = rows.next()? {
            let stamp: String = r.get::<_, Option<String>>(0)?.unwrap_or_default();
            let weld_count: i64 = r.get(1)?;
            let inches: f64 = r.get(2)?;
            let rt_count: i64 = r.get(3)?;
            let rejects: i64 = r.get(4)?;
            let last_rt: Option<String> = r.get(5)?;
            map.insert(
                stamp.to_lowercase(),
                ClientReportRow {
                    stamp,
                    name: String::new(),
                    process: None,
                    weld_count,
                    inches,
                    rt_count,
                    rt_pct: ratio(rt_count, weld_count),
                    rejects,
                    reject_rate: ratio(rejects, weld_count),
                    last_rt_date: last_rt,
                },
            );
        }
        drop(rows);
        drop(stmt);
        drop(conn);

        for w in self.list_welders(true, "name")? {
            if let Some(row) = map.get_mut(&w.stamp.to_lowercase()) {
                row.name = w.name.clone();
                row.process = self.welder_cert_processes(w.id)?;
            }
        }
        let mut out: Vec<ClientReportRow> = map.into_values().collect();
        out.sort_by_key(|a| a.name.to_lowercase());
        Ok(out)
    }

    // ---- QM summary (QM PVT) -----------------------------------------------
    /// Per-welder QC roll-up by joint type (stamp count, accepted, PT/MT, rejected).
    pub fn report_qm(&self) -> Result<Vec<WelderStatRow>> {
        // reuse welder stats "all" but keep the by_joint breakdown
        let stats = self.report_welder_stats("all")?;
        Ok(stats.rows)
    }

    // ---- Per-welder NDE compliance -----------------------------------------
    /// For every welder, how their actual NDE coverage measures against the spec
    /// on each of their welds. Percentage specs (5/10/20/100%) require at least
    /// that share of the welder's welds carrying the spec to be examined;
    /// "API 570" (in lieu of hydro) requires *every* such weld to carry its two
    /// forms of NDE — PT root & final plus RT for butt welds, PT root & final for
    /// fillet / branch / slip-on flange / socket welds. This is the meticulous
    /// per-welder tracking that keeps everyone at or above spec.
    pub fn report_nde_compliance(&self) -> Result<NdeComplianceReport> {
        // Canonical spec order for stable output.
        const SPECS: &[(&str, f64)] = &[
            ("5%", 5.0),
            ("10%", 10.0),
            ("20%", 20.0),
            ("100%", 100.0),
            ("API 570", 100.0),
        ];

        // Pull every countable, stamped weld's NDE-relevant fields.
        let raw: Vec<(String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT stamp_number, nde_percent, nde_types, nde_result, joint_type, nde_date, rt_date
                 FROM welds
                 WHERE count_omission = 0 AND stamp_number IS NOT NULL AND stamp_number <> ''",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };

        // Accumulate per (stamp, spec-index). `inspected_by_stamp` counts welds
        // that were actually examined (a recorded result), the honest
        // denominator for reject rate.
        let mut acc: std::collections::BTreeMap<String, [NdeSpecStat; 5]> =
            std::collections::BTreeMap::new();
        let mut inspected_by_stamp: std::collections::BTreeMap<String, i64> =
            std::collections::BTreeMap::new();
        for (stamp, nde_percent, nde_types, nde_result, joint_type, _nde_date, rt_date) in &raw {
            let Some(spec_idx) = canonical_spec_index(nde_percent.as_deref()) else {
                continue; // no recognised spec on this weld
            };
            let entry = acc.entry(stamp.clone()).or_insert_with(|| {
                [
                    NdeSpecStat::empty(SPECS[0].0, SPECS[0].1),
                    NdeSpecStat::empty(SPECS[1].0, SPECS[1].1),
                    NdeSpecStat::empty(SPECS[2].0, SPECS[2].1),
                    NdeSpecStat::empty(SPECS[3].0, SPECS[3].1),
                    NdeSpecStat::empty(SPECS[4].0, SPECS[4].1),
                ]
            });
            let s = &mut entry[spec_idx];
            s.population += 1;
            let is_api570 = spec_idx == 4;
            // "Inspected" means an NDE was actually performed and dispositioned —
            // a recorded result (or a legacy RT date). Planned NDE types or a
            // stray date alone do NOT count, so we never overstate coverage and
            // hide a welder that has fallen below spec.
            let inspected = was_examined(nde_result.as_deref(), rt_date.as_deref());
            if inspected {
                *inspected_by_stamp.entry(stamp.clone()).or_default() += 1;
            }
            // A weld meets its spec by being inspected (percentage specs) or by
            // carrying its two required NDE forms (API 570).
            let met = if is_api570 {
                api570_satisfied(joint_type.as_deref(), nde_types.as_deref())
            } else {
                inspected
            };
            if met {
                s.examined += 1;
            }
            if nde_result.as_deref().is_some_and(|r| r.eq_ignore_ascii_case("Rejected")) {
                s.rejected += 1;
            }
        }

        // welder name/active lookup
        let welders = self.list_welders(true, "name")?;
        let name_of = |stamp: &str| -> (String, bool) {
            welders
                .iter()
                .find(|w| w.stamp.eq_ignore_ascii_case(stamp))
                .map(|w| (w.name.clone(), w.active))
                .unwrap_or_else(|| (String::new(), false))
        };

        let mut fleet: Vec<NdeSpecStat> = SPECS
            .iter()
            .map(|(s, p)| NdeSpecStat::empty(s, *p))
            .collect();
        let mut out: Vec<WelderNdeCompliance> = Vec::new();
        for (stamp, arr) in acc {
            let mut specs: Vec<NdeSpecStat> = Vec::new();
            let (mut tw, mut te, mut tr, mut worst) = (0i64, 0i64, 0i64, 0i64);
            let mut all_ok = true;
            for (i, s) in arr.into_iter().enumerate() {
                if s.population == 0 {
                    continue;
                }
                let s = s.finish_welder(i == 4);
                tw += s.population;
                te += s.examined;
                tr += s.rejected;
                worst = worst.max(s.shortfall);
                all_ok &= s.compliant;
                // fold into fleet roll-up (sum per-welder requirements)
                fleet[i].population += s.population;
                fleet[i].examined += s.examined;
                fleet[i].required += s.required;
                fleet[i].shortfall += s.shortfall;
                fleet[i].rejected += s.rejected;
                specs.push(s);
            }
            if specs.is_empty() {
                continue;
            }
            let (name, active) = name_of(&stamp);
            let inspected = *inspected_by_stamp.get(&stamp).unwrap_or(&0);
            out.push(WelderNdeCompliance {
                stamp,
                name,
                active,
                specs,
                total_welds: tw,
                total_examined: te,
                total_inspected: inspected,
                total_rejected: tr,
                // rejected out of welds actually inspected — rejected is always a
                // subset of inspected, so this can never exceed 100%.
                reject_rate: ratio(tr, inspected),
                compliant: all_ok,
                worst_gap: worst,
            });
        }

        // finalise fleet roll-up percentages / compliance
        for f in &mut fleet {
            f.compliant = f.shortfall == 0;
            f.actual_pct = if f.population == 0 {
                0.0
            } else {
                f.examined as f64 / f.population as f64 * 100.0
            };
        }
        fleet.retain(|f| f.population > 0);

        // most-behind welders first, then alphabetical.
        out.sort_by(|a, b| {
            b.worst_gap
                .cmp(&a.worst_gap)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        let noncompliant_count = out.iter().filter(|w| !w.compliant).count() as i64;
        let welder_count = out.len() as i64;

        // Welds whose logged NDE % contradicts the facility rule for their
        // shop/field/tie-in status (e.g. a shop weld not at 5%).
        let spec_mismatch_count: i64 = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT old_to_new, shop_or_field, nde_percent FROM welds WHERE count_omission = 0",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })?;
            let mut n = 0i64;
            for row in rows {
                let (otn, sf, actual) = row?;
                if let Some(expected) =
                    crate::welds::default_spec_for(otn.as_deref(), sf.as_deref())
                {
                    if !actual.unwrap_or_default().eq_ignore_ascii_case(expected) {
                        n += 1;
                    }
                }
            }
            n
        };

        Ok(NdeComplianceReport {
            welders: out,
            by_spec: fleet,
            welder_count,
            noncompliant_count,
            spec_mismatch_count,
        })
    }

    /// Consolidated performance & NDE-compliance report over an optional date
    /// window [from, to] (inclusive 'YYYY-MM-DD'; None = open-ended). This is the
    /// data behind the distribution PDF: per welder, their throughput and whether
    /// they held at or above every NDE spec they welded to, plus a fleet summary
    /// and a per-work-order roll-up.
    pub fn report_performance(
        &self,
        from: Option<String>,
        to: Option<String>,
    ) -> Result<PerformanceReport> {
        const SPECS: &[(&str, f64)] = &[
            ("5%", 5.0), ("10%", 10.0), ("20%", 20.0), ("100%", 100.0), ("API 570", 100.0),
        ];
        let empty_specs = || {
            [
                NdeSpecStat::empty(SPECS[0].0, SPECS[0].1),
                NdeSpecStat::empty(SPECS[1].0, SPECS[1].1),
                NdeSpecStat::empty(SPECS[2].0, SPECS[2].1),
                NdeSpecStat::empty(SPECS[3].0, SPECS[3].1),
                NdeSpecStat::empty(SPECS[4].0, SPECS[4].1),
            ]
        };

        // Date-window predicate.
        let mut where_extra = String::new();
        let mut args: Vec<Value> = Vec::new();
        if let Some(f) = &from {
            where_extra.push_str(" AND date_welded >= ?");
            args.push(Value::Text(f.clone()));
        }
        if let Some(t) = &to {
            where_extra.push_str(" AND date_welded <= ?");
            args.push(Value::Text(t.clone()));
        }

        struct Raw {
            stamp: String,
            nde_percent: Option<String>,
            nde_types: Option<String>,
            nde_result: Option<String>,
            joint_type: Option<String>,
            rt_date: Option<String>,
            nde_date: Option<String>,
            weld_inches: f64,
            work_order: Option<String>,
        }
        let raw: Vec<Raw> = {
            let conn = self.conn.lock().unwrap();
            let sql = format!(
                "SELECT stamp_number, nde_percent, nde_types, nde_result, joint_type,
                        rt_date, nde_date, COALESCE(weld_inches, 0), work_order
                 FROM welds
                 WHERE count_omission = 0 AND stamp_number IS NOT NULL AND stamp_number <> ''{where_extra}"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
                Ok(Raw {
                    stamp: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    nde_percent: r.get(1)?,
                    nde_types: r.get(2)?,
                    nde_result: r.get(3)?,
                    joint_type: r.get(4)?,
                    rt_date: r.get(5)?,
                    nde_date: r.get(6)?,
                    weld_inches: r.get(7)?,
                    work_order: r.get(8)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };

        struct Acc {
            specs: [NdeSpecStat; 5],
            weld_count: i64,
            weld_inches: f64,
            inspected: i64,
            rejects: i64,
            last_rt: Option<String>,
        }
        struct WoAcc {
            weld_count: i64,
            weld_inches: f64,
            inspected: i64,
            rejects: i64,
        }
        let mut per: std::collections::BTreeMap<String, Acc> = std::collections::BTreeMap::new();
        let mut wos: std::collections::BTreeMap<String, WoAcc> = std::collections::BTreeMap::new();

        for w in &raw {
            let a = per.entry(w.stamp.clone()).or_insert_with(|| Acc {
                specs: empty_specs(),
                weld_count: 0,
                weld_inches: 0.0,
                inspected: 0,
                rejects: 0,
                last_rt: None,
            });
            a.weld_count += 1;
            a.weld_inches += w.weld_inches;
            let inspected = was_examined(w.nde_result.as_deref(), w.rt_date.as_deref());
            if inspected {
                a.inspected += 1;
            }
            let rejected = w
                .nde_result
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case("Rejected"));
            if rejected {
                a.rejects += 1;
            }
            // latest examination date (rt_date, else nde_date)
            let d = w
                .rt_date
                .clone()
                .filter(|s| !s.trim().is_empty())
                .or_else(|| w.nde_date.clone().filter(|s| !s.trim().is_empty()));
            if let Some(d) = d {
                if a.last_rt.as_deref().is_none_or(|cur| d.as_str() > cur) {
                    a.last_rt = Some(d);
                }
            }
            if let Some(idx) = canonical_spec_index(w.nde_percent.as_deref()) {
                let s = &mut a.specs[idx];
                s.population += 1;
                let met = if idx == 4 {
                    api570_satisfied(w.joint_type.as_deref(), w.nde_types.as_deref())
                } else {
                    inspected
                };
                if met {
                    s.examined += 1;
                }
                if rejected {
                    s.rejected += 1;
                }
            }
            if let Some(name) = w.work_order.as_deref().filter(|s| !s.trim().is_empty()) {
                let wa = wos.entry(name.to_string()).or_insert(WoAcc {
                    weld_count: 0,
                    weld_inches: 0.0,
                    inspected: 0,
                    rejects: 0,
                });
                wa.weld_count += 1;
                wa.weld_inches += w.weld_inches;
                if inspected {
                    wa.inspected += 1;
                }
                if rejected {
                    wa.rejects += 1;
                }
            }
        }

        let welders = self.list_welders(true, "name")?;
        let mut fleet: Vec<NdeSpecStat> =
            SPECS.iter().map(|(s, p)| NdeSpecStat::empty(s, *p)).collect();
        let mut rows: Vec<PerformanceRow> = Vec::new();
        let (mut tot_w, mut tot_in, mut tot_insp, mut tot_rej) = (0i64, 0.0f64, 0i64, 0i64);

        for (stamp, a) in per {
            let mut specs: Vec<NdeSpecStat> = Vec::new();
            let mut in_spec = true;
            let mut worst = 0i64;
            let mut min_actual = 100.0f64;
            for (i, s) in a.specs.into_iter().enumerate() {
                if s.population == 0 {
                    continue;
                }
                let s = s.finish_welder(i == 4);
                in_spec &= s.compliant;
                worst = worst.max(s.shortfall);
                min_actual = min_actual.min(s.actual_pct);
                fleet[i].population += s.population;
                fleet[i].examined += s.examined;
                fleet[i].required += s.required;
                fleet[i].shortfall += s.shortfall;
                fleet[i].rejected += s.rejected;
                specs.push(s);
            }
            let assigned_specs = specs
                .iter()
                .map(|s| s.spec.clone())
                .collect::<Vec<_>>()
                .join(", ");
            let welder = welders.iter().find(|w| w.stamp.eq_ignore_ascii_case(&stamp));
            let (name, active) = welder
                .map(|w| (w.name.clone(), w.active))
                .unwrap_or_else(|| (String::new(), false));
            let processes = welder.and_then(|w| self.welder_cert_processes(w.id).ok().flatten());
            tot_w += a.weld_count;
            tot_in += a.weld_inches;
            tot_insp += a.inspected;
            tot_rej += a.rejects;
            rows.push(PerformanceRow {
                stamp,
                name,
                active,
                weld_count: a.weld_count,
                weld_inches: a.weld_inches,
                inspected: a.inspected,
                rt_pct: ratio(a.inspected, a.weld_count),
                rejects: a.rejects,
                reject_rate: ratio(a.rejects, a.inspected),
                specs,
                assigned_specs,
                min_actual_pct: min_actual,
                in_spec,
                worst_gap: worst,
                last_rt: a.last_rt,
                processes,
            });
        }

        for f in &mut fleet {
            f.compliant = f.shortfall == 0;
            f.actual_pct = if f.population == 0 {
                0.0
            } else {
                f.examined as f64 / f.population as f64 * 100.0
            };
        }
        fleet.retain(|f| f.population > 0);

        let welders_below_spec = rows.iter().filter(|r| !r.in_spec).count() as i64;
        let welders_in_spec = rows.iter().filter(|r| r.in_spec).count() as i64;

        // Below-spec welders first (largest shortfall), then alphabetical.
        rows.sort_by(|a, b| {
            b.worst_gap
                .cmp(&a.worst_gap)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        let mut work_orders: Vec<PerfWorkOrder> = wos
            .into_iter()
            .map(|(k, v)| PerfWorkOrder {
                work_order: k,
                weld_count: v.weld_count,
                weld_inches: v.weld_inches,
                inspected: v.inspected,
                rt_pct: ratio(v.inspected, v.weld_count),
                rejects: v.rejects,
                reject_rate: ratio(v.rejects, v.inspected),
            })
            .collect();
        work_orders.sort_by(|a, b| a.work_order.cmp(&b.work_order));

        let generated_on: String = {
            let conn = self.conn.lock().unwrap();
            conn.query_row("SELECT date('now')", [], |r| r.get(0))?
        };
        let period_label = match (&from, &to) {
            (Some(f), Some(t)) => format!("{f} to {t}"),
            (Some(f), None) => format!("from {f}"),
            (None, Some(t)) => format!("through {t}"),
            (None, None) => "All time".to_string(),
        };

        Ok(PerformanceReport {
            period_label,
            from,
            to,
            generated_on,
            total_welds: tot_w,
            total_inches: tot_in,
            total_inspected: tot_insp,
            fleet_rt_pct: ratio(tot_insp, tot_w),
            total_rejects: tot_rej,
            fleet_reject_rate: ratio(tot_rej, tot_insp),
            welders_in_spec,
            welders_below_spec,
            by_spec: fleet,
            rows,
            work_orders,
        })
    }
}

/// Map a weld's `nde_percent` value to a canonical spec index into `SPECS`
/// (0=5%, 1=10%, 2=20%, 3=100%, 4=API 570). Returns None for unrecognised /
/// unset specs so those welds sit outside compliance tracking.
fn canonical_spec_index(nde_percent: Option<&str>) -> Option<usize> {
    let p = nde_percent?.trim();
    if p.is_empty() {
        return None;
    }
    let up = p.to_uppercase();
    if up.contains("API") || up.contains("570") {
        return Some(4);
    }
    let digits: String = p.chars().filter(|c| c.is_ascii_digit()).collect();
    match digits.as_str() {
        "5" => Some(0),
        "10" => Some(1),
        "20" => Some(2),
        "100" => Some(3),
        _ => None,
    }
}

/// Whether a weld's NDE was actually performed and dispositioned — a recorded
/// result, or a legacy RT date. A planned NDE type or a bare date does NOT
/// count, so coverage is never overstated and a welder below spec is never
/// hidden.
fn was_examined(nde_result: Option<&str>, rt_date: Option<&str>) -> bool {
    let has = |o: Option<&str>| o.map(|s| !s.trim().is_empty()).unwrap_or(false);
    has(nde_result) || has(rt_date)
}

/// Whether an API-570 in-lieu-of-hydro weld carries its required two forms of
/// NDE. Butt welds need PT root & final *and* RT; fillet / branch (o-let) /
/// slip-on flange / socket welds need PT root & final.
fn api570_satisfied(joint_type: Option<&str>, nde_types: Option<&str>) -> bool {
    let tokens: Vec<String> = nde_types
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty())
        .collect();
    let has_pt_root_final = tokens.iter().any(|t| t.contains("PT ROOT"));
    let has_rt = tokens.iter().any(|t| t == "RT" || t.contains("RT "));
    let joint = joint_type.unwrap_or_default().to_uppercase();
    let is_butt = joint == "BW" || joint.contains("BUTT");
    if is_butt {
        has_pt_root_final && has_rt
    } else {
        // fillet, branch/o-let, slip-on flange, socket, and anything else on
        // API 570 in lieu of hydro: PT root & final.
        has_pt_root_final
    }
}
