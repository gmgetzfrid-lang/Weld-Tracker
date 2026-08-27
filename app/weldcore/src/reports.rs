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

#[derive(Debug, Serialize)]
pub struct ClientReportRow {
    pub stamp: String,
    pub name: String,
    pub shift: Option<String>,
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
        result_rows.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
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
                    shift: None,
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
                row.shift = w.shift.clone();
                row.process = w.process.clone();
            }
        }
        let mut out: Vec<ClientReportRow> = map.into_values().collect();
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }

    // ---- QM summary (QM PVT) -----------------------------------------------
    /// Per-welder QC roll-up by joint type (stamp count, accepted, PT/MT, rejected).
    pub fn report_qm(&self) -> Result<Vec<WelderStatRow>> {
        // reuse welder stats "all" but keep the by_joint breakdown
        let stats = self.report_welder_stats("all")?;
        Ok(stats.rows)
    }
}
