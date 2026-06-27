use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use reqwest::Client;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::config::WriteOptions;
use lofty::tag::Accessor;
use serde_json::json;

#[derive(Serialize, Deserialize, Clone)]
pub struct DownloadTask {
    id: String,
    url: String,
    #[serde(rename = "filePath")]
    file_path: String,
    status: String, // "queued", "downloading", "paused", "completed", "failed", "cancelled"
    progress: f64,
    #[serde(rename = "totalSize")]
    total_size: u64,
    #[serde(rename = "downloadedSize")]
    downloaded_size: u64,
    #[serde(rename = "songInfo")]
    song_info: Value,
    priority: i32,
    #[serde(rename = "pluginId")]
    plugin_id: Option<String>,
    quality: Option<String>,
}

pub struct DownloadManager {
    tasks: Mutex<HashMap<String, DownloadTask>>,
    active_downloads: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    downloads_file: PathBuf,
}

impl DownloadManager {
    pub fn new(app: &AppHandle) -> Self {
        let path = app.path().app_local_data_dir().unwrap_or_else(|_| PathBuf::from("."));
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }
        let downloads_file = path.join("downloads.json");

        let tasks = if downloads_file.exists() {
            if let Ok(content) = fs::read_to_string(&downloads_file) {
                serde_json::from_str(&content).unwrap_or_default()
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        };

        // Reset any downloading or queued tasks to paused
        let mut tasks_map: HashMap<String, DownloadTask> = tasks;
        for task in tasks_map.values_mut() {
            if task.status == "downloading" || task.status == "queued" {
                task.status = "paused".to_string();
            }
        }

        Self {
            tasks: Mutex::new(tasks_map),
            active_downloads: Mutex::new(HashMap::new()),
            downloads_file,
        }
    }

    fn save(&self) {
        let tasks = self.tasks.lock().unwrap();
        if let Ok(content) = serde_json::to_string_pretty(&*tasks) {
            let _ = fs::write(&self.downloads_file, content);
        }
    }

    pub fn add_task(&self, id: String, url: String, path: String, song_info: Value, priority: i32, plugin_id: Option<String>, quality: Option<String>) -> DownloadTask {
        let task = DownloadTask {
            id: id.clone(),
            url,
            file_path: path,
            status: "queued".to_string(),
            progress: 0.0,
            total_size: 0,
            downloaded_size: 0,
            song_info,
            priority,
            plugin_id,
            quality,
        };

        let mut tasks = self.tasks.lock().unwrap();
        tasks.insert(id, task.clone());
        drop(tasks);
        self.save();
        task
    }

    pub fn get_tasks(&self) -> Vec<DownloadTask> {
        let tasks = self.tasks.lock().unwrap();
        tasks.values().cloned().collect()
    }
}

// Tauri Commands for downloads
#[tauri::command]
pub fn download_get_tasks(app: AppHandle) -> Vec<DownloadTask> {
    let manager = app.state::<DownloadManager>();
    manager.get_tasks()
}

#[tauri::command]
pub fn download_add_task(
    id: String,
    url: String,
    path: String,
    song_info: Value,
    priority: i32,
    plugin_id: Option<String>,
    quality: Option<String>,
    app: AppHandle,
) -> DownloadTask {
    let manager = app.state::<DownloadManager>();
    let task = manager.add_task(id, url, path, song_info, priority, plugin_id, quality);
    
    // Auto start download
    let app_clone = app.clone();
    let task_id = task.id.clone();
    tokio::spawn(async move {
        let _ = download_start_internal(&task_id, app_clone).await;
    });

    task
}

#[tauri::command]
pub fn download_pause_task(id: String, app: AppHandle) -> Result<(), String> {
    let manager = app.state::<DownloadManager>();
    let mut active = manager.active_downloads.lock().unwrap();
    if let Some(cancel_tx) = active.remove(&id) {
        let _ = cancel_tx.send(());
    }

    let mut tasks = manager.tasks.lock().unwrap();
    if let Some(task) = tasks.get_mut(&id) {
        task.status = "paused".to_string();
    }
    drop(tasks);
    manager.save();
    let _ = app.emit("download-status-changed", id);
    Ok(())
}

#[tauri::command]
pub fn download_resume_task(id: String, app: AppHandle) -> Result<(), String> {
    let manager = app.state::<DownloadManager>();
    let mut tasks = manager.tasks.lock().unwrap();
    if let Some(task) = tasks.get_mut(&id) {
        task.status = "queued".to_string();
    }
    drop(tasks);
    manager.save();

    let app_clone = app.clone();
    tokio::spawn(async move {
        let _ = download_start_internal(&id, app_clone).await;
    });
    
    Ok(())
}

#[tauri::command]
pub fn download_cancel_task(id: String, app: AppHandle) -> Result<(), String> {
    let manager = app.state::<DownloadManager>();
    let mut active = manager.active_downloads.lock().unwrap();
    if let Some(cancel_tx) = active.remove(&id) {
        let _ = cancel_tx.send(());
    }

    let mut tasks = manager.tasks.lock().unwrap();
    let mut path_to_delete = None;
    if let Some(task) = tasks.get_mut(&id) {
        task.status = "cancelled".to_string();
        path_to_delete = Some(format!("{}.temp", task.file_path));
    }
    drop(tasks);
    manager.save();

    if let Some(p) = path_to_delete {
        let _ = fs::remove_file(p);
    }

    let _ = app.emit("download-status-changed", id);
    Ok(())
}

