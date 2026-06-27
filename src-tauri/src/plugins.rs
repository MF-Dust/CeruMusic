use std::fs;
use std::path::PathBuf;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

fn get_plugins_dir(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
    path.push("plugins");
    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }
    path
}

#[tauri::command]
pub fn plugin_load_all(app: AppHandle) -> Result<Vec<Value>, String> {
    let dir = get_plugins_dir(&app);
    let mut list = Vec::new();
    
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("js") {
                    if let Ok(code) = fs::read_to_string(&path) {
                        let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                        // Extract plugin ID (filename without extension or generated)
                        let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
                        list.push(json!({
                            "id": id,
                            "name": filename,
                            "code": code
                        }));
                    }
                }
            }
        }
    }
    
    Ok(list)
}

#[tauri::command]
pub fn plugin_save(id: String, code: String, _name: String, app: AppHandle) -> Result<(), String> {
    let dir = get_plugins_dir(&app);
    let file_path = dir.join(format!("{}.js", id));
    fs::write(file_path, code).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn plugin_delete(id: String, app: AppHandle) -> Result<(), String> {
    let dir = get_plugins_dir(&app);
    let file_path = dir.join(format!("{}.js", id));
    if file_path.exists() {
        fs::remove_file(file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_get_config(id: String, app: AppHandle) -> Result<Value, String> {
    let dir = get_plugins_dir(&app).join("config");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    let file_path = dir.join(format!("{}.json", id));
    if file_path.exists() {
        let content = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
        let val = serde_json::from_str(&content).unwrap_or(Value::Null);
        Ok(val)
    } else {
        Ok(Value::Null)
    }
}

#[tauri::command]
pub fn plugin_save_config(id: String, config: Value, app: AppHandle) -> Result<(), String> {
    let dir = get_plugins_dir(&app).join("config");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    let file_path = dir.join(format!("{}.json", id));
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(file_path, content).map_err(|e| e.to_string())?;
    Ok(())
}
