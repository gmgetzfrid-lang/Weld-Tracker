// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::*;
use std::fs;
use tauri::Manager;
use weldcore::Store;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Database lives in the per-user app data directory
            // (%APPDATA%\com.kernenergy.weldtracker on Windows) so the app
            // installs and runs without administrator rights.
            let dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data dir");
            fs::create_dir_all(&dir).ok();
            let db_path = dir.join("weldtracker.db");
            let store = Store::open(&db_path).expect("failed to open database");
            app.manage(AppState::new(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            logout,
            current_user,
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
            list_welds,
            count_welds,
            get_weld,
            create_weld,
            update_weld,
            delete_weld,
            create_repair,
            distinct_weld_values,
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
            report_qm
        ])
        .run(tauri::generate_context!())
        .expect("error while running Weld Tracker");
}
