import { invoke } from "@tauri-apps/api/core";
import type {
  AttentionItem,
  AuditEntry,
  LotCard,
  LotConfig,
  IncompleteWo,
  LotWoChoice,
  MaintainOutcome,
  Markup,
  MarkupTool,
  NdeLot,
  SuggestedExam,
  WoLotSummary,
  ClientReportRow,
  CriteriaRow,
  DailyReport,
  DocumentPackage,
  Drawing,
  DrawingRevision,
  ExceptionsSummary,
  JobReport,
  Lookups,
  OutputSeries,
  PdfWindow,
  MonthlyReport,
  NdeComplianceReport,
  NdeRequirement,
  PerformanceReport,
  PipeRow,
  QualityFile,
  SearchHit,
  Settings,
  NdeRuleSet,
  NdeRuleSetMeta,
  NdeReevaluateOutcome,
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
  /** Open a cert's WPQ with the OS viewer — file bytes never cross the bridge. */
  openWelderCert: (id: number) => invoke<string>("open_welder_cert", { id }),
  welderContinuity: (welderId: number) =>
    invoke<WelderContinuity>("welder_continuity", { welderId }),

  // welds
  listWelds: (filter: WeldFilter) => invoke<Weld[]>("list_welds", { filter }),
  countWelds: (filter: WeldFilter) => invoke<number>("count_welds", { filter }),
  getWeld: (id: number) => invoke<Weld>("get_weld", { id }),
  createWeld: (weld: Weld) => invoke<number>("create_weld", { weld }),
  updateWeld: (weld: Weld) => invoke<Weld>("update_weld", { weld }),
  // Void = the normal, record-preserving "delete". Purge = admin-only hard delete.
  voidWeld: (id: number, reason: string) => invoke<void>("void_weld", { id, reason }),
  restoreWeld: (id: number) => invoke<void>("restore_weld", { id }),
  deleteWeld: (id: number) => invoke<void>("delete_weld", { id }),
  recentActivity: (entity: string | null, limit?: number) =>
    invoke<AuditEntry[]>("recent_activity", { entity, limit }),
  /** "starting" | "ready" | "failed: …" — the splash polls this until ready. */
  bootStatus: () => invoke<string>("boot_status"),
  /** Per-welder output over day/week/month/year buckets for the performance chart. */
  welderOutputSeries: (from: string | null, to: string | null, bucket: "day" | "week" | "month" | "year") =>
    invoke<OutputSeries[]>("welder_output_series", { from, to, bucket }),
  backupDatabase: () => invoke<string>("backup_database"),
  openLogFolder: () => invoke<string>("open_log_folder"),
  /**
   * Save an export (PDF/CSV) into the per-user "SENTRIX Reports" folder.
   * Browser-style download links are inert inside the WebView, so every
   * export goes through this command. mode: "save" | "open" (launch with the
   * default app) | "reveal" (show selected in the file manager). Returns the
   * path written.
   */
  saveExport: (name: string, b64: string, mode: "save" | "open" | "reveal") =>
    invoke<string>("save_export", { name, b64, mode }),
  /** Record one NDE report's results across many welds at once. */
  recordNdeBatch: (
    entries: { id: number; result: string }[],
    types: string,
    date: string,
    reportNo?: string | null,
  ) => invoke<number>("record_nde_batch", { entries, types, date, reportNo: reportNo ?? null }),
  createRepair: (weldId: number, includeTracers: boolean) =>
    invoke<number[]>("create_repair", { weldId, includeTracers }),
  distinctWeldValues: (field: string) =>
    invoke<string[]>("distinct_weld_values", { field }),
  weldExceptions: (workOrder?: string | null) =>
    invoke<ExceptionsSummary>("weld_exceptions", { workOrder: workOrder ?? null }),
  globalSearch: (query: string) => invoke<SearchHit[]>("global_search", { query }),

  // work orders (records directory)
  listWorkOrders: () => invoke<WorkOrderSummary[]>("list_work_orders"),
  deleteWorkOrder: (workOrder: string, reason: string) =>
    invoke<[number, number]>("delete_work_order", { workOrder, reason }),
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
    invoke<PdfWindow | null>("get_drawing_pdf", { id }),

  // document control: packages & revisions
  createPackage: (workOrder: string | null, name: string, dataBase64: string, pageCount: number) =>
    invoke<number>("create_package", { workOrder, name, dataBase64, pageCount }),
  listPackages: (workOrder: string) =>
    invoke<DocumentPackage[]>("list_packages", { workOrder }),
  getPackagePdf: (id: number) =>
    invoke<[string, string] | null>("get_package_pdf", { id }),

  // work-order quality package
  addWoFile: (
    workOrder: string,
    category: string | null,
    name: string,
    mime: string | null,
    dataBase64: string,
    note: string | null
  ) =>
    invoke<number>("add_wo_file", { workOrder, category, name, mime, dataBase64, note }),
  listWoFiles: (workOrder: string) =>
    invoke<QualityFile[]>("list_wo_files", { workOrder }),
  getWoFile: (id: number) =>
    invoke<[string, string, string] | null>("get_wo_file", { id }),
  deleteWoFile: (id: number) => invoke<void>("delete_wo_file", { id }),

  // live EP 5-5-1 Table 4 requirement for a (partial) weld
  computeNde: (weld: Partial<Weld>) =>
    invoke<NdeRequirement>("compute_nde", { weld }),
  getRevisionPdf: (revId: number) =>
    invoke<PdfWindow | null>("get_revision_pdf", { revId }),
  setEffectiveSource: (drawingId: number, packageId: number, pageFrom: number, pageTo: number) =>
    invoke<void>("set_effective_source", { drawingId, packageId, pageFrom, pageTo }),
  reviseDrawing: (
    drawingId: number,
    newRev: string,
    reason: string | null,
    packageId: number | null,
    pageFrom: number | null,
    pageTo: number | null
  ) =>
    invoke<number>("revise_drawing", { drawingId, newRev, reason, packageId, pageFrom, pageTo }),
  listDrawingRevisions: (drawingId: number) =>
    invoke<DrawingRevision[]>("list_drawing_revisions", { drawingId }),
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
  ) =>
    // Tauri v2 exposes Rust snake_case parameters as camelCase invoke keys;
    // spreading the snake_case attrs would silently drop joint/groove type.
    invoke<void>("apply_weld_attributes", {
      ids,
      size: attrs.size ?? null,
      jointType: attrs.joint_type ?? null,
      grooveType: attrs.groove_type ?? null,
      process: attrs.process ?? null,
      schedule: attrs.schedule ?? null,
      material: attrs.material ?? null,
    }),

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
  // NDE examination rule sets — the configurable table behind every requirement
  ndeRulesActive: () => invoke<NdeRuleSet>("nde_rules_active"),
  ndeRulesList: () => invoke<NdeRuleSetMeta[]>("nde_rules_list"),
  ndeRulesGet: (id: string) => invoke<NdeRuleSet>("nde_rules_get", { id }),
  ndeRulesPreset: (key: "ep-5-5-1" | "asme-b31.3") => invoke<NdeRuleSet>("nde_rules_preset", { key }),
  ndeRulesValidate: (ruleSet: NdeRuleSet) => invoke<string[]>("nde_rules_validate", { ruleSet }),
  ndeRulesEvaluate: (ruleSet: NdeRuleSet | null, weld: Partial<Weld>) =>
    invoke<NdeRequirement>("nde_rules_evaluate", { ruleSet, weld }),
  ndeRulesSave: (ruleSet: NdeRuleSet) => invoke<NdeRuleSetMeta>("nde_rules_save", { ruleSet }),
  ndeRulesActivate: (id: string) => invoke<NdeRuleSetMeta>("nde_rules_activate", { id }),
  ndeRulesDelete: (id: string) => invoke<void>("nde_rules_delete", { id }),
  ndeRulesReevaluate: () => invoke<NdeReevaluateOutcome>("nde_rules_reevaluate"),
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
  reportPerformance: (from: string | null, to: string | null, lotId: number | null = null) =>
    invoke<PerformanceReport>("report_performance", { from, to, lotId }),

  // NDE lots
  lotConfig: () => invoke<LotConfig>("lot_config"),
  setLotConfig: (config: LotConfig) => invoke<LotConfig>("set_lot_config", { config }),
  setupLots: (config: LotConfig, history: string) =>
    invoke<[NdeLot, number]>("setup_lots", { config, history }),
  listLots: () => invoke<NdeLot[]>("list_lots"),
  getLotCard: (id: number) => invoke<LotCard>("get_lot_card", { id }),
  createLot: (label: string | null, makeDefault: boolean, targetMonths: number | null = null) =>
    invoke<NdeLot>("create_lot", { label, makeDefault, targetMonths }),
  turnOverLot: (reason: string | null = null) =>
    invoke<[NdeLot | null, NdeLot]>("turn_over_lot", { reason }),
  stopLotIntake: (id: number) => invoke<NdeLot>("stop_lot_intake", { id }),
  closeLot: (id: number, reason: string | null, force: boolean) =>
    invoke<NdeLot>("close_lot", { id, reason, force }),
  reopenLot: (id: number, reason: string) => invoke<NdeLot>("reopen_lot", { id, reason }),
  updateLotNotes: (id: number, label: string | null, notes: string | null, targetMonths: number | null = null) =>
    invoke<NdeLot>("update_lot_notes", { id, label, notes, targetMonths }),
  pinWorkOrder: (workOrder: string, lotId: number) =>
    invoke<number>("pin_work_order", { workOrder, lotId }),
  unpinWorkOrder: (workOrder: string) => invoke<void>("unpin_work_order", { workOrder }),
  moveWorkOrderToLot: (workOrder: string, lotId: number) =>
    invoke<number>("move_work_order_to_lot", { workOrder, lotId }),
  setWeldLot: (weldId: number, lotId: number | null) =>
    invoke<void>("set_weld_lot", { weldId, lotId }),
  lotAttention: () => invoke<AttentionItem[]>("lot_attention"),
  lotsAutoMaintain: () => invoke<MaintainOutcome>("lots_auto_maintain"),
  suggestExaminations: (lotId: number, stamp: string | null = null) =>
    invoke<SuggestedExam[]>("suggest_examinations", { lotId, stamp }),
  snoozeTurnover: (days: number) => invoke<LotConfig>("snooze_turnover", { days }),
  woLotSummary: (workOrder: string) => invoke<WoLotSummary>("wo_lot_summary", { workOrder }),
  lotWorkOrderChoices: () => invoke<LotWoChoice[]>("lot_work_order_choices"),

  incompleteWorkOrders: () => invoke<IncompleteWo[]>("incomplete_work_orders"),

  // drawing markups (redlines) + tool chest
  listMarkups: (drawingId: number) => invoke<Markup[]>("list_markups", { drawingId }),
  createMarkup: (markup: Partial<Markup>) => invoke<Markup>("create_markup", { markup }),
  updateMarkup: (markup: Markup) => invoke<Markup>("update_markup", { markup }),
  deleteMarkup: (id: number) => invoke<void>("delete_markup", { id }),
  reorderMarkups: (order: [number, number][]) => invoke<void>("reorder_markups", { order }),
  listMarkupTools: () => invoke<MarkupTool[]>("list_markup_tools"),
  createMarkupTool: (tool: Partial<MarkupTool>) => invoke<MarkupTool>("create_markup_tool", { tool }),
  updateMarkupTool: (tool: MarkupTool) => invoke<MarkupTool>("update_markup_tool", { tool }),
  deleteMarkupTool: (id: number) => invoke<void>("delete_markup_tool", { id }),
  renameMarkupCategory: (from: string, to: string) =>
    invoke<number>("rename_markup_category", { from, to }),
};

/** Reject-rate warning threshold (as a 0..1 fraction) from settings. */
export function rejectThreshold(): Promise<number> {
  return api
    .getSettings()
    .then((s) => {
      const p = parseFloat(s.reject_rate_warn_pct || "5");
      return isFinite(p) ? p / 100 : 0.05;
    })
    .catch((e) => { logErr("loading reject threshold")(e); return 0.05; });
}

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Catch handler for background/optional loads that must not block the page but
 * must never fail invisibly either: logs what failed (visible in the webview
 * console and support diagnostics) instead of swallowing it.
 */
/** Base64-encode raw bytes, chunked (String.fromCharCode has an argument cap). */
export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function logErr(what: string): (e: unknown) => void {
  return (e: unknown) => console.warn(`[sentrix] ${what} failed:`, errMsg(e));
}
