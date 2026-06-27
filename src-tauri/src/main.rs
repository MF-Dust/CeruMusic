#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod db;
mod http_proxy;
mod scan;
mod local_music;
mod download;
mod plugins;

use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::Mutex;
use std::thread;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::window::{ProgressBarState, ProgressBarStatus};
use config::ConfigManager;
use db::DatabaseManager;
use download::DownloadManager;

const SINGLE_INSTANCE_PORT: u16 = 48329;

struct PendingDeepLinks {
    shares: Mutex<Vec<String>>,
    playlist_shares: Mutex<Vec<String>>,
}

fn handle_deeplink(url: &str, app: &AppHandle) {
    if !url.starts_with("cerumusic://") {
        return;
    }
    
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    
    let path = &url["cerumusic://".len()..];
    if path.starts_with("play/next") {
        let _ = app.emit("playNext", ());
    } else if path.starts_with("play/prev") {
        let _ = app.emit("playPrev", ());
    } else if path.starts_with("play/toggle") {
        let _ = app.emit("toggle", ());
    } else if path.starts_with("plugin/add/link") {
        if let Ok(parsed_url) = url::Url::parse(url) {
            let mut params = std::collections::HashMap::new();
            for (k, v) in parsed_url.query_pairs() {
                params.insert(k.into_owned(), v.into_owned());
            }
            if let Some(plugin_url) = params.get("url") {
                let plugin_type = params.get("type").map(|s| s.as_str()).unwrap_or("cr").to_string();

                let _ = app.emit("plugin-notice", serde_json::json!({
                    "type": "info",
                    "dialogType": "info",
                    "title": "外部插件安装请求",
                    "message": "检测到外部 Deeplink 安装请求。请确认来源可靠，谨慎安装来路不明插件。",
                    "updateUrl": plugin_url,
                    "pluginType": plugin_type,
                    "pluginName": "外部插件",
                    "actions": [
                        { "text": "取消", "type": "cancel" },
                        { "text": "安装并使用", "type": "confirm", "primary": true }
                    ]
                }));
            }
        }
    } else if path.starts_with("share/") {
        let id = &path["share/".len()..];
        if !id.is_empty() {
            if let Some(state) = app.try_state::<PendingDeepLinks>() {
                state.shares.lock().unwrap().push(id.to_string());
            }
            let _ = app.emit("share-open", serde_json::json!({ "id": id }));
        }
    } else if path.starts_with("playlist/share/") {
        let id = &path["playlist/share/".len()..];
        if !id.is_empty() {
            if let Some(state) = app.try_state::<PendingDeepLinks>() {
                state.playlist_shares.lock().unwrap().push(id.to_string());
            }
            let _ = app.emit("playlist-share-open", serde_json::json!({ "id": id }));
        }
    }
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

fn setup_tray(app: &tauri::App) -> Result<(), tauri::Error> {
    let play_toggle = MenuItem::with_id(app, "play_toggle", "播放/暂停", true, None::<&str>)?;
    let play_next = MenuItem::with_id(app, "play_next", "下一首", true, None::<&str>)?;
    let play_prev = MenuItem::with_id(app, "play_prev", "上一首", true, None::<&str>)?;
    
    let show_hide = MenuItem::with_id(app, "show_hide", "显示/隐藏主窗口", true, None::<&str>)?;
    
    let lyric_toggle = MenuItem::with_id(app, "lyric_toggle", "显示/隐藏歌词", true, None::<&str>)?;
    let lyric_lock = MenuItem::with_id(app, "lyric_lock", "锁定/解锁歌词", true, None::<&str>)?;
    
    let exit = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
    
    let menu = Menu::with_items(app, &[
        &play_toggle,
        &play_next,
        &play_prev,
        &tauri::menu::PredefinedMenuItem::separator(app)?,
        &show_hide,
        &lyric_toggle,
        &lyric_lock,
        &tauri::menu::PredefinedMenuItem::separator(app)?,
        &exit,
    ])?;
    
    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app_handle, event| {
            let id = event.id.as_ref();
            match id {
                "play_toggle" => {
                    let _ = app_handle.emit("toggle", ());
                }
                "play_next" => {
                    let _ = app_handle.emit("playNext", ());
                }
                "play_prev" => {
                    let _ = app_handle.emit("playPrev", ());
                }
                "show_hide" => {
                    toggle_main_window(app_handle);
                }
                "lyric_toggle" => {
                    let config = app_handle.state::<ConfigManager>();
                    let mut lyric = config.get("lyric", json!({}));
                    let is_open = lyric.get("isOpen").and_then(|v| v.as_bool()).unwrap_or(false);
                    let new_open = !is_open;
                    
                    if let Some(obj) = lyric.as_object_mut() {
                        obj.insert("isOpen".to_string(), serde_json::Value::Bool(new_open));
                    }
                    config.set("lyric", lyric);
                    
                    if let Some(lyric_win) = app_handle.get_webview_window("lyric-window") {
                        if new_open {
                            let _ = lyric_win.show();
                        } else {
                            let _ = lyric_win.hide();
                        }
                    }
                    let _ = app_handle.emit("desktop-lyric-open-change", new_open);
                }
                "lyric_lock" => {
                    let config = app_handle.state::<ConfigManager>();
                    let mut lyric = config.get("lyric", json!({}));
                    let is_lock = lyric.get("isLock").and_then(|v| v.as_bool()).unwrap_or(false);
                    let new_lock = !is_lock;
                    
                    if let Some(obj) = lyric.as_object_mut() {
                        obj.insert("isLock".to_string(), serde_json::Value::Bool(new_lock));
                    }
                    config.set("lyric", lyric);
                    
                    if let Some(lyric_win) = app_handle.get_webview_window("lyric-window") {
                        let _ = lyric_win.set_ignore_cursor_events(new_lock);
                    }
                    let _ = app_handle.emit("toogleDesktopLyricLock", new_lock);
                }
                "exit" => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray_icon, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app_handle = tray_icon.app_handle();
                toggle_main_window(app_handle);
            }
        })
        .build(app)?;
        
    Ok(())
}

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
    app.exit(0);
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

