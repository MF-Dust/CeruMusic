use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use url::Url;
use zip::ZipArchive;

fn get_plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    path.push("plugins");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn sanitize_plugin_id(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' {
            out.push(ch);
        }
    }
    if out.is_empty() {
        "plugin".to_string()
    } else {
        out.chars().take(64).collect()
    }
}

fn code_hash(code: &str) -> String {
    format!("{:x}", md5::compute(code.as_bytes()))
        .chars()
        .take(8)
        .collect()
}

fn plugin_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(get_plugins_dir(app)?.join(sanitize_plugin_id(id)))
}

fn ensure_plugin_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let dir = plugin_dir(app, id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn config_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(plugin_dir(app, id)?.join("config.json"))
}

fn log_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(plugin_dir(app, id)?.join("plugin.log"))
}

fn read_json(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .unwrap_or_else(|| json!({}))
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

fn merge_json(base: Value, update: Value) -> Value {
    match (base, update) {
        (Value::Object(mut base_map), Value::Object(update_map)) => {
            for (key, value) in update_map {
                base_map.insert(key, value);
            }
            Value::Object(base_map)
        }
        (_, update_value) => update_value,
    }
}

fn is_supported_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase()),
        Some(ext) if ext == "js" || ext == "zip"
    )
}

fn extract_zip_entry(bytes: &[u8]) -> Result<(String, String), String> {
    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("无法读取 zip 插件包: {e}"))?;
    let mut fallback: Option<String> = None;

    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().replace('\\', "/");
        if !name.to_ascii_lowercase().ends_with(".js") || name.contains("../") {
            continue;
        }

        let lower = name.to_ascii_lowercase();
        if lower == "plugin.js"
            || lower.ends_with("/plugin.js")
            || lower == "index.js"
            || lower.ends_with("/index.js")
            || lower == "main.js"
            || lower.ends_with("/main.js")
        {
            drop(file);
            let mut selected = archive.by_index(i).map_err(|e| e.to_string())?;
            let mut code = String::new();
            selected
                .read_to_string(&mut code)
                .map_err(|e| format!("zip 内的 {name} 不是有效 UTF-8 JS 文件: {e}"))?;
            return Ok((name, code));
        }

        if fallback.is_none() {
            fallback = Some(name);
        }
    }

    if let Some(name) = fallback {
        let mut file = archive
            .by_name(&name)
            .map_err(|e| format!("无法读取 zip 内的 {name}: {e}"))?;
        let mut code = String::new();
        file.read_to_string(&mut code)
            .map_err(|e| format!("zip 内的 {name} 不是有效 UTF-8 JS 文件: {e}"))?;
        return Ok((name, code));
    }

    Err("zip 插件包中没有找到 .js 入口文件".to_string())
}

fn read_plugin_code_from_bytes(
    bytes: &[u8],
    source_name: &str,
    force_zip: bool,
) -> Result<(String, String), String> {
    let is_zip = force_zip || bytes.starts_with(b"PK");
    if is_zip {
        return extract_zip_entry(bytes);
    }

    let code = String::from_utf8(bytes.to_vec())
        .map_err(|e| format!("{source_name} 不是有效 UTF-8 JS 文件: {e}"))?;
    Ok((source_name.to_string(), code))
}

