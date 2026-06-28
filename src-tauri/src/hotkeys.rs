use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use crate::config::ConfigManager;

const ACTIONS: [&str; 7] = [
    "toggle",
    "playPrev",
    "playNext",
    "volumeUp",
    "volumeDown",
    "seekForward",
    "seekBackward",
];

/// 已注册的快捷键绑定与最近一次应用的状态。
pub struct HotkeyState {
    /// (shortcut, action) 对，用于在全局回调里把触发的快捷键映射回动作。
    bindings: Mutex<Vec<(Shortcut, String)>>,
    /// (registered, conflicts) —— 原始加速键字符串，供设置页展示。
    status: Mutex<(Vec<String>, Vec<String>)>,
}

impl HotkeyState {
    pub fn new() -> Self {
        Self {
            bindings: Mutex::new(Vec::new()),
            status: Mutex::new((Vec::new(), Vec::new())),
        }
    }
}

fn default_config() -> Value {
    json!({
        "toggle": "CmdOrCtrl+Alt+P",
        "playPrev": "CmdOrCtrl+Alt+Left",
        "playNext": "CmdOrCtrl+Alt+Right",
        "volumeUp": "CmdOrCtrl+Alt+Up",
        "volumeDown": "CmdOrCtrl+Alt+Down",
        "seekForward": "",
        "seekBackward": ""
    })
}

fn read_config(app: &AppHandle) -> Value {
    let cfg = app.state::<ConfigManager>().get("hotkeys", Value::Null);
    if cfg.is_object() {
        cfg
    } else {
        default_config()
    }
}

/// 把动作翻译为渲染端 `onMusicCtrl` 监听的 Tauri 事件。
/// 注意 volumeDelta 的取值在 0-100 区间（与 onGlobalCtrl 的 setVolume 一致）。
fn emit_action(app: &AppHandle, action: &str) {
    match action {
        "toggle" => {
            let _ = app.emit("toggle", ());
        }
        "playPrev" => {
            let _ = app.emit("playPrev", ());
        }
        "playNext" => {
            let _ = app.emit("playNext", ());
        }
        "volumeUp" => {
            let _ = app.emit("volumeDelta", 5);
        }
        "volumeDown" => {
            let _ = app.emit("volumeDelta", -5);
        }
        "seekForward" => {
            let _ = app.emit("seekDelta", 5);
        }
        "seekBackward" => {
            let _ = app.emit("seekDelta", -5);
        }
        _ => {}
    }
}

/// 注销旧绑定并按 config 重新注册全部快捷键，返回 (registered, conflicts)。
fn apply_config(app: &AppHandle, config: &Value) -> (Vec<String>, Vec<String>) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    let state = app.state::<HotkeyState>();
    let mut bindings = state.bindings.lock().unwrap();
    bindings.clear();

    let mut registered = Vec::new();
    let mut conflicts = Vec::new();

    for action in ACTIONS {
        let accel = config
            .get(action)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if accel.is_empty() {
            continue;
        }
        match accel.parse::<Shortcut>() {
            Ok(shortcut) => match gs.register(shortcut) {
                Ok(_) => {
                    bindings.push((shortcut, action.to_string()));
                    registered.push(accel);
                }
                Err(_) => conflicts.push(accel),
            },
            Err(_) => conflicts.push(accel),
        }
    }

    drop(bindings);
    *state.status.lock().unwrap() = (registered.clone(), conflicts.clone());
    (registered, conflicts)
}

/// 全局快捷键回调：在插件 Builder 的 with_handler 中调用。
pub fn handle_shortcut(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() != ShortcutState::Pressed {
        return;
    }
    if let Some(state) = app.try_state::<HotkeyState>() {
        let bindings = state.bindings.lock().unwrap();
        if let Some((_, action)) = bindings.iter().find(|(sc, _)| sc == shortcut) {
            let action = action.clone();
            drop(bindings);
            emit_action(app, &action);
        }
    }
}

/// 启动时按持久化配置注册快捷键。
pub fn init_hotkeys(app: &AppHandle) {
    let config = read_config(app);
    let _ = apply_config(app, &config);
}

#[tauri::command]
pub fn hotkeys_get(app: AppHandle) -> Value {
    let config = read_config(&app);
    let (registered, conflicts) = app.state::<HotkeyState>().status.lock().unwrap().clone();
    json!({
        "success": true,
        "data": config,
        "status": { "registered": registered, "conflicts": conflicts }
    })
}

#[tauri::command]
pub fn hotkeys_set(payload: Value, app: AppHandle) -> Value {
    // payload 形如 { config: {...} }，兼容直接传 config 对象。
    let config = payload
        .get("config")
        .cloned()
        .filter(|v| v.is_object())
        .unwrap_or(payload);

    app.state::<ConfigManager>()
        .set("hotkeys", config.clone());

    let (registered, conflicts) = apply_config(&app, &config);
    json!({
        "success": true,
        "data": config,
        "status": { "registered": registered, "conflicts": conflicts }
    })
}