#[tauri::command]
fn window_set_title(title: String, app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_title(&title);
    }
}

#[tauri::command]
fn window_set_progress(progress: f64, paused: Option<bool>, app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        if progress < 0.0 {
            win.set_progress_bar(ProgressBarState {
                status: Some(ProgressBarStatus::None),
                progress: None,
            })
            .map_err(|e| e.to_string())?;
            return Ok(());
        }

        let value = (progress.clamp(0.0, 1.0) * 100.0).round() as u64;
        win.set_progress_bar(ProgressBarState {
            status: Some(if paused.unwrap_or(false) {
                ProgressBarStatus::Paused
            } else {
                ProgressBarStatus::Normal
            }),
            progress: Some(value),
        })
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn window_set_mini_mode(is_mini: bool, app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if is_mini {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    }
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("explorer").arg(path).spawn();
        }
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("open").arg(path).spawn();
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let _ = std::process::Command::new("xdg-open").arg(path).spawn();
        }
    }
    Ok(())
}

fn dir_size(path: &Path) -> std::io::Result<u64> {
    let mut size = 0;
    if path.is_dir() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                size += dir_size(&path)?;
            } else {
                size += entry.metadata()?.len();
            }
        }
    }
    Ok(size)
}

#[tauri::command]
fn get_folder_size(path: String) -> Result<u64, String> {
    dir_size(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_cache_size(app: AppHandle) -> Result<u64, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    if !cache_dir.exists() {
        return Ok(0);
    }
    dir_size(&cache_dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_cache(app: AppHandle) -> Result<(), String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    if cache_dir.exists() {
        if let Ok(entries) = fs::read_dir(cache_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    let _ = fs::remove_dir_all(path);
                } else {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn change_desktop_lyric(val: bool, app: AppHandle) -> Result<(), String> {
    if let Some(lyric) = app.get_webview_window("lyric-window") {
        if val {
            let _ = lyric.show();
            let _ = lyric.set_focus();
        } else {
            let _ = lyric.hide();
        }
    }
    let _ = app.emit("desktop-lyric-open-change", val);
    Ok(())
}

#[tauri::command]
fn get_lyric_lock_state(app: AppHandle) -> bool {
    let config = app.state::<ConfigManager>();
    let lyric = config.get("lyric", json!({}));
    lyric.get("isLock").and_then(|v| v.as_bool()).unwrap_or(false)
}

#[tauri::command]
fn get_lyric_open_state(app: AppHandle) -> bool {
    let config = app.state::<ConfigManager>();
    let lyric = config.get("lyric", json!({}));
    lyric.get("isOpen").and_then(|v| v.as_bool()).unwrap_or(false)
}

#[tauri::command]
fn lyric_window_set_bounds(x: i32, y: i32, w: u32, h: u32, app: AppHandle) -> Result<(), String> {
    if let Some(lyric) = app.get_webview_window("lyric-window") {
        let _ = lyric.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)));
        let _ = lyric.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(w, h)));
    }
    Ok(())
}

