//! Tauri command layer. Holds the shared `Store` and a server-side session so
//! role checks cannot be bypassed by the front-end.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use weldcore::reports::*;
use weldcore::{
    CriteriaRow, Drawing, Lookup, PipeRow, Store, User, Weld, WeldFilter, Welder,
    WorkOrderSummary,
};

pub struct AppState {
    pub store: Store,
    pub session: Mutex<Option<User>>,
    pub db_path: String,
    pub db_shared: bool,
}

impl AppState {
    pub fn new(store: Store, db_path: String, db_shared: bool) -> Self {
        AppState {
            store,
            session: Mutex::new(None),
            db_path,
            db_shared,
        }
    }
    fn current(&self) -> Option<User> {
        self.session.lock().unwrap().clone()
    }
    /// The signed-in user, regardless of pending password change. Only
    /// change_password / logout / current_user should use this.
    fn session_user(&self) -> Result<User, String> {
        self.current().ok_or_else(|| "not signed in".to_string())
    }
    /// The signed-in user, but only once they have cleared the forced
    /// password change. Every data/report/admin command goes through here so
    /// a default-credential session cannot act until the password is changed.
    fn require_login(&self) -> Result<User, String> {
        let u = self.session_user()?;
        if u.must_change_password {
            return Err("you must change your password before continuing".into());
        }
        Ok(u)
    }
    fn require_editor(&self) -> Result<User, String> {
        let u = self.require_login()?;
        if u.role == "admin" || u.role == "editor" {
            Ok(u)
        } else {
            Err("you do not have permission to make changes".into())
        }
    }
    fn require_admin(&self) -> Result<User, String> {
        let u = self.require_login()?;
        if u.role == "admin" {
            Ok(u)
        } else {
            Err("administrator access required".into())
        }
    }
}

type R<T> = Result<T, String>;
fn e<T>(r: weldcore::Result<T>) -> R<T> {
    r.map_err(|e| e.to_string())
}

// --------------------------- auth / session --------------------------------

#[tauri::command]
pub fn login(state: State<AppState>, username: String, password: String) -> R<User> {
    let user = e(state.store.login(&username, &password))?;
    *state.session.lock().unwrap() = Some(user.clone());
    Ok(user)
}

