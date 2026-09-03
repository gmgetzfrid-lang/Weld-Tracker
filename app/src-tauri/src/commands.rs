//! Tauri command layer. Holds the shared `Store` and a server-side session so
//! role checks cannot be bypassed by the front-end.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use weldcore::reports::*;
use weldcore::{
    AuditEntry, CriteriaRow, DocumentPackage, Drawing, DrawingRevision, Lookup, PipeRow,
    QualityFile, Store, User, Weld, WeldFilter, Welder, WelderCert, WelderContinuity,
    WorkOrderSummary,
};

/// The database opens on a background thread (integrity check, migrations,
/// pre-migration backup and hash backfill can take seconds — longer when an
/// antivirus scans every write or the file lives on a network share). The
/// window must never freeze waiting on it, and a failed open must surface on
/// screen instead of killing the process.
pub enum BootState {
    Starting,
    Ready(std::sync::Arc<Store>),
    Failed(String),
}

pub struct AppState {
    pub boot: std::sync::RwLock<BootState>,
    pub session: Mutex<Option<User>>,
    pub db_path: String,
    pub db_shared: bool,
    pub log_dir: String,
}

impl AppState {
    pub fn new(db_path: String, db_shared: bool, log_dir: String) -> Self {
        AppState {
            boot: std::sync::RwLock::new(BootState::Starting),
            session: Mutex::new(None),
            db_path,
            db_shared,
            log_dir,
        }
    }
    pub fn set_ready(&self, store: Store) {
        *self.boot.write().unwrap() = BootState::Ready(std::sync::Arc::new(store));
    }
    pub fn set_failed(&self, err: String) {
        *self.boot.write().unwrap() = BootState::Failed(err);
    }
    /// The store, once the background open finished. Commands issued during
    /// the brief startup window get a clean retryable error (the frontend
    /// holds a splash screen until boot_status says ready).
    fn store(&self) -> Result<std::sync::Arc<Store>, String> {
        match &*self.boot.read().unwrap() {
            BootState::Ready(s) => Ok(s.clone()),
            BootState::Starting => Err("the database is still starting".into()),
            BootState::Failed(e) => Err(format!("database failed to open: {e}")),
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
    ///
    /// The user row is re-read from the database on every call so a disable
    /// or demotion done from another machine (the shared-drive deployment)
    /// takes effect on the next action, not only after that session restarts.
    /// One indexed single-row SELECT — negligible next to the command's work.
    fn require_login(&self) -> Result<User, String> {
        let cached = self.session_user()?;
        let u = match self.store()?.get_user(cached.id) {
            Ok(fresh) => {
                *self.session.lock().unwrap() = Some(fresh.clone());
                fresh
            }
            // The account row is gone — the session no longer represents anyone.
            Err(weldcore::Error::NotFound) => {
                *self.session.lock().unwrap() = None;
                return Err("your account no longer exists — signed out".into());
            }
            // Transient DB trouble: fall back to the cached user rather than
            // locking out a live session over a momentary read failure.
            Err(_) => cached,
        };
        if !u.active {
            return Err("your account has been disabled".into());
        }
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
    let user = e(state.store()?.login(&username, &password))?;
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

/// Per-welder output over time (day/week/month/year buckets) for the
/// performance chart.
#[tauri::command]
pub fn welder_output_series(
    state: State<AppState>,
    from: Option<String>,
    to: Option<String>,
    bucket: String,
) -> R<Vec<OutputSeries>> {
    state.require_login()?;
    e(state
        .store()?
        .welder_output_series(from.as_deref(), to.as_deref(), &bucket))
}

/// Startup gate for the frontend splash: "starting" while the background
/// open runs, "ready" once commands can serve, "failed: …" if the database
/// could not be opened (shown on screen instead of a dead process).
#[tauri::command]
pub fn boot_status(state: State<AppState>) -> R<String> {
    Ok(match &*state.boot.read().unwrap() {
        BootState::Starting => "starting".into(),
        BootState::Ready(_) => "ready".into(),
        BootState::Failed(e) => format!("failed: {e}"),
    })
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
        .store()?
        .change_password(&user.username, &current_password, &new_password))?;
    // refresh cached session (must_change cleared)
    if let Ok(u) = state.store()?.get_user(user.id) {
        *state.session.lock().unwrap() = Some(u);
    }
    Ok(())
}

// --------------------------- user administration ---------------------------

#[tauri::command]
pub fn list_users(state: State<AppState>) -> R<Vec<User>> {
    state.require_admin()?;
    e(state.store()?.list_users())
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
    e(state.store()?.create_user(
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
        .store()?
        .set_user_active(&actor.username, &actor.role, id, active))
}

#[tauri::command]
pub fn set_user_role(state: State<AppState>, id: i64, role: String) -> R<()> {
    let actor = state.require_admin()?;
    e(state
        .store()?
        .set_user_role(&actor.username, &actor.role, id, &role))
}

#[tauri::command]
pub fn admin_reset_password(state: State<AppState>, id: i64, new_password: String) -> R<()> {
    let actor = state.require_admin()?;
    e(state
        .store()?
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
    e(state.store()?.list_welders(include_inactive, &sort_by))
}

#[tauri::command]
pub fn get_welder(state: State<AppState>, id: i64) -> R<Welder> {
    state.require_login()?;
    e(state.store()?.get_welder(id))
}

#[tauri::command]
pub fn create_welder(state: State<AppState>, welder: Welder) -> R<i64> {
    state.require_editor()?;
    e(state.store()?.create_welder(&welder))
}

#[tauri::command]
pub fn update_welder(state: State<AppState>, welder: Welder) -> R<()> {
    state.require_editor()?;
    e(state.store()?.update_welder(&welder))
}

#[tauri::command]
pub fn delete_welder(state: State<AppState>, id: i64) -> R<()> {
    state.require_editor()?;
    e(state.store()?.delete_welder(id))
}

// --------------------------- welder certs / continuity ---------------------

#[tauri::command]
pub fn list_welder_certs(state: State<AppState>, welder_id: i64) -> R<Vec<WelderCert>> {
    state.require_login()?;
    e(state.store()?.list_welder_certs(welder_id))
}

#[tauri::command]
pub fn welder_cert_aliases(state: State<AppState>, stamp: String) -> R<Vec<String>> {
    state.require_login()?;
    e(state.store()?.welder_cert_aliases(&stamp))
}

#[tauri::command]
pub fn create_welder_cert(state: State<AppState>, cert: WelderCert) -> R<i64> {
    let actor = state.require_editor()?;
    e(state.store()?.create_welder_cert(&cert, &actor.username))
}

#[tauri::command]
pub fn update_welder_cert(state: State<AppState>, cert: WelderCert) -> R<()> {
    state.require_editor()?;
    e(state.store()?.update_welder_cert(&cert))
}

#[tauri::command]
pub fn delete_welder_cert(state: State<AppState>, id: i64) -> R<()> {
    state.require_editor()?;
    e(state.store()?.delete_welder_cert(id))
}

#[tauri::command]
pub fn set_welder_cert_file(
    state: State<AppState>,
    id: i64,
    name: String,
    data_base64: String,
) -> R<()> {
    state.require_editor()?;
    e(state.store()?.set_welder_cert_file(id, &name, &data_base64))
}

#[tauri::command]
pub fn get_welder_cert_file(state: State<AppState>, id: i64) -> R<Option<(String, String)>> {
    state.require_login()?;
    e(state.store()?.get_welder_cert_file(id))
}

#[tauri::command]
pub fn welder_continuity(state: State<AppState>, welder_id: i64) -> R<WelderContinuity> {
    state.require_login()?;
    e(state.store()?.welder_continuity(welder_id))
}

// --------------------------- welds -----------------------------------------

#[tauri::command]
pub fn list_welds(state: State<AppState>, filter: WeldFilter) -> R<Vec<Weld>> {
    state.require_login()?;
    e(state.store()?.list_welds(&filter))
}

#[tauri::command]
pub fn count_welds(state: State<AppState>, filter: WeldFilter) -> R<i64> {
    state.require_login()?;
    e(state.store()?.count_welds(&filter))
}

#[tauri::command]
pub fn get_weld(state: State<AppState>, id: i64) -> R<Weld> {
    state.require_login()?;
    e(state.store()?.get_weld(id))
}

#[tauri::command]
pub fn create_weld(state: State<AppState>, weld: Weld) -> R<i64> {
    let actor = state.require_editor()?;
    e(state.store()?.create_weld(&weld, &actor.username))
}

#[tauri::command]
pub fn update_weld(state: State<AppState>, weld: Weld) -> R<Weld> {
    let actor = state.require_editor()?;
    e(state.store()?.update_weld(&weld, &actor.username))
}

/// Void (soft-delete) a weld — the normal "delete" for a QC record. The row is
/// retained and excluded from every count; nothing is destroyed.
#[tauri::command]
pub fn void_weld(state: State<AppState>, id: i64, reason: String) -> R<()> {
    let actor = state.require_editor()?;
    e(state
        .store()?
        .void_weld(id, &actor.username, &actor.role, &reason))
}

/// Restore a voided weld back into the live log.
#[tauri::command]
pub fn restore_weld(state: State<AppState>, id: i64) -> R<()> {
    let actor = state.require_editor()?;
    e(state.store()?.restore_weld(id, &actor.username, &actor.role))
}

/// Permanently delete a weld (hard purge). Prefer `void_weld`, which retains the
/// record; this is used for removing a mis-placed bubble during map creation and
/// as the admin "purge" escape hatch. The store enforces owner-or-admin.
#[tauri::command]
pub fn delete_weld(state: State<AppState>, id: i64) -> R<()> {
    let actor = state.require_editor()?;
    e(state.store()?.delete_weld(id, &actor.username, &actor.role))
}

/// The recent Activity log (audit trail), newest first. Any signed-in user may
/// read it; `entity` optionally narrows to one kind (e.g. "weld").
#[tauri::command]
pub fn recent_activity(
    state: State<AppState>,
    entity: Option<String>,
    limit: Option<i64>,
) -> R<Vec<AuditEntry>> {
    state.require_login()?;
    e(state
        .store()?
        .recent_activity(entity.as_deref(), limit.unwrap_or(100)))
}

/// Save an exported report (PDF/CSV built in the frontend) into the per-user
/// "SENTRIX Reports" folder under Documents, then hand it to the OS. Browser
/// download links are inert inside the WebView, so every export flows through
/// here. `mode`: "save" writes only; "open" also launches the file with its
/// default app (the PDF viewer's Print serves the print path); "reveal" shows
/// it selected in the file manager. Returns the full path written.
#[tauri::command]
pub fn save_export(app: tauri::AppHandle, state: State<AppState>, name: String, b64: String, mode: String) -> R<String> {
    use base64::Engine;
    use tauri::Manager;
    state.require_login()?;
    // The caller supplies only a file NAME — any path components are dropped
    // so an export can never write outside the reports folder.
    let fname = std::path::Path::new(&name)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.trim().is_empty() && s != "." && s != "..")
        .ok_or_else(|| "invalid file name".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| format!("bad file data: {e}"))?;
    let dir = app
        .path()
        .document_dir()
        .map(|d| d.join("SENTRIX Reports"))
        .or_else(|_| app.path().app_data_dir().map(|d| d.join("exports")))
        .map_err(|e| format!("no writable export folder: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let mut path = dir.join(&fname);
    if std::fs::write(&path, &bytes).is_err() {
        // Likely locked (the previous export still open in a viewer) — write a
        // timestamped sibling instead of failing.
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let stem = std::path::Path::new(&fname)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "export".into());
        let ext = std::path::Path::new(&fname)
            .extension()
            .map(|s| format!(".{}", s.to_string_lossy()))
            .unwrap_or_default();
        path = dir.join(format!("{stem}-{stamp}{ext}"));
        std::fs::write(&path, &bytes).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    }
    let target = path.to_string_lossy().to_string();
    match mode.as_str() {
        "open" => {
            #[cfg(target_os = "windows")]
            let spawn = std::process::Command::new("explorer").arg(&target).spawn();
            #[cfg(target_os = "macos")]
            let spawn = std::process::Command::new("open").arg(&target).spawn();
            #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
            let spawn = std::process::Command::new("xdg-open").arg(&target).spawn();
            spawn.map_err(|e| format!("saved to {target}, but cannot open it: {e}"))?;
        }
        "reveal" => {
            #[cfg(target_os = "windows")]
            let spawn = std::process::Command::new("explorer").arg(format!("/select,{target}")).spawn();
            #[cfg(target_os = "macos")]
            let spawn = std::process::Command::new("open").args(["-R", &target]).spawn();
            #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
            let spawn = std::process::Command::new("xdg-open")
                .arg(dir.to_string_lossy().to_string())
                .spawn();
            spawn.map_err(|e| format!("saved to {target}, but cannot show it: {e}"))?;
        }
        _ => {}
    }
    Ok(target)
}

/// Open a welder's stored WPQ document with the OS default app. The file
/// bytes stay on the Rust side (one DB read, one disk write, launch) —
/// nothing shuttles through the UI bridge, so big scans open fast.
#[tauri::command]
pub fn open_welder_cert(app: tauri::AppHandle, state: State<AppState>, id: i64) -> R<String> {
    state.require_login()?;
    let (name, b64) = e(state.store()?.get_welder_cert_file(id))?
        .ok_or_else(|| "no document stored on this cert".to_string())?;
    let fname = if name.trim().is_empty() { format!("cert-{id}.pdf") } else { name };
    save_export(app, state, fname, b64, "open".into())
}

/// Open the per-user support-log folder in the OS file manager. The path is
/// fixed by the app (never user input), so this cannot be steered elsewhere.
#[tauri::command]
pub fn open_log_folder(state: State<AppState>) -> R<String> {
    state.require_login()?;
    let dir = state.log_dir.clone();
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create log folder: {e}"))?;
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd)
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("cannot open log folder: {e}"))?;
    Ok(dir)
}

/// Write a timestamped backup of the database beside the live file (in a
/// `backups` folder) and return the path written. Admin only.
#[tauri::command]
pub fn backup_database(state: State<AppState>) -> R<String> {
    state.require_admin()?;
    let db = std::path::Path::new(&state.db_path);
    let dir = db
        .parent()
        .map(|p| p.join("backups"))
        .unwrap_or_else(|| std::path::PathBuf::from("backups"));
    let dest = e(state.store()?.backup_now(&dir))?;
    state.store()?.audit(
        &state.session.lock().unwrap().as_ref().map(|u| u.username.clone()).unwrap_or_default(),
        "backup",
        "database",
        "",
        &dest.to_string_lossy(),
    );
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_repair(
    state: State<AppState>,
    weld_id: i64,
    include_tracers: bool,
) -> R<Vec<i64>> {
    let actor = state.require_editor()?;
    e(state
        .store()?
        .create_repair(weld_id, include_tracers, &actor.username))
}

#[tauri::command]
pub fn distinct_weld_values(state: State<AppState>, field: String) -> R<Vec<String>> {
    state.require_login()?;
    e(state.store()?.distinct_weld_values(&field))
}

/// One weld's disposition inside a batch NDE recording.
#[derive(serde::Deserialize)]
pub struct NdeEntry {
    pub id: i64,
    pub result: String,
}

/// Record one NDE report's results across many welds at once (shared method,
/// date and report number; per-weld Accepted/Rejected). Editor and up.
#[tauri::command]
pub fn record_nde_batch(
    state: State<AppState>,
    entries: Vec<NdeEntry>,
    types: String,
    date: String,
    report_no: Option<String>,
) -> R<usize> {
    let actor = state.require_editor()?;
    let pairs: Vec<(i64, String)> = entries.into_iter().map(|e| (e.id, e.result)).collect();
    e(state.store()?.record_nde_batch(
        &pairs,
        &types,
        &date,
        report_no.as_deref(),
        &actor.username,
    ))
}

/// Global (Ctrl+K) search across work orders, welders, drawings, and welds.
#[tauri::command]
pub fn global_search(state: State<AppState>, query: String) -> R<Vec<weldcore::SearchHit>> {
    state.require_login()?;
    e(state.store()?.global_search(&query, 6))
}

/// Run the validation engine across the live weld population and return the
/// exceptions roll-up (errors / warnings / advisories + the offending welds).
/// `workOrder` optionally scopes it to one work order.
#[tauri::command]
pub fn weld_exceptions(
    state: State<AppState>,
    work_order: Option<String>,
) -> R<weldcore::validate::ExceptionsSummary> {
    state.require_login()?;
    e(state.store()?.weld_exceptions(work_order.as_deref()))
}

/// Compute the EP 5-5-1 Table 4 required NDE coverage for a (partial) weld —
/// the live readout the entry form shows while the drivers are being filled in.
/// Uses the same engine the backend applies on save, so the form can never show
/// a different requirement than the record is judged against.
#[tauri::command]
pub fn compute_nde(state: State<AppState>, weld: Weld) -> R<weldcore::nde::NdeRequirement> {
    state.require_login()?;
    Ok(weldcore::welds::requirement_for_weld(&weld))
}

// --------------------------- drawings & bubbles ----------------------------

#[tauri::command]
pub fn list_drawings(state: State<AppState>) -> R<Vec<Drawing>> {
    state.require_login()?;
    e(state.store()?.list_drawings())
}

#[tauri::command]
pub fn list_work_orders(state: State<AppState>) -> R<Vec<WorkOrderSummary>> {
    state.require_login()?;
    e(state.store()?.list_work_orders())
}

#[tauri::command]
pub fn list_drawings_for_wo(state: State<AppState>, work_order: String) -> R<Vec<Drawing>> {
    state.require_login()?;
    e(state.store()?.list_drawings_for_wo(&work_order))
}

#[tauri::command]
pub fn get_drawing(state: State<AppState>, id: i64) -> R<Drawing> {
    state.require_login()?;
    e(state.store()?.get_drawing(id))
}

#[tauri::command]
pub fn create_drawing(state: State<AppState>, drawing: Drawing) -> R<i64> {
    let actor = state.require_editor()?;
    e(state.store()?.create_drawing(&drawing, &actor.username))
}

#[tauri::command]
pub fn update_drawing(state: State<AppState>, drawing: Drawing) -> R<()> {
    state.require_editor()?;
    e(state.store()?.update_drawing(&drawing))
}

#[tauri::command]
pub fn delete_drawing(state: State<AppState>, id: i64) -> R<()> {
    let actor = state.require_editor()?;
    e(state.store()?.delete_drawing(id, &actor.username, &actor.role))
}

#[tauri::command]
pub fn delete_work_order(state: State<AppState>, work_order: String, reason: String) -> R<(i64, i64)> {
    // Any editor may attempt; the store enforces owner-or-admin. The typed
    // reason from the confirm dialog lands in the audit trail.
    let actor = state.require_editor()?;
    e(state
        .store()?
        .delete_work_order(&work_order, &actor.username, &actor.role, &reason))
}

#[tauri::command]
pub fn work_order_owner(state: State<AppState>, work_order: String) -> R<Option<String>> {
    state.require_login()?;
    e(state.store()?.work_order_owner(&work_order))
}

#[tauri::command]
pub fn set_drawing_pdf(
    state: State<AppState>,
    id: i64,
    name: String,
    data_base64: String,
    page_count: i64,
) -> R<()> {
    let actor = state.require_editor()?;
    e(state
        .store()?
        .set_drawing_pdf_b64(id, &name, &data_base64, page_count, &actor.username))
}

#[tauri::command]
pub fn get_drawing_pdf(
    state: State<AppState>,
    id: i64,
) -> R<Option<(String, String, i64, i64)>> {
    state.require_login()?;
    e(state.store()?.get_drawing_pdf(id))
}

// ---- Document packages & revision control ----

#[tauri::command]
pub fn create_package(
    state: State<AppState>,
    work_order: Option<String>,
    name: String,
    data_base64: String,
    page_count: i64,
) -> R<i64> {
    let actor = state.require_editor()?;
    e(state
        .store()?
        .create_package(work_order.as_deref(), &name, &data_base64, page_count, &actor.username))
}

#[tauri::command]
pub fn list_packages(state: State<AppState>, work_order: String) -> R<Vec<DocumentPackage>> {
    state.require_login()?;
    e(state.store()?.list_packages(&work_order))
}

#[tauri::command]
pub fn get_package_pdf(state: State<AppState>, id: i64) -> R<Option<(String, String)>> {
    state.require_login()?;
    e(state.store()?.get_package_pdf(id))
}

// ----------------------- work-order quality package ------------------------

#[tauri::command]
pub fn add_wo_file(
    state: State<AppState>,
    work_order: String,
    category: Option<String>,
    name: String,
    mime: Option<String>,
    data_base64: String,
    note: Option<String>,
) -> R<i64> {
    let actor = state.require_editor()?;
    e(state.store()?.add_wo_file(
        &work_order,
        category.as_deref(),
        &name,
        mime.as_deref(),
        &data_base64,
        note.as_deref(),
        &actor.username,
    ))
}

#[tauri::command]
pub fn list_wo_files(state: State<AppState>, work_order: String) -> R<Vec<QualityFile>> {
    state.require_login()?;
    e(state.store()?.list_wo_files(&work_order))
}

#[tauri::command]
pub fn get_wo_file(state: State<AppState>, id: i64) -> R<Option<(String, String, String)>> {
    state.require_login()?;
    e(state.store()?.get_wo_file(id))
}

#[tauri::command]
pub fn delete_wo_file(state: State<AppState>, id: i64) -> R<()> {
    let actor = state.require_editor()?;
    e(state
        .store()?
        .delete_wo_file(id, &actor.username, &actor.role))
}

#[tauri::command]
pub fn get_revision_pdf(
    state: State<AppState>,
    rev_id: i64,
) -> R<Option<(String, String, i64, i64)>> {
    state.require_login()?;
    e(state.store()?.get_revision_pdf(rev_id))
}

#[tauri::command]
pub fn set_effective_source(
    state: State<AppState>,
    drawing_id: i64,
    package_id: i64,
    page_from: i64,
    page_to: i64,
) -> R<()> {
    state.require_editor()?;
    e(state
        .store()?
        .set_effective_source(drawing_id, package_id, page_from, page_to))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn revise_drawing(
    state: State<AppState>,
    drawing_id: i64,
    new_rev: String,
    reason: Option<String>,
    package_id: Option<i64>,
    page_from: Option<i64>,
    page_to: Option<i64>,
) -> R<i64> {
    let actor = state.require_editor()?;
    e(state.store()?.revise_drawing(
        drawing_id,
        &new_rev,
        reason.as_deref(),
        package_id,
        page_from,
        page_to,
        &actor.username,
    ))
}

#[tauri::command]
pub fn list_drawing_revisions(
    state: State<AppState>,
    drawing_id: i64,
) -> R<Vec<DrawingRevision>> {
    state.require_login()?;
    e(state.store()?.list_drawing_revisions(drawing_id))
}

#[tauri::command]
pub fn list_drawing_welds(state: State<AppState>, drawing_id: i64) -> R<Vec<Weld>> {
    state.require_login()?;
    e(state.store()?.list_drawing_welds(drawing_id))
}

#[tauri::command]
pub fn next_weld_number(state: State<AppState>, drawing_id: i64) -> R<i64> {
    state.require_login()?;
    e(state.store()?.next_weld_number(drawing_id))
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
    e(state.store()?.add_bubble_weld(
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
        .store()?
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
    e(state.store()?.apply_weld_attributes(
        &ids, size, joint_type, groove_type, process, schedule, material, &actor.username,
    ))
}

// --------------------------- reference data --------------------------------

#[tauri::command]
pub fn list_pipe(state: State<AppState>) -> R<Vec<PipeRow>> {
    state.require_login()?;
    e(state.store()?.list_pipe())
}

#[tauri::command]
pub fn pipe_sizes(state: State<AppState>) -> R<Vec<f64>> {
    state.require_login()?;
    e(state.store()?.pipe_sizes())
}

#[tauri::command]
pub fn lookup_thickness(state: State<AppState>, nps: f64, schedule: String) -> R<Option<f64>> {
    state.require_login()?;
    e(state.store()?.lookup_thickness(nps, &schedule))
}

#[tauri::command]
pub fn lookups_grouped(state: State<AppState>) -> R<HashMap<String, Vec<String>>> {
    state.require_login()?;
    e(state.store()?.lookups_grouped())
}

#[tauri::command]
pub fn list_lookups(state: State<AppState>) -> R<Vec<Lookup>> {
    state.require_login()?;
    e(state.store()?.list_lookups())
}

#[tauri::command]
pub fn add_lookup(state: State<AppState>, kind: String, value: String) -> R<()> {
    state.require_editor()?;
    e(state.store()?.add_lookup(&kind, &value))
}

#[tauri::command]
pub fn remove_lookup(state: State<AppState>, kind: String, value: String) -> R<()> {
    state.require_editor()?;
    e(state.store()?.remove_lookup(&kind, &value))
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> R<HashMap<String, String>> {
    // settings drive branding; readable pre-login for the splash screen
    e(state.store()?.get_settings())
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> R<()> {
    state.require_admin()?;
    e(state.store()?.set_setting(&key, &value))
}

#[tauri::command]
pub fn list_criteria(state: State<AppState>) -> R<Vec<CriteriaRow>> {
    state.require_login()?;
    e(state.store()?.list_criteria())
}

// --------------------------- reports ---------------------------------------

#[tauri::command]
pub fn report_summary(state: State<AppState>) -> R<SummaryReport> {
    state.require_login()?;
    e(state.store()?.report_summary())
}

#[tauri::command]
pub fn report_job(state: State<AppState>, work_order: String) -> R<JobReport> {
    state.require_login()?;
    e(state.store()?.report_job(&work_order))
}

#[tauri::command]
pub fn report_daily(state: State<AppState>, date: String) -> R<DailyReport> {
    state.require_login()?;
    e(state.store()?.report_daily(&date))
}

#[tauri::command]
pub fn report_monthly(state: State<AppState>, year: i32) -> R<MonthlyReport> {
    state.require_login()?;
    e(state.store()?.report_monthly(year))
}

#[tauri::command]
pub fn report_welder_stats(state: State<AppState>, level: String) -> R<WelderStatsReport> {
    state.require_login()?;
    e(state.store()?.report_welder_stats(&level))
}

#[tauri::command]
pub fn report_welder(state: State<AppState>, stamp: String) -> R<WelderStatRow> {
    state.require_login()?;
    e(state.store()?.report_welder(&stamp))
}

#[tauri::command]
pub fn report_client(state: State<AppState>, month: u32, year: i32) -> R<Vec<ClientReportRow>> {
    state.require_login()?;
    e(state.store()?.report_client(month, year))
}

#[tauri::command]
pub fn report_qm(state: State<AppState>) -> R<Vec<WelderStatRow>> {
    state.require_login()?;
    e(state.store()?.report_qm())
}

#[tauri::command]
pub fn report_nde_compliance(state: State<AppState>) -> R<NdeComplianceReport> {
    state.require_login()?;
    e(state.store()?.report_nde_compliance())
}

#[tauri::command]
pub fn report_performance(
    state: State<AppState>,
    from: Option<String>,
    to: Option<String>,
    lot_id: Option<i64>,
) -> R<PerformanceReport> {
    state.require_login()?;
    match lot_id {
        Some(id) => e(state
            .store()?
            .report_performance_scoped(weldcore::reports::ReportScope::Lot(id))),
        None => e(state.store()?.report_performance(from, to)),
    }
}

// --------------------------- NDE lots ---------------------------------------
// ASME B31.3 lots: the bounded population each welder's random-examination
// percentage (and progressive sampling) is judged against. See weldcore::lots.

use weldcore::lots::{
    AttentionItem, LotCard, LotConfig, LotWoChoice, MaintainOutcome, NdeLot, SuggestedExam,
    WoLotSummary,
};

#[tauri::command]
pub fn lot_config(state: State<AppState>) -> R<LotConfig> {
    state.require_login()?;
    e(state.store()?.lot_config())
}

#[tauri::command]
pub fn set_lot_config(state: State<AppState>, config: LotConfig) -> R<LotConfig> {
    let actor = state.require_admin()?;
    e(state.store()?.set_lot_config(&config, &actor.username))
}

/// First-run setup: save config, open the first receiving lot, sweep history
/// ("all" | "none" | "from:YYYY-MM-DD"). Returns [lot, welds swept].
#[tauri::command]
pub fn setup_lots(state: State<AppState>, config: LotConfig, history: String) -> R<(NdeLot, i64)> {
    let actor = state.require_admin()?;
    e(state.store()?.setup_lots(&config, &history, &actor.username))
}

#[tauri::command]
pub fn list_lots(state: State<AppState>) -> R<Vec<NdeLot>> {
    state.require_login()?;
    e(state.store()?.list_lots())
}

#[tauri::command]
pub fn get_lot_card(state: State<AppState>, id: i64) -> R<LotCard> {
    state.require_login()?;
    e(state.store()?.lot_card(id))
}

#[tauri::command]
pub fn create_lot(
    state: State<AppState>,
    label: Option<String>,
    make_default: bool,
    target_months: Option<i64>,
) -> R<NdeLot> {
    let actor = state.require_editor()?;
    e(state.store()?.create_lot(&actor.username, label, make_default, target_months))
}

/// Turn the receiving lot over. Returns [old lot (now Closing) or null, new lot].
#[tauri::command]
pub fn turn_over_lot(state: State<AppState>, reason: Option<String>) -> R<(Option<NdeLot>, NdeLot)> {
    let actor = state.require_editor()?;
    e(state.store()?.turn_over(&actor.username, reason.as_deref()))
}

#[tauri::command]
pub fn stop_lot_intake(state: State<AppState>, id: i64) -> R<NdeLot> {
    let actor = state.require_editor()?;
    e(state.store()?.stop_intake(id, &actor.username))
}

#[tauri::command]
pub fn close_lot(state: State<AppState>, id: i64, reason: Option<String>, force: bool) -> R<NdeLot> {
    let actor = state.require_editor()?;
    e(state.store()?.close_lot(id, &actor.username, reason.as_deref(), force))
}

#[tauri::command]
pub fn reopen_lot(state: State<AppState>, id: i64, reason: String) -> R<NdeLot> {
    let actor = state.require_admin()?;
    e(state.store()?.reopen_lot(id, &actor.username, &reason))
}

#[tauri::command]
pub fn update_lot_notes(
    state: State<AppState>,
    id: i64,
    label: Option<String>,
    notes: Option<String>,
    target_months: Option<i64>,
) -> R<NdeLot> {
    let actor = state.require_editor()?;
    e(state.store()?.update_lot_notes(
        id,
        label.as_deref(),
        notes.as_deref(),
        target_months,
        &actor.username,
    ))
}

#[tauri::command]
pub fn pin_work_order(state: State<AppState>, work_order: String, lot_id: i64) -> R<i64> {
    let actor = state.require_editor()?;
    e(state.store()?.pin_work_order(&work_order, lot_id, &actor.username))
}

#[tauri::command]
pub fn unpin_work_order(state: State<AppState>, work_order: String) -> R<()> {
    let actor = state.require_editor()?;
    e(state.store()?.unpin_work_order(&work_order, &actor.username))
}

#[tauri::command]
pub fn move_work_order_to_lot(state: State<AppState>, work_order: String, lot_id: i64) -> R<i64> {
    let actor = state.require_editor()?;
    e(state.store()?.move_work_order(&work_order, lot_id, &actor.username))
}

#[tauri::command]
pub fn set_weld_lot(state: State<AppState>, weld_id: i64, lot_id: Option<i64>) -> R<()> {
    let actor = state.require_editor()?;
    e(state.store()?.set_weld_lot(weld_id, lot_id, &actor.username))
}

#[tauri::command]
pub fn lot_attention(state: State<AppState>) -> R<Vec<AttentionItem>> {
    state.require_login()?;
    e(state.store()?.lot_attention())
}

/// The autonomous pass (run after every login): ensure a receiving lot, roll
/// over when due and configured, close complete lots, report a due prompt.
#[tauri::command]
pub fn lots_auto_maintain(state: State<AppState>) -> R<MaintainOutcome> {
    state.require_login()?;
    e(state.store()?.lots_auto_maintain())
}

#[tauri::command]
pub fn suggest_examinations(
    state: State<AppState>,
    lot_id: i64,
    stamp: Option<String>,
) -> R<Vec<SuggestedExam>> {
    state.require_login()?;
    e(state.store()?.suggest_examinations(lot_id, stamp.as_deref()))
}

#[tauri::command]
pub fn snooze_turnover(state: State<AppState>, days: i64) -> R<LotConfig> {
    let actor = state.require_editor()?;
    e(state.store()?.snooze_turnover(days, &actor.username))
}

#[tauri::command]
pub fn wo_lot_summary(state: State<AppState>, work_order: String) -> R<WoLotSummary> {
    state.require_login()?;
    e(state.store()?.wo_lot_summary(&work_order))
}

#[tauri::command]
pub fn lot_work_order_choices(state: State<AppState>) -> R<Vec<LotWoChoice>> {
    state.require_login()?;
    e(state.store()?.lot_work_order_choices())
}


/// Work orders with welds still missing attributes (the "don't walk away" list).
#[tauri::command]
pub fn incomplete_work_orders(state: State<AppState>) -> R<Vec<weldcore::welds::IncompleteWo>> {
    state.require_login()?;
    e(state.store()?.incomplete_work_orders())
}

// --------------------------- Markups & Tool Chest ---------------------------
// Redlines on a controlled sheet, and the reusable tools they are saved as.

use weldcore::markups::{Markup, MarkupTool};

#[tauri::command]
pub fn list_markups(state: State<AppState>, drawing_id: i64) -> R<Vec<Markup>> {
    state.require_login()?;
    e(state.store()?.list_markups(drawing_id))
}

#[tauri::command]
pub fn create_markup(state: State<AppState>, markup: Markup) -> R<Markup> {
    let actor = state.require_editor()?;
    e(state.store()?.create_markup(&markup, &actor.username))
}

#[tauri::command]
pub fn update_markup(state: State<AppState>, markup: Markup) -> R<Markup> {
    let actor = state.require_editor()?;
    e(state.store()?.update_markup(&markup, &actor.username))
}

#[tauri::command]
pub fn delete_markup(state: State<AppState>, id: i64) -> R<()> {
    let actor = state.require_editor()?;
    e(state.store()?.delete_markup(id, &actor.username))
}

#[tauri::command]
pub fn reorder_markups(state: State<AppState>, order: Vec<(i64, i64)>) -> R<()> {
    state.require_editor()?;
    e(state.store()?.reorder_markups(&order))
}

#[tauri::command]
pub fn list_markup_tools(state: State<AppState>) -> R<Vec<MarkupTool>> {
    state.require_login()?;
    e(state.store()?.list_markup_tools())
}

#[tauri::command]
pub fn create_markup_tool(state: State<AppState>, tool: MarkupTool) -> R<MarkupTool> {
    let actor = state.require_editor()?;
    e(state.store()?.create_markup_tool(&tool, &actor.username))
}

#[tauri::command]
pub fn update_markup_tool(state: State<AppState>, tool: MarkupTool) -> R<MarkupTool> {
    let actor = state.require_editor()?;
    e(state.store()?.update_markup_tool(&tool, &actor.username))
}

#[tauri::command]
pub fn delete_markup_tool(state: State<AppState>, id: i64) -> R<()> {
    let actor = state.require_editor()?;
    e(state.store()?.delete_markup_tool(id, &actor.username))
}

#[tauri::command]
pub fn rename_markup_category(state: State<AppState>, from: String, to: String) -> R<i64> {
    let actor = state.require_editor()?;
    e(state.store()?.rename_markup_category(&from, &to, &actor.username))
}
