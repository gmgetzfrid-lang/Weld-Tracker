// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::*;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use weldcore::Store;

/// Decide where the database lives. Priority:
///   1. `SENTRIX_DB` (or legacy `WELDTRACKER_DB`) environment variable (shared).
///   2. `sentrix.json` (or legacy `weld-tracker.json`) next to the executable
///      with `"database_path"` (shared).
///   3. `data/sentrix.db` next to the executable, if a `sentrix.portable` (or
///      legacy `weld-tracker.portable`) marker file sits beside the exe and that
///      folder is writable (shared — the "drop it on a network drive" mode).
///   4. Otherwise the per-user app-data directory (local, single user).
/// Returns (path, shared). Legacy names are honoured so existing deployments
/// keep working after the SENTRIX rename.
fn resolve_db_path(app: &tauri::App) -> (PathBuf, bool) {
    let env_db = std::env::var("SENTRIX_DB")
        .ok()
        .filter(|p| !p.trim().is_empty())
        .or_else(|| std::env::var("WELDTRACKER_DB").ok().filter(|p| !p.trim().is_empty()));
    if let Some(p) = env_db {
        return (PathBuf::from(p), true);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["sentrix.json", "weld-tracker.json"] {
                if let Ok(txt) = fs::read_to_string(dir.join(name)) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                        if let Some(dp) = v.get("database_path").and_then(|x| x.as_str()) {
                            if !dp.trim().is_empty() {
                                return (PathBuf::from(dp), true);
                            }
                        }
                    }
                }
            }
            let has_marker = dir.join("sentrix.portable").exists()
                || dir.join("weld-tracker.portable").exists();
            if has_marker {
                let data = dir.join("data");
                if fs::create_dir_all(&data).is_ok() {
                    let probe = data.join(".write-test");
                    if fs::write(&probe, b"1").is_ok() {
                        let _ = fs::remove_file(&probe);
                        // Keep an existing legacy db in place; otherwise use the
                        // SENTRIX name for fresh shared deployments.
                        let legacy = data.join("weldtracker.db");
                        let db = if legacy.exists() { legacy } else { data.join("sentrix.db") };
                        return (db, true);
                    }
                }
            }
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .expect("could not resolve app data dir");
    fs::create_dir_all(&dir).ok();
    let legacy = dir.join("weldtracker.db");
    let db = if legacy.exists() { legacy } else { dir.join("sentrix.db") };
    (db, false)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let (db_path, shared) = resolve_db_path(app);
            if let Some(parent) = db_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            let store = Store::open(&db_path, shared).expect("failed to open database");
            app.manage(AppState::new(
                store,
                db_path.to_string_lossy().to_string(),
                shared,
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            logout,
            current_user,
            db_info,
            change_password,
            list_users,
            create_user,
            set_user_active,
            set_user_role,
            admin_reset_password,
            list_welders,
            get_welder,
            create_welder,
            update_welder,
            delete_welder,
            list_welder_certs,
            welder_cert_aliases,
            create_welder_cert,
            update_welder_cert,
            delete_welder_cert,
            set_welder_cert_file,
            get_welder_cert_file,
            welder_continuity,
            list_welds,
            count_welds,
            get_weld,
            create_weld,
            update_weld,
            delete_weld,
            void_weld,
            restore_weld,
            recent_activity,
            backup_database,
            create_repair,
            distinct_weld_values,
            weld_exceptions,
            global_search,
            list_drawings,
            list_work_orders,
            list_drawings_for_wo,
            get_drawing,
            create_drawing,
            update_drawing,
            delete_drawing,
            delete_work_order,
            work_order_owner,
            set_drawing_pdf,
            get_drawing_pdf,
            create_package,
            list_packages,
            get_package_pdf,
            add_wo_file,
            list_wo_files,
            get_wo_file,
            delete_wo_file,
            compute_nde,
            get_revision_pdf,
            set_effective_source,
            revise_drawing,
            list_drawing_revisions,
            list_drawing_welds,
            next_weld_number,
            add_bubble_weld,
            set_weld_bubble,
            apply_weld_attributes,
            list_pipe,
            pipe_sizes,
            lookup_thickness,
            lookups_grouped,
            list_lookups,
            add_lookup,
            remove_lookup,
            get_settings,
            set_setting,
            list_criteria,
            report_summary,
            report_job,
            report_daily,
            report_monthly,
            report_welder_stats,
            report_welder,
            report_client,
            report_qm,
            report_nde_compliance,
            report_performance
        ])
        .run(tauri::generate_context!())
        .expect("error while running Weld Tracker");
}