async fn download_start_internal(id: &str, app: AppHandle) -> Result<(), String> {
    let manager = app.state::<DownloadManager>();
    
    let mut tasks = manager.tasks.lock().unwrap();
    let mut task = match tasks.get_mut(id) {
        Some(t) => t.clone(),
        None => return Err("Task not found".to_string()),
    };
    if task.status != "queued" {
        return Ok(());
    }
    task.status = "downloading".to_string();
    tasks.insert(id.to_string(), task.clone());
    drop(tasks);
    manager.save();

    let _ = app.emit("download-status-changed", id.to_string());

    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    manager.active_downloads.lock().unwrap().insert(id.to_string(), cancel_tx);

    let id_str = id.to_string();
    let app_clone = app.clone();
    
    tokio::spawn(async move {
        let client = Client::new();
        let temp_path_str = format!("{}.temp", task.file_path);
        let temp_path = Path::new(&temp_path_str);

        let req = client.get(&task.url).header("User-Agent", "Mozilla/5.0");
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                fail_task(&id_str, e.to_string(), &app_clone);
                return;
            }
        };

        let total_size = resp.content_length().unwrap_or(0);
        let mut file = match File::create(temp_path).await {
            Ok(f) => f,
            Err(e) => {
                fail_task(&id_str, e.to_string(), &app_clone);
                return;
            }
        };

        let mut stream = resp.bytes_stream();
        let mut downloaded: u64 = 0;

        let manager_clone = app_clone.state::<DownloadManager>();

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    // Canceled or Paused
                    let _ = file.flush().await;
                    return;
                }
                chunk_opt = stream.next() => {
                    let chunk = match chunk_opt {
                        Some(Ok(chunk_bytes)) => chunk_bytes,
                        Some(Err(e)) => {
                            fail_task(&id_str, e.to_string(), &app_clone);
                            return;
                        }
                        None => break, // Download complete
                    };

                    if let Err(e) = file.write_all(&chunk).await {
                        fail_task(&id_str, e.to_string(), &app_clone);
                        return;
                    }

                    downloaded += chunk.len() as u64;
                    
                    // Emit progress
                    let progress = if total_size > 0 {
                        (downloaded as f64) / (total_size as f64)
                    } else {
                        0.0
                    };

                    let mut tasks = manager_clone.tasks.lock().unwrap();
                    if let Some(t) = tasks.get_mut(&id_str) {
                        t.downloaded_size = downloaded;
                        t.total_size = total_size;
                        t.progress = progress;
                        
                        // Emit progress to frontend
                        let _ = app_clone.emit("download-progress", t.clone());
                    }
                }
            }
        }

        let _ = file.flush().await;
        drop(file);

        // Download succeeded, rename temp file to final file
        if let Err(e) = fs::rename(&temp_path, &task.file_path) {
            fail_task(&id_str, e.to_string(), &app_clone);
            return;
        }

        // Write Tags to Audio File
        write_audio_tags(&task.file_path, &task.song_info);

        // Update task status in manager
        let mut tasks = manager_clone.tasks.lock().unwrap();
        if let Some(t) = tasks.get_mut(&id_str) {
            t.status = "completed".to_string();
            t.progress = 1.0;
        }
        drop(tasks);
        manager_clone.save();
        manager_clone.active_downloads.lock().unwrap().remove(&id_str);

        let _ = app_clone.emit("download-status-changed", id_str);
    });

    Ok(())
}

fn fail_task(id: &str, error: String, app: &AppHandle) {
    let manager = app.state::<DownloadManager>();
    let mut tasks = manager.tasks.lock().unwrap();
    if let Some(t) = tasks.get_mut(id) {
        t.status = "failed".to_string();
    }
    drop(tasks);
    manager.save();
    manager.active_downloads.lock().unwrap().remove(id);
    let _ = app.emit("download-error", json!({ "id": id, "error": error }));
    let _ = app.emit("download-status-changed", id.to_string());
}

fn write_audio_tags(file_path: &str, song_info: &Value) {
    let path = Path::new(file_path);
    if !path.exists() {
        return;
    }

    if let Ok(mut tagged_file) = lofty::read_from_path(path) {
        if let Some(tag) = tagged_file.primary_tag_mut() {
            if let Some(name) = song_info.get("name").and_then(|v| v.as_str()) {
                tag.set_title(name.to_string());
            }
            if let Some(singer) = song_info.get("singer").and_then(|v| v.as_str()) {
                tag.set_artist(singer.to_string());
            }
            if let Some(album) = song_info.get("albumName").and_then(|v| v.as_str()) {
                tag.set_album(album.to_string());
            }
            if let Some(year) = song_info.get("year").and_then(|v| v.as_i64()) {
                tag.set_year(year as u32);
            }
            
            // If the song has album art URL, we can download it and embed it.
            // But since downloading album art is async and this is a sync function,
            // we will skip it or do it if we have local image bytes.
            
            let _ = tagged_file.save_to_path(path, WriteOptions::default());
        }
    }
}
