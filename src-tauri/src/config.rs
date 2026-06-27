use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use serde_json::Value;
use tauri::{AppHandle, Manager};

pub struct ConfigManager {
    file_path: PathBuf,
    data: Mutex<HashMap<String, Value>>,
}

impl ConfigManager {
    pub fn new(app: &AppHandle) -> Self {
        let mut path = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }
        path.push("config.json");

        let data = if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                serde_json::from_str(&content).unwrap_or_default()
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        };

        Self {
            file_path: path,
            data: Mutex::new(data),
        }
    }

    pub fn get(&self, key: &str, default: Value) -> Value {
        let data = self.data.lock().unwrap();
        data.get(key).cloned().unwrap_or(default)
    }

    pub fn set(&self, key: &str, value: Value) -> bool {
        let mut data = self.data.lock().unwrap();
        data.insert(key.to_string(), value);
        self.save_internal(&data)
    }

    fn save_internal(&self, data: &HashMap<String, Value>) -> bool {
        if let Ok(content) = serde_json::to_string_pretty(data) {
            fs::write(&self.file_path, content).is_ok()
        } else {
            false
        }
    }
}

// Tauri commands for config
#[tauri::command]
pub fn get_config(key: String, default: Value, app: AppHandle) -> Value {
    let state = app.state::<ConfigManager>();
    state.get(&key, default)
}

#[tauri::command]
pub fn set_config(key: String, value: Value, app: AppHandle) -> bool {
    let state = app.state::<ConfigManager>();
    state.set(&key, value)
}

#[tauri::command]
pub fn get_window_bounds(app: AppHandle) -> Value {
    let state = app.state::<ConfigManager>();
    state.get("window_bounds", Value::Null)
}

#[tauri::command]
pub fn save_window_bounds(bounds: Value, app: AppHandle) -> bool {
    let state = app.state::<ConfigManager>();
    state.set("window_bounds", bounds)
}
