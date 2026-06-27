#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod db;
mod http_proxy;
mod scan;
mod local_music;
mod download;
mod plugins;

use std::fs;
use tauri::{AppHandle, Manager};
use config::ConfigManager;
use db::DatabaseManager;
use download::DownloadManager;

#[tauri::command]
fn window_minimize(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

#[tauri::command]
fn window_maximize(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(is_max) = win.is_maximized() {
            if is_max {
                let _ = win.unmaximize();
            } else {
                let _ = win.maximize();
            }
        }
    }
}

#[tauri::command]
fn window_close(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
    if let Some(lyric) = app.get_webview_window("lyric-window") {
        let _ = lyric.close();
    }
}

#[tauri::command]
fn window_show(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Initialize states
            let app_handle = app.handle().clone();
            app.manage(ConfigManager::new(&app_handle));
            app.manage(DatabaseManager::new(&app_handle));
            app.manage(DownloadManager::new(&app_handle));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Window controls
            window_minimize,
            window_maximize,
            window_close,
            window_show,
            get_app_version,

            // Local File Reading
            read_file,

            // Config Commands
            config::get_config,
            config::set_config,
            config::get_window_bounds,
            config::save_window_bounds,

            // DB Local Music Commands
            db::db_get_dirs,
            db::db_set_dirs,
            db::db_tracks_get_all,
            db::db_track_upsert,
            db::db_track_delete_by_path,
            db::db_tracks_clear,

            // DB Playlist Commands
            db::db_playlist_create,
            db::db_playlist_get_all,
            db::db_playlist_get_by_id,
            db::db_playlist_delete,
            db::db_playlist_songs_add,
            db::db_playlist_songs_get,
            db::db_playlist_song_remove,

            // Scanner Commands
            scan::scan_directories,

            // Local Music Commands
            local_music::local_music_scan,
            local_music::local_music_get_dirs,
            local_music::local_music_set_dirs,
            local_music::local_music_get_list,
            local_music::local_music_get_url,
            local_music::local_music_clear_index,
            local_music::local_music_get_cover,
            local_music::local_music_get_covers,
            local_music::local_music_get_tags,
            local_music::local_music_get_lyric,
            local_music::local_music_write_tags,

            // Download Commands
            download::download_get_tasks,
            download::download_add_task,
            download::download_pause_task,
            download::download_resume_task,
            download::download_cancel_task,

            // Network Bypass Proxy Command
            http_proxy::tauri_request,

            // Plugin File System Commands
            plugins::plugin_load_all,
            plugins::plugin_save,
            plugins::plugin_delete,
            plugins::plugin_get_config,
            plugins::plugin_save_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
