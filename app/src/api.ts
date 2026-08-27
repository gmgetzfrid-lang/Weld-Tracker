import { invoke } from "@tauri-apps/api/core";
import type {
  ClientReportRow,
  CriteriaRow,
  DailyReport,
  JobReport,
  Lookups,
  MonthlyReport,
  PipeRow,
  Settings,
  SummaryReport,
  User,
  Weld,
  WeldFilter,
  Welder,
  WelderStatRow,
  WelderStatsReport,
} from "./types";

// Thin, typed wrapper over the Tauri command layer.
export const api = {
  // auth / session
  login: (username: string, password: string) =>
    invoke<User>("login", { username, password }),
  logout: () => invoke<void>("logout"),
  currentUser: () => invoke<User | null>("current_user"),
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
};

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