#[tauri::command]
fn lyric_window_set_height(height: u32, app: AppHandle) -> Result<(), String> {
    if let Some(lyric) = app.get_webview_window("lyric-window") {
        let mut size = lyric.inner_size().map_err(|e| e.to_string())?;
        size.height = height;
        let _ = lyric.set_size(tauri::Size::Physical(size));
    }
    Ok(())
}

#[tauri::command]
fn lyric_window_set_lock(is_lock: bool, app: AppHandle) -> Result<(), String> {
    if let Some(lyric) = app.get_webview_window("lyric-window") {
        let _ = lyric.set_ignore_cursor_events(is_lock);
        let _ = app.emit("toogleDesktopLyricLock", is_lock);
    }
    Ok(())
}

#[tauri::command]
fn lyric_window_close(app: AppHandle) -> Result<(), String> {
    if let Some(lyric) = app.get_webview_window("lyric-window") {
        let _ = lyric.hide();
    }
    let _ = app.emit("closeDesktopLyric", ());
    Ok(())
}

#[tauri::command]
fn lyric_window_ready(app: AppHandle) -> Result<(), String> {
    let _ = app.emit("lyric-window-ready", ());
    Ok(())
}

#[tauri::command]
fn lyric_window_send_to_main(name: String, args: Vec<Value>, app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit(&name, args);
    }
    Ok(())
}

#[tauri::command]
fn get_desktop_lyric_option(app: AppHandle) -> Value {
    let config = app.state::<ConfigManager>();
    config.get("lyric", json!({
        "fontSize": 30,
        "mainColor": "#73BCFC",
        "shadowColor": "rgba(255, 255, 255, 0.5)",
        "x": 100,
        "y": 100,
        "width": 800,
        "height": 180,
        "fontFamily": "PingFangSC-Semibold",
        "fontWeight": 600,
        "position": "center",
        "alwaysShowPlayInfo": false,
        "isLock": false,
        "animation": true,
        "showYrc": true,
        "showTran": false,
        "isDoubleLine": true,
        "textBackgroundMask": false,
        "backgroundMaskColor": "rgba(0,0,0,0.2)",
        "unplayedColor": "rgba(255,255,255,0.5)",
        "limitBounds": true
    }))
}

#[tauri::command]
fn set_desktop_lyric_option(option: Value, callback: bool, app: AppHandle) -> Result<(), String> {
    let config = app.state::<ConfigManager>();
    let mut current = config.get("lyric", json!({}));
    if let Some(current_obj) = current.as_object_mut() {
        if let Some(opt_obj) = option.as_object() {
            for (k, v) in opt_obj {
                current_obj.insert(k.clone(), v.clone());
            }
        }
    } else {
        current = option.clone();
    }
    config.set("lyric", current.clone());
    
    let _ = app.emit("desktop-lyric-option-change", current.clone());
    if callback {
        if let Some(lyric_win) = app.get_webview_window("lyric-window") {
            let _ = lyric_win.emit("desktop-lyric-option-change", current);
        }
    }
    Ok(())
}