#[tauri::command]
pub fn logout(state: State<AppState>) -> R<()> {
    *state.session.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn current_user(state: State<AppState>) -> R<Option<User>> {
    Ok(state.current())
}

#[derive(serde::Serialize)]
pub struct DbInfo {
    pub path: String,
    pub shared: bool,
}

/// Where the database lives and whether it is a shared (network) database.
#[tauri::command]
pub fn db_info(state: State<AppState>) -> R<DbInfo> {
    Ok(DbInfo {
        path: state.db_path.clone(),
        shared: state.db_shared,
    })
}

#[tauri::command]
pub fn change_password(
    state: State<AppState>,
    current_password: String,
    new_password: String,
) -> R<()> {
    let user = state.session_user()?;
    e(state
        .store
        .change_password(&user.username, &current_password, &new_password))?;
    // refresh cached session (must_change cleared)
    if let Ok(u) = state.store.get_user(user.id) {
        *state.session.lock().unwrap() = Some(u);
    }
    Ok(())
}

// --------------------------- user administration ---------------------------

#[tauri::command]
pub fn list_users(state: State<AppState>) -> R<Vec<User>> {
    state.require_admin()?;
    e(state.store.list_users())
}

#[tauri::command]
pub fn create_user(
    state: State<AppState>,
    username: String,
    display_name: String,
    role: String,
    password: String,
    must_change: bool,
) -> R<User> {
    let actor = state.require_admin()?;
    e(state.store.create_user(
        &actor.username,
        &actor.role,
        &username,
        &display_name,
        &role,
        &password,
        must_change,
    ))
}

#[tauri::command]
pub fn set_user_active(state: State<AppState>, id: i64, active: bool) -> R<()> {
    let actor = state.require_admin()?;
    e(state
        .store
        .set_user_active(&actor.username, &actor.role, id, active))
}

#[tauri::command]
pub fn set_user_role(state: State<AppState>, id: i64, role: String) -> R<()> {
    let actor = state.require_admin()?;
    e(state
        .store
        .set_user_role(&actor.username, &actor.role, id, &role))
}

#[tauri::command]
pub fn admin_reset_password(state: State<AppState>, id: i64, new_password: String) -> R<()> {
    let actor = state.require_admin()?;
    e(state
        .store
        .admin_reset_password(&actor.username, &actor.role, id, &new_password))
}

// --------------------------- welders ---------------------------------------

#[tauri::command]
pub fn list_welders(
    state: State<AppState>,
    include_inactive: bool,
    sort_by: String,
) -> R<Vec<Welder>> {
    state.require_login()?;
    e(state.store.list_welders(include_inactive, &sort_by))
}

#[tauri::command]
pub fn get_welder(state: State<AppState>, id: i64) -> R<Welder> {
    state.require_login()?;
    e(state.store.get_welder(id))
}

#[tauri::command]
pub fn create_welder(state: State<AppState>, welder: Welder) -> R<i64> {
    state.require_editor()?;
    e(state.store.create_welder(&welder))
}

#[tauri::command]
pub fn update_welder(state: State<AppState>, welder: Welder) -> R<()> {
    state.require_editor()?;
    e(state.store.update_welder(&welder))
}

#[tauri::command]
pub fn delete_welder(state: State<AppState>, id: i64) -> R<()> {
    state.require_editor()?;
    e(state.store.delete_welder(id))
}

// --------------------------- welds -----------------------------------------

#[tauri::command]
pub fn list_welds(state: State<AppState>, filter: WeldFilter) -> R<Vec<Weld>> {
    state.require_login()?;
    e(state.store.list_welds(&filter))
}

#[tauri::command]
pub fn count_welds(state: State<AppState>, filter: WeldFilter) -> R<i64> {
    state.require_login()?;
    e(state.store.count_welds(&filter))
}

#[tauri::command]
pub fn get_weld(state: State<AppState>, id: i64) -> R<Weld> {
    state.require_login()?;
    e(state.store.get_weld(id))
}

#[tauri::command]
pub fn create_weld(state: State<AppState>, weld: Weld) -> R<i64> {
    let actor = state.require_editor()?;
    e(state.store.create_weld(&weld, &actor.username))
}

#[tauri::command]
pub fn update_weld(state: State<AppState>, weld: Weld) -> R<()> {
    let actor = state.require_editor()?;
    e(state.store.update_weld(&weld, &actor.username))
}

#[tauri::command]
pub fn delete_weld(state: State<AppState>, id: i64) -> R<()> {
    let actor = state.require_editor()?;
    e(state.store.delete_weld(id, &actor.username))
}

#[tauri::command]
pub fn create_repair(
    state: State<AppState>,
    weld_id: i64,
    include_tracers: bool,
) -> R<Vec<i64>> {
    let actor = state.require_editor()?;
    e(state
        .store
        .create_repair(weld_id, include_tracers, &actor.username))
}

#[tauri::command]
pub fn distinct_weld_values(state: State<AppState>, field: String) -> R<Vec<String>> {
    state.require_login()?;
    e(state.store.distinct_weld_values(&field))
}

// --------------------------- drawings & bubbles ----------------------------

#[tauri::command]
pub fn list_drawings(state: State<AppState>) -> R<Vec<Drawing>> {
    state.require_login()?;
    e(state.store.list_drawings())
}

#[tauri::command]
pub fn list_work_orders(state: State<AppState>) -> R<Vec<WorkOrderSummary>> {
    state.require_login()?;
    e(state.store.list_work_orders())
}

#[tauri::command]
pub fn list_drawings_for_wo(state: State<AppState>, work_order: String) -> R<Vec<Drawing>> {
    state.require_login()?;
    e(state.store.list_drawings_for_wo(&work_order))
}

#[tauri::command]
pub fn get_drawing(state: State<AppState>, id: i64) -> R<Drawing> {
    state.require_login()?;
    e(state.store.get_drawing(id))
}

#[tauri::command]
pub fn create_drawing(state: State<AppState>, drawing: Drawing) -> R<i64> {
    let actor = state.require_editor()?;
    e(state.store.create_drawing(&drawing, &actor.username))
}

#[tauri::command]
pub fn update_drawing(state: State<AppState>, drawing: Drawing) -> R<()> {
    state.require_editor()?;
    e(state.store.update_drawing(&drawing))
}

#[tauri::command]
pub fn delete_drawing(state: State<AppState>, id: i64) -> R<()> {
    state.require_editor()?;
    e(state.store.delete_drawing(id))
}

#[tauri::command]
pub fn set_drawing_pdf(
    state: State<AppState>,
    id: i64,
    name: String,
    data_base64: String,
    page_count: i64,
) -> R<()> {
    state.require_editor()?;
    e(state
        .store
        .set_drawing_pdf_b64(id, &name, &data_base64, page_count))
}

#[tauri::command]
pub fn get_drawing_pdf(state: State<AppState>, id: i64) -> R<Option<(String, String)>> {
    state.require_login()?;
    e(state.store.get_drawing_pdf(id))
}

#[tauri::command]
pub fn list_drawing_welds(state: State<AppState>, drawing_id: i64) -> R<Vec<Weld>> {
    state.require_login()?;
    e(state.store.list_drawing_welds(drawing_id))
}

#[tauri::command]
pub fn next_weld_number(state: State<AppState>, drawing_id: i64) -> R<i64> {
    state.require_login()?;
    e(state.store.next_weld_number(drawing_id))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn add_bubble_weld(
    state: State<AppState>,
    drawing_id: i64,
    stamp: Option<String>,
    weld_number: String,
    page: i64,
    bubble_x: f64,
    bubble_y: f64,
    joint_x: f64,
    joint_y: f64,
) -> R<Weld> {
    let actor = state.require_editor()?;
    e(state.store.add_bubble_weld(
        drawing_id,
        stamp,
        &weld_number,
        page,
        bubble_x,
        bubble_y,
        joint_x,
        joint_y,
        &actor.username,
    ))
}

#[tauri::command]
pub fn set_weld_bubble(
    state: State<AppState>,
    weld_id: i64,
    page: i64,
    bubble_x: f64,
    bubble_y: f64,
    joint_x: f64,
    joint_y: f64,
) -> R<()> {
    state.require_editor()?;
    e(state
        .store
        .set_weld_bubble(weld_id, page, bubble_x, bubble_y, joint_x, joint_y))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn apply_weld_attributes(
    state: State<AppState>,
    ids: Vec<i64>,
    size: Option<f64>,
    joint_type: Option<String>,
    groove_type: Option<String>,
    process: Option<String>,
    schedule: Option<String>,
    material: Option<String>,
) -> R<()> {
    let actor = state.require_editor()?;
    e(state.store.apply_weld_attributes(
        &ids, size, joint_type, groove_type, process, schedule, material, &actor.username,
    ))
}

// --------------------------- reference data --------------------------------

#[tauri::command]
pub fn list_pipe(state: State<AppState>) -> R<Vec<PipeRow>> {
    state.require_login()?;
    e(state.store.list_pipe())
}

#[tauri::command]
pub fn pipe_sizes(state: State<AppState>) -> R<Vec<f64>> {
    state.require_login()?;
    e(state.store.pipe_sizes())
}

#[tauri::command]
pub fn lookup_thickness(state: State<AppState>, nps: f64, schedule: String) -> R<Option<f64>> {
    state.require_login()?;
    e(state.store.lookup_thickness(nps, &schedule))
}

#[tauri::command]
pub fn lookups_grouped(state: State<AppState>) -> R<HashMap<String, Vec<String>>> {
    state.require_login()?;
    e(state.store.lookups_grouped())
}

#[tauri::command]
pub fn list_lookups(state: State<AppState>) -> R<Vec<Lookup>> {
    state.require_login()?;
    e(state.store.list_lookups())
}

#[tauri::command]
pub fn add_lookup(state: State<AppState>, kind: String, value: String) -> R<()> {
    state.require_editor()?;
    e(state.store.add_lookup(&kind, &value))
}

#[tauri::command]
pub fn remove_lookup(state: State<AppState>, kind: String, value: String) -> R<()> {
    state.require_editor()?;
    e(state.store.remove_lookup(&kind, &value))
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> R<HashMap<String, String>> {
    // settings drive branding; readable pre-login for the splash screen
    e(state.store.get_settings())
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> R<()> {
    state.require_admin()?;
    e(state.store.set_setting(&key, &value))
}

#[tauri::command]
pub fn list_criteria(state: State<AppState>) -> R<Vec<CriteriaRow>> {
    state.require_login()?;
    e(state.store.list_criteria())
}

// --------------------------- reports ---------------------------------------

#[tauri::command]
pub fn report_summary(state: State<AppState>) -> R<SummaryReport> {
    state.require_login()?;
    e(state.store.report_summary())
}

#[tauri::command]
pub fn report_job(state: State<AppState>, work_order: String) -> R<JobReport> {
    state.require_login()?;
    e(state.store.report_job(&work_order))
}

#[tauri::command]
pub fn report_daily(state: State<AppState>, date: String) -> R<DailyReport> {
    state.require_login()?;
    e(state.store.report_daily(&date))
}

#[tauri::command]
pub fn report_monthly(state: State<AppState>, year: i32) -> R<MonthlyReport> {
    state.require_login()?;
    e(state.store.report_monthly(year))
}

#[tauri::command]
pub fn report_welder_stats(state: State<AppState>, level: String) -> R<WelderStatsReport> {
    state.require_login()?;
    e(state.store.report_welder_stats(&level))
}

#[tauri::command]
pub fn report_welder(state: State<AppState>, stamp: String) -> R<WelderStatRow> {
    state.require_login()?;
    e(state.store.report_welder(&stamp))
}

#[tauri::command]
pub fn report_client(state: State<AppState>, month: u32, year: i32) -> R<Vec<ClientReportRow>> {
    state.require_login()?;
    e(state.store.report_client(month, year))
}

#[tauri::command]
pub fn report_qm(state: State<AppState>) -> R<Vec<WelderStatRow>> {
    state.require_login()?;
    e(state.store.report_qm())
}