fn install_plugin_code(
    app: &AppHandle,
    code: String,
    plugin_type: String,
    source_label: String,
    target_plugin_id: Option<String>,
    base_metadata: Value,
) -> Result<Value, String> {
    let target_id = target_plugin_id
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| {
            let stem = Path::new(&source_label)
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or("plugin");
            format!("{}-{}", sanitize_plugin_id(stem), code_hash(&code))
        });
    let plugin_id = sanitize_plugin_id(&target_id);
    let dir = ensure_plugin_dir(app, &plugin_id)?;

    fs::write(dir.join("plugin.js"), &code).map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let metadata = merge_json(
        json!({
            "pluginId": plugin_id,
            "pluginName": source_label,
            "pluginType": if plugin_type == "service" { "service" } else { "music-source" },
            "importType": plugin_type,
            "installedAt": now,
            "updatedAt": now
        }),
        base_metadata,
    );
    write_json(&dir.join("metadata.json"), &metadata)?;

    if !dir.join("config.json").exists() {
        write_json(&dir.join("config.json"), &json!({}))?;
    }
    if !dir.join("plugin.log").exists() {
        fs::write(dir.join("plugin.log"), "").map_err(|e| e.to_string())?;
    }

    Ok(json!({
        "success": true,
        "pluginId": plugin_id,
        "code": code,
        "metadata": metadata
    }))
}

#[tauri::command]
pub fn plugin_select_and_add(
    plugin_type: String,
    path: String,
    target_plugin_id: Option<String>,
    app: AppHandle,
) -> Result<Value, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err("插件文件不存在".to_string());
    }
    if !is_supported_path(&path_buf) {
        return Err("只支持导入 .js 或 .zip 插件文件".to_string());
    }

    let bytes = fs::read(&path_buf).map_err(|e| e.to_string())?;
    let source_name = path_buf
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("plugin.js")
        .to_string();
    let force_zip = path_buf.extension().and_then(|s| s.to_str()) == Some("zip");
    let (entry_name, code) = read_plugin_code_from_bytes(&bytes, &source_name, force_zip)?;

    install_plugin_code(
        &app,
        code,
        plugin_type,
        entry_name,
        target_plugin_id,
        json!({ "sourcePath": path }),
    )
}

#[tauri::command]
pub async fn plugin_download_and_add(
    url: String,
    plugin_type: String,
    target_plugin_id: Option<String>,
    app: AppHandle,
) -> Result<Value, String> {
    let parsed = Url::parse(&url).map_err(|_| "请输入有效的插件下载地址".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("在线安装只支持 HTTP/HTTPS 链接".to_string());
    }

    let response = reqwest::get(parsed.as_str())
        .await
        .map_err(|e| format!("插件下载失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("插件下载失败，HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取插件下载内容失败: {e}"))?;

    let source_name = parsed
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|name| !name.is_empty())
        .unwrap_or("plugin.js")
        .to_string();
    let force_zip = source_name.to_ascii_lowercase().ends_with(".zip");
    let (entry_name, code) = read_plugin_code_from_bytes(&bytes, &source_name, force_zip)?;

    install_plugin_code(
        &app,
        code,
        plugin_type,
        entry_name,
        target_plugin_id,
        json!({ "sourceUrl": url }),
    )
}

#[tauri::command]
pub fn plugin_load_all(app: AppHandle) -> Result<Vec<Value>, String> {
    let dir = get_plugins_dir(&app)?;
    let mut list = Vec::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let plugin_id = entry
                    .file_name()
                    .to_str()
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                let js_path = path.join("plugin.js");
                if !js_path.exists() {
                    continue;
                }
                if let Ok(code) = fs::read_to_string(&js_path) {
                    let metadata = read_json(&path.join("metadata.json"));
                    list.push(json!({
                        "id": plugin_id,
                        "pluginId": plugin_id,
                        "name": metadata
                            .get("pluginInfo")
                            .and_then(|v| v.get("name"))
                            .and_then(|v| v.as_str())
                            .or_else(|| metadata.get("pluginName").and_then(|v| v.as_str()))
                            .unwrap_or("plugin"),
                        "code": code,
                        "metadata": metadata,
                    }));
                }
            } else if entry.file_type().map(|t| t.is_file()).unwrap_or(false)
                && path.extension().and_then(|s| s.to_str()) == Some("js")
            {
                // Backward compatibility for the short-lived flat Tauri plugin layout.
                if let Ok(code) = fs::read_to_string(&path) {
                    let id = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .map(sanitize_plugin_id)
                        .unwrap_or_else(|| format!("plugin-{}", code_hash(&code)));
                    list.push(json!({
                        "id": id,
                        "pluginId": id,
                        "name": path.file_name().and_then(|s| s.to_str()).unwrap_or("plugin.js"),
                        "code": code,
                        "metadata": {
                            "pluginId": id,
                            "pluginName": path.file_name().and_then(|s| s.to_str()).unwrap_or("plugin.js"),
                            "legacyFlatFile": true
                        }
                    }));
                }
            }
        }
    }

    Ok(list)
}

