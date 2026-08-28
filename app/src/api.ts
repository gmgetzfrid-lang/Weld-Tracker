import { invoke } from "@tauri-apps/api/core";
import type {
  ClientReportRow,
  CriteriaRow,
  DailyReport,
  Drawing,
  JobReport,
  Lookups,
  MonthlyReport,
  NdeComplianceReport,
  PerformanceReport,
  PipeRow,
  Settings,
  SummaryReport,
  User,
  Weld,
  WeldFilter,
  Welder,
  WelderCert,
  WelderContinuity,
  WelderStatRow,
  WelderStatsReport,
  WorkOrderSummary,
} from "./types";

// Thin, typed wrapper over the Tauri command layer.
export const api = {
  // auth / session
  login: (username: string, password: string) =>
    invoke<User>("login", { username, password }),
  logout: () => invoke<void>("logout"),
  currentUser: () => invoke<User | null>("current_user"),
  dbInfo: () => invoke<{ path: string; shared: boolean }>("db_info"),
  changePassword: (currentPassword: string, newPassword: string) =>
    invoke<void>("change_password", { currentPassword, newPassword }),

  // users (admin)
  listUsers: () => invoke<User[]>("list_users"),
  createUser: (
    username: string,
    displayName: string,
    role: string,
    password: string,
    mustChange: boolean
  ) =>
    invoke<User>("create_user", {
      username,
      displayName,
      role,
      password,
      mustChange,
    }),
  setUserActive: (id: number, active: boolean) =>
    invoke<void>("set_user_active", { id, active }),
  setUserRole: (id: number, role: string) =>
    invoke<void>("set_user_role", { id, role }),
  adminResetPassword: (id: number, newPassword: string) =>
    invoke<void>("admin_reset_password", { id, newPassword }),

  // welders
  listWelders: (includeInactive: boolean, sortBy: string) =>
    invoke<Welder[]>("list_welders", { includeInactive, sortBy }),
  getWelder: (id: number) => invoke<Welder>("get_welder", { id }),
  createWelder: (welder: Welder) => invoke<number>("create_welder", { welder }),
  updateWelder: (welder: Welder) => invoke<void>("update_welder", { welder }),
  deleteWelder: (id: number) => invoke<void>("delete_welder", { id }),

  // welder certs (qualifications) + continuity
  listWelderCerts: (welderId: number) =>
    invoke<WelderCert[]>("list_welder_certs", { welderId }),
  welderCertAliases: (stamp: string) =>
    invoke<string[]>("welder_cert_aliases", { stamp }),
  createWelderCert: (cert: WelderCert) =>
    invoke<number>("create_welder_cert", { cert }),
  updateWelderCert: (cert: WelderCert) =>
    invoke<void>("update_welder_cert", { cert }),
  deleteWelderCert: (id: number) => invoke<void>("delete_welder_cert", { id }),
  setWelderCertFile: (id: number, name: string, dataBase64: string) =>
    invoke<void>("set_welder_cert_file", { id, name, dataBase64 }),
  getWelderCertFile: (id: number) =>
    invoke<[string, string] | null>("get_welder_cert_file", { id }),
  welderContinuity: (welderId: number) =>
    invoke<WelderContinuity>("welder_continuity", { welderId }),

  // welds
  listWelds: (filter: WeldFilter) => invoke<Weld[]>("list_welds", { filter }),
  countWelds: (filter: WeldFilter) => invoke<number>("count_welds", { filter }),
  getWeld: (id: number) => invoke<Weld>("get_weld", { id }),
  createWeld: (weld: Weld) => invoke<number>("create_weld", { weld }),
  updateWeld: (weld: Weld) => invoke<void>("update_weld", { weld }),
  deleteWeld: (id: number) => invoke<void>("delete_weld", { id }),
  createRepair: (weldId: number, includeTracers: boolean) =>
    invoke<number[]>("create_repair", { weldId, includeTracers }),
  distinctWeldValues: (field: string) =>
    invoke<string[]>("distinct_weld_values", { field }),

  // work orders (records directory)
  listWorkOrders: () => invoke<WorkOrderSummary[]>("list_work_orders"),
  deleteWorkOrder: (workOrder: string) =>
    invoke<[number, number]>("delete_work_order", { workOrder }),
  workOrderOwner: (workOrder: string) =>
    invoke<string | null>("work_order_owner", { workOrder }),
  listDrawingsForWo: (workOrder: string) =>
    invoke<Drawing[]>("list_drawings_for_wo", { workOrder }),

  // drawings & weld-bubble annotation
  listDrawings: () => invoke<Drawing[]>("list_drawings"),
  getDrawing: (id: number) => invoke<Drawing>("get_drawing", { id }),
  createDrawing: (drawing: Drawing) =>
    invoke<number>("create_drawing", { drawing }),
  updateDrawing: (drawing: Drawing) =>
    invoke<void>("update_drawing", { drawing }),
  deleteDrawing: (id: number) => invoke<void>("delete_drawing", { id }),
  setDrawingPdf: (id: number, name: string, dataBase64: string, pageCount: number) =>
    invoke<void>("set_drawing_pdf", { id, name, dataBase64, pageCount }),
  getDrawingPdf: (id: number) =>
    invoke<[string, string] | null>("get_drawing_pdf", { id }),
  listDrawingWelds: (drawingId: number) =>
    invoke<Weld[]>("list_drawing_welds", { drawingId }),
  nextWeldNumber: (drawingId: number) =>
    invoke<number>("next_weld_number", { drawingId }),
  addBubbleWeld: (
    drawingId: number,
    stamp: string | null,
    weldNumber: string,
    page: number,
    bubbleX: number,
    bubbleY: number,
    jointX: number,
    jointY: number
  ) =>
    invoke<Weld>("add_bubble_weld", {
      drawingId,
      stamp,
      weldNumber,
      page,
      bubbleX,
      bubbleY,
      jointX,
      jointY,
    }),
  setWeldBubble: (
    weldId: number,
    page: number,
    bubbleX: number,
    bubbleY: number,
    jointX: number,
    jointY: number
  ) =>
    invoke<void>("set_weld_bubble", {
      weldId,
      page,
      bubbleX,
      bubbleY,
      jointX,
      jointY,
    }),
  applyWeldAttributes: (
    ids: number[],
    attrs: {
      size?: number | null;
      joint_type?: string | null;
      groove_type?: string | null;
      process?: string | null;
      schedule?: string | null;
      material?: string | null;
    }
  ) => invoke<void>("apply_weld_attributes", { ids, ...attrs }),

  // reference data
  listPipe: () => invoke<PipeRow[]>("list_pipe"),
  pipeSizes: () => invoke<number[]>("pipe_sizes"),
  lookupThickness: (nps: number, schedule: string) =>
    invoke<number | null>("lookup_thickness", { nps, schedule }),
  lookupsGrouped: () => invoke<Lookups>("lookups_grouped"),
  addLookup: (kind: string, value: string) =>
    invoke<void>("add_lookup", { kind, value }),
  removeLookup: (kind: string, value: string) =>
    invoke<void>("remove_lookup", { kind, value }),
  getSettings: () => invoke<Settings>("get_settings"),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),
  listCriteria: () => invoke<CriteriaRow[]>("list_criteria"),

  // reports
  reportSummary: () => invoke<SummaryReport>("report_summary"),
  reportJob: (workOrder: string) =>
    invoke<JobReport>("report_job", { workOrder }),
  reportDaily: (date: string) => invoke<DailyReport>("report_daily", { date }),
  reportMonthly: (year: number) =>
    invoke<MonthlyReport>("report_monthly", { year }),
  reportWelderStats: (level: string) =>
    invoke<WelderStatsReport>("report_welder_stats", { level }),
  reportWelder: (stamp: string) =>
    invoke<WelderStatRow>("report_welder", { stamp }),
  reportClient: (month: number, year: number) =>
    invoke<ClientReportRow[]>("report_client", { month, year }),
  reportQm: () => invoke<WelderStatRow[]>("report_qm"),
  reportNdeCompliance: () =>
    invoke<NdeComplianceReport>("report_nde_compliance"),
  reportPerformance: (from: string | null, to: string | null) =>
    invoke<PerformanceReport>("report_performance", { from, to }),
};

/** Reject-rate warning threshold (as a 0..1 fraction) from settings. */
export function rejectThreshold(): Promise<number> {
  return api
    .getSettings()
    .then((s) => {
      const p = parseFloat(s.reject_rate_warn_pct || "5");
      return isFinite(p) ? p / 100 : 0.05;
    })
    .catch(() => 0.05);
}

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
