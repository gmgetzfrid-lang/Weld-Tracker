export type Role = "admin" | "editor" | "viewer";

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  must_change_password: boolean;
  active: boolean;
  created_at: string;
  last_login?: string | null;
}

export interface Welder {
  id: number;
  stamp: string;
  name: string;
  active: boolean;
  // Process / WPQs live on each qualification cert (WelderCert), not the welder.
  training?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface WelderCert {
  id: number;
  welder_id: number;
  alias: string;
  process?: string | null;
  qualified_date?: string | null;
  file_name?: string | null;
  has_file: boolean;
  notes?: string | null;
  // computed
  status: string; // "Active" | "Inactive"
  last_activity?: string | null;
  continuous_through?: string | null;
  weld_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface ContinuityEvent {
  date: string;
  cert_alias: string;
  process?: string | null;
  weld_number?: string | null;
  work_order?: string | null;
  drawing_no?: string | null;
  result: string;
}

export interface WelderContinuity {
  welder_id: number;
  stamp: string;
  name: string;
  certs: WelderCert[];
  events: ContinuityEvent[];
  generated_on: string;
}

export interface Weld {
  id: number;
  unit?: string | null;
  drawing_no?: string | null;
  work_order?: string | null;
  line_spec?: string | null;
  spec_5: boolean;
  spec_10: boolean;
  spec_20: boolean;
  spec_25: boolean;
  spec_50: boolean;
  spec_100: boolean;
  material?: string | null;
  schedule?: string | null;
  size?: number | null;
  thickness?: number | null;
  weld_inches?: number | null;
  joint_type?: string | null;
  old_to_new?: string | null;
  // EP 5-5-1 Table 4 drivers
  b31_code?: string | null;
  service_category?: string | null;
  material_group?: string | null;
  flange_class?: string | null;
  aes_service?: boolean;
  new_to_existing?: boolean;
  ut_wall_existing?: number | null;
  ut_wall_new?: number | null;
  governing_wall?: number | null;
  pwht_required?: boolean;
  pmi_required?: boolean;
  hydro_status?: string | null;
  b31_temp_f?: number | null;
  b31_pressure_psig?: number | null;
  required_nde_method?: string | null;
  weld_number?: string | null;
  count_omission: boolean;
  stamp_number?: string | null;
  date_welded?: string | null;
  shop_or_field?: string | null;
  ut_thickness?: string | null;
  pt_mt_prep?: string | null;
  pt_mt_root?: string | null;
  pt_mt_final?: string | null;
  visual_insp?: string | null;
  rt_date?: string | null;
  rt_accepted?: string | null;
  rt_rejected?: string | null;
  inches_of_defect?: number | null;
  h2_bake_out?: string | null;
  ferrite?: string | null;
  pwht_date?: string | null;
  brinnel_complete?: string | null;
  pmi_date?: string | null;
  hydro_pressure?: string | null;
  hydro_comp_date?: string | null;
  wps_number?: string | null;
  description?: string | null;
  file_location?: string | null;
  status: string;
  cert_alias?: string | null;
  nde_percent?: string | null;
  nde_types?: string | null;
  nde_result?: string | null;
  nde_date?: string | null;
  pwht_temp?: string | null;
  brinnel_value?: string | null;
  hydro_time_held?: string | null;
  drawing_id?: number | null;
  groove_type?: string | null;
  process?: string | null;
  bubble_page?: number | null;
  bubble_x?: number | null;
  bubble_y?: number | null;
  joint_x?: number | null;
  joint_y?: number | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Read-only: the EP 5-5-1 Table 4 required NDE % for this weld. */
  expected_nde_percent?: string | null;
  /** Read-only: the required NDE method label ("RT", "PT/MT root & final", …). */
  expected_nde_method?: string | null;
  /** Read-only: the governing Table 4 row plus any supplemental requirements. */
  expected_nde_note?: string | null;
  /** Snapshot: the rule set (procedure + revision) the requirement was frozen against. */
  nde_rule_set?: string | null;
  /** Snapshot: true when every Table 4 driver was resolved; false = fail-closed. */
  expected_nde_resolved?: boolean;
  /** Snapshot: semicolon-joined missing / unrecognized drivers when unresolved. */
  expected_nde_blockers?: string | null;
  /** NDE report number the examination came back under. */
  nde_report_no?: string | null;
  /** Why the entered NDE % deliberately differs from the calculated requirement. */
  nde_override_reason?: string | null;
  /** Optimistic-concurrency token; sent back on update to detect a clash. */
  row_version?: number;
  /** Repair chain: id of the weld this one repairs, if any. */
  parent_weld_id?: number | null;
  /** Soft-delete: set when the weld is Voided (retained, excluded from counts). */
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
}

/** The computed EP 5-5-1 Table 4 requirement (live readout during entry). */
export interface NdeRequirement {
  rt_percent: number;
  ptmt_percent: number;
  required_percent: number;
  method: string;
  root_and_final: boolean;
  note: string;
  supplemental: string[];
  /** True only when every driver needed to decide the requirement is present
   *  and recognized. When false, the percentage is a fail-safe placeholder —
   *  the UI must flag it and block sign-off, never present it as the spec. */
  resolved: boolean;
  /** What is missing / unrecognized when `resolved` is false. */
  blockers: string[];
  /** The rule set (procedure + revision) this was computed against. */
  rule_set: string;
}

/** One hit from the global (Ctrl+K) search. */
export interface SearchHit {
  kind: "work_order" | "welder" | "drawing" | "weld";
  label: string;
  sublabel?: string | null;
  work_order?: string | null;
  weld_id?: number | null;
  stamp?: string | null;
}

/** Validation-engine severity. */
export type Severity = "error" | "warning" | "advisory";

/** One validation finding about a weld. */
export interface Finding {
  severity: Severity;
  code: string;
  message: string;
}

/** A weld with at least one finding, for the exceptions dashboard. */
export interface WeldException {
  weld_id: number;
  weld_number?: string | null;
  work_order?: string | null;
  drawing_no?: string | null;
  stamp_number?: string | null;
  severity: Severity;
  findings: Finding[];
}

/** The fleet-wide exceptions roll-up. */
export interface ExceptionsSummary {
  population: number;
  flagged: number;
  errors: number;
  warnings: number;
  advisories: number;
  by_code: Record<string, number>;
  welds: WeldException[];
}

/** One row of the Activity log (audit trail). */
export interface AuditEntry {
  id: number;
  ts: string;
  username?: string | null;
  action?: string | null;
  entity?: string | null;
  entity_id?: string | null;
  detail?: string | null;
}

/** One file in a work order's quality package. */
export interface QualityFile {
  id: number;
  work_order: string;
  category?: string | null;
  name?: string | null;
  mime?: string | null;
  note?: string | null;
  has_file: boolean;
  size: number;
  uploaded_by?: string | null;
  uploaded_at: string;
  /** SHA-256 of the stored bytes — integrity fingerprint. */
  sha256?: string | null;
}

export interface Drawing {
  id: number;
  work_order?: string | null;
  drawing_no?: string | null;
  sheet_no?: string | null;
  unit?: string | null;
  line_spec?: string | null;
  line_spec_2?: string | null;
  revision?: string | null;
  current_revision_id?: number | null;
  rev_status?: string | null;
  rev_count?: number;
  /** Composed controlled-document name, e.g. "ISO-1042 SHT 2 Rev A". */
  doc_name?: string;
  title?: string | null;
  spec_5: boolean;
  spec_10: boolean;
  spec_20: boolean;
  spec_25: boolean;
  spec_50: boolean;
  spec_100: boolean;
  default_material?: string | null;
  pdf_name?: string | null;
  has_pdf: boolean;
  page_count: number;
  weld_count: number;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentPackage {
  id: number;
  work_order?: string | null;
  name?: string | null;
  page_count: number;
  has_pdf: boolean;
  uploaded_by?: string | null;
  uploaded_at?: string;
  /** SHA-256 of the stored PDF — proves the controlled copy is unchanged. */
  sha256?: string | null;
}

export interface DrawingRevision {
  id: number;
  drawing_id: number;
  rev?: string | null;
  status: string; // Effective | Superseded
  package_id?: number | null;
  page_from?: number | null;
  page_to?: number | null;
  reason?: string | null;
  issued_date?: string | null;
  created_by?: string | null;
  created_at?: string;
  superseded_at?: string | null;
  has_pdf: boolean;
  page_count: number;
}

/** (name, base64, page_from, page_to) controlled-copy window. */
export type PdfWindow = [string, string, number, number];

export interface WeldFilter {
  search?: string;
  work_order?: string;
  stamp_number?: string;
  joint_type?: string;
  status?: string;
  unit?: string;
  limit?: number;
  offset?: number;
  /** Include voided (soft-deleted) welds. Default false. */
  include_voided?: boolean;
}

export interface PipeRow {
  id: number;
  nps: number;
  od?: number | null;
  schedule: string;
  wall: number;
}

export interface CriteriaRow {
  id: number;
  category: string;
  description: string;
  rt_percent?: number | null;
}

export interface JointStat {
  joint_type: string;
  welds: number;
  rt: number;
  accepted: number;
  rejected: number;
  pt_mt: number;
  brinnel: number;
  inches: number;
  rt_pct: number;
  reject_rate: number;
}

export interface OutputSeriesPoint {
  /** "2026-05-14" (day), "2026-W19" (week), "2026-05" (month), "2026" (year). */
  bucket: string;
  welds: number;
  inches: number;
  examined: number;
  rejects: number;
}

export interface OutputSeries {
  stamp: string;
  name: string;
  total_welds: number;
  total_inches: number;
  points: OutputSeriesPoint[];
}

export interface SummaryReport {
  by_joint: JointStat[];
  total: JointStat;
  welder_count: number;
  active_welder_count: number;
  /** Welders with at least one current (six-month continuity) qualification. */
  current_cert_welder_count: number;
}

export interface WelderStatRow {
  stamp: string;
  name: string;
  active: boolean;
  by_joint: JointStat[];
  total: JointStat;
}

export interface WelderStatsReport {
  level: string;
  rows: WelderStatRow[];
  total: JointStat;
}

export interface MonthlyJoint {
  joint_type: string;
  welds: number[];
  accepted: number[];
  rejected: number[];
  inches: number[];
}

export interface MonthlyReport {
  year: number;
  joints: MonthlyJoint[];
  total_welds: number[];
  total_rt: number[];
  total_rejected: number[];
  total_inches: number[];
}

export interface DailyRow {
  date: string;
  welds: number;
  rt: number;
  rejected: number;
  inches: number;
}

export interface DailyReport {
  date: string;
  by_joint: JointStat[];
  total: JointStat;
  recent: DailyRow[];
}

export interface JobReport {
  work_order: string;
  butt: JointStat;
  other: JointStat;
  total_welds: number;
  total_examined: number;
  total_examined_pct: number;
}

export interface ClientReportRow {
  stamp: string;
  name: string;
  /** The welder's qualified process(es), derived from their certs. */
  process?: string | null;
  weld_count: number;
  inches: number;
  rt_count: number;
  rt_pct: number;
  rejects: number;
  reject_rate: number;
  last_rt_date?: string | null;
}

export interface WorkOrderSummary {
  work_order: string;
  unit?: string | null;
  drawing_count: number;
  weld_count: number;
  last_activity?: string | null;
  /** Who created the work order. The owner (or an admin) may delete the whole thing. */
  owner?: string | null;
}

export interface NdeSpecStat {
  spec: string; // "5%" | "10%" | "20%" | "100%" | "API 570"
  required_pct: number;
  population: number;
  examined: number;
  required: number;
  shortfall: number;
  rejected: number;
  actual_pct: number;
  compliant: boolean;
}

export interface WelderNdeCompliance {
  stamp: string;
  name: string;
  active: boolean;
  specs: NdeSpecStat[];
  total_welds: number;
  total_examined: number;
  total_inspected: number;
  total_rejected: number;
  reject_rate: number;
  compliant: boolean;
  worst_gap: number;
}

export interface NdeComplianceReport {
  welders: WelderNdeCompliance[];
  by_spec: NdeSpecStat[];
  welder_count: number;
  noncompliant_count: number;
  spec_mismatch_count: number;
}

export interface PerformanceRow {
  stamp: string;
  name: string;
  active: boolean;
  weld_count: number;
  weld_inches: number;
  inspected: number;
  rt_pct: number; // 0..1
  rejects: number;
  reject_rate: number; // 0..1
  specs: NdeSpecStat[];
  assigned_specs: string;
  min_actual_pct: number; // 0..100
  in_spec: boolean;
  worst_gap: number;
  last_rt?: string | null;
  processes?: string | null;
}

export interface PerfWorkOrder {
  work_order: string;
  weld_count: number;
  weld_inches: number;
  inspected: number;
  rt_pct: number;
  rejects: number;
  reject_rate: number;
}

export interface PerformanceReport {
  period_label: string;
  from?: string | null;
  to?: string | null;
  generated_on: string;
  total_welds: number;
  total_inches: number;
  total_inspected: number;
  fleet_rt_pct: number;
  total_rejects: number;
  fleet_reject_rate: number;
  welders_in_spec: number;
  welders_below_spec: number;
  by_spec: NdeSpecStat[];
  rows: PerformanceRow[];
  work_orders: PerfWorkOrder[];
}

export type Lookups = Record<string, string[]>;
export type Settings = Record<string, string>;