#[tauri::command]
pub fn plugin_save(
    id: String,
    code: String,
    name: String,
    metadata: Option<Value>,
    app: AppHandle,
) -> Result<(), String> {
    let plugin_id = sanitize_plugin_id(&id);
    let dir = ensure_plugin_dir(&app, &plugin_id)?;
    fs::write(dir.join("plugin.js"), code).map_err(|e| e.to_string())?;

    let base = read_json(&dir.join("metadata.json"));
    let next = merge_json(
        base,
        merge_json(
            json!({
                "pluginId": plugin_id,
                "pluginName": name,
                "updatedAt": chrono::Utc::now().to_rfc3339()
            }),
            metadata.unwrap_or_else(|| json!({})),
        ),
    );
    write_json(&dir.join("metadata.json"), &next)?;

    if !dir.join("config.json").exists() {
        write_json(&dir.join("config.json"), &json!({}))?;
    }
    if !dir.join("plugin.log").exists() {
        fs::write(dir.join("plugin.log"), "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_save_metadata(id: String, metadata: Value, app: AppHandle) -> Result<(), String> {
    let plugin_id = sanitize_plugin_id(&id);
    let dir = ensure_plugin_dir(&app, &plugin_id)?;
    let existing = read_json(&dir.join("metadata.json"));
    let next = merge_json(
        existing,
        merge_json(
            json!({
                "pluginId": plugin_id,
                "updatedAt": chrono::Utc::now().to_rfc3339()
            }),
            metadata,
        ),
    );
    write_json(&dir.join("metadata.json"), &next)
}

#[tauri::command]
pub fn plugin_delete(id: String, app: AppHandle) -> Result<(), String> {
    let plugin_id = sanitize_plugin_id(&id);
    let dir = plugin_dir(&app, &plugin_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }

    let legacy_file = get_plugins_dir(&app)?.join(format!("{plugin_id}.js"));
    if legacy_file.exists() {
        fs::remove_file(legacy_file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_get_config(id: String, app: AppHandle) -> Result<Value, String> {
    let plugin_id = sanitize_plugin_id(&id);
    let path = config_path(&app, &plugin_id)?;
    if path.exists() {
        Ok(read_json(&path))
    } else {
        let legacy_path = get_plugins_dir(&app)?
            .join("config")
            .join(format!("{plugin_id}.json"));
        if legacy_path.exists() {
            Ok(read_json(&legacy_path))
        } else {
            Ok(json!({}))
        }
    }
}

#[tauri::command]
pub fn plugin_save_config(id: String, config: Value, app: AppHandle) -> Result<(), String> {
    let plugin_id = sanitize_plugin_id(&id);
    let dir = ensure_plugin_dir(&app, &plugin_id)?;
    write_json(&dir.join("config.json"), &config)
}

#[tauri::command]
pub fn plugin_get_log(id: String, app: AppHandle) -> Result<Vec<String>, String> {
    let plugin_id = sanitize_plugin_id(&id);
    let path = log_path(&app, &plugin_id)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(content.lines().map(|line| line.to_string()).collect())
}

#[tauri::command]
pub fn plugin_append_log(id: String, entry: Value, app: AppHandle) -> Result<(), String> {
    let plugin_id = sanitize_plugin_id(&id);
    let dir = ensure_plugin_dir(&app, &plugin_id)?;
    let path = dir.join("plugin.log");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}
