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
  shift?: string | null;
  crew?: string | null;
  active: boolean;
  process?: string | null;
  wpqs?: string | null;
  wpq_status?: string | null;
  training?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
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
}

export interface Drawing {
  id: number;
  work_order?: string | null;
  drawing_no?: string | null;
  unit?: string | null;
  line_spec?: string | null;
  line_spec_2?: string | null;
  revision?: string | null;
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

export interface WeldFilter {
  search?: string;
  work_order?: string;
  stamp_number?: string;
  joint_type?: string;
  status?: string;
  unit?: string;
  limit?: number;
  offset?: number;
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

export interface SummaryReport {
  by_joint: JointStat[];
  total: JointStat;
  welder_count: number;
  active_welder_count: number;
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
  shift?: string | null;
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
}

export type Lookups = Record<string, string[]>;
export type Settings = Record<string, string>;