#[tauri::command]
fn get_pending_share_ids(app: AppHandle) -> Vec<String> {
    if let Some(state) = app.try_state::<PendingDeepLinks>() {
        let mut shares = state.shares.lock().unwrap();
        let list = shares.clone();
        shares.clear();
        list
    } else {
        Vec::new()
    }
}

#[tauri::command]
fn get_pending_playlist_share_ids(app: AppHandle) -> Vec<String> {
    if let Some(state) = app.try_state::<PendingDeepLinks>() {
        let mut playlist_shares = state.playlist_shares.lock().unwrap();
        let list = playlist_shares.clone();
        playlist_shares.clear();
        list
    } else {
        Vec::new()
    }
}

#[tauri::command]
fn get_pending_lt_codes() -> Vec<String> {
    Vec::new()
}

fn main() {
    if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", SINGLE_INSTANCE_PORT)) {
        let args: Vec<String> = std::env::args().collect();
        if let Some(url) = args.iter().find(|arg| arg.starts_with("cerumusic://")) {
            let _ = stream.write_all(url.as_bytes());
        }
        return;
    }

    let listener = TcpListener::bind(("127.0.0.1", SINGLE_INSTANCE_PORT)).unwrap();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let app_handle = app.handle().clone();
            
            app.manage(PendingDeepLinks {
                shares: Mutex::new(Vec::new()),
                playlist_shares: Mutex::new(Vec::new()),
            });

            let args: Vec<String> = std::env::args().collect();
            if let Some(url) = args.iter().find(|arg| arg.starts_with("cerumusic://")) {
                handle_deeplink(url, &app_handle);
            }

            let handle_clone = app_handle.clone();
            thread::spawn(move || {
                for stream in listener.incoming() {
                    if let Ok(mut stream) = stream {
                        let mut buffer = [0; 1024];
                        if let Ok(size) = stream.read(&mut buffer) {
                            if let Ok(url) = std::str::from_utf8(&buffer[..size]) {
                                let url = url.trim().to_string();
                                if url.starts_with("cerumusic://") {
                                    let handle = handle_clone.clone();
                                    let handle_cb = handle.clone();
                                    let _ = handle.run_on_main_thread(move || {
                                        handle_deeplink(&url, &handle_cb);
                                    });
                                }
                            }
                        }
                    }
                }
            });

            app.manage(ConfigManager::new(&app_handle));
            app.manage(DatabaseManager::new(&app_handle));
            app.manage(DownloadManager::new(&app_handle));

            let _ = setup_tray(app);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.emit("window-close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Window controls
            window_minimize,
            window_maximize,
            window_close,
            window_show,
            get_app_version,
            window_set_title,
            window_set_progress,
            window_set_mini_mode,
            open_folder,
            get_folder_size,
            get_cache_size,
            clear_cache,

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
            db::db_playlist_update_cover,
            db::db_playlist_search,
            db::db_playlist_get_statistics,
            db::db_playlist_clear_songs,
            db::db_playlist_search_songs,
            db::db_playlist_get_song_statistics,
            db::db_playlist_reorder_songs,
            db::db_playlist_move_song,

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
            download::download_delete_task,
            download::download_clear_tasks,
            download::download_pause_all,
            download::download_resume_all,
            download::download_validate_files,
            download::download_open_file_location,

            // Desktop Lyric Window Commands
            change_desktop_lyric,
            get_lyric_lock_state,
            get_lyric_open_state,
            lyric_window_set_bounds,
            lyric_window_set_height,
            lyric_window_set_lock,
            lyric_window_close,
            lyric_window_ready,
            lyric_window_send_to_main,
            get_desktop_lyric_option,
            set_desktop_lyric_option,

            // Deep link buffers
            get_pending_share_ids,
            get_pending_playlist_share_ids,
            get_pending_lt_codes,

            // Network Bypass Proxy Command
            http_proxy::tauri_request,

            // Plugin File System Commands
            plugins::plugin_select_and_add,
            plugins::plugin_download_and_add,
            plugins::plugin_load_all,
            plugins::plugin_save,
            plugins::plugin_save_metadata,
            plugins::plugin_delete,
            plugins::plugin_get_config,
            plugins::plugin_save_config,
            plugins::plugin_get_log,
            plugins::plugin_append_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
