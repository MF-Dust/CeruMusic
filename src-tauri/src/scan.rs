use std::fs;
use std::path::Path;
use walkdir::WalkDir;
use tauri::{AppHandle, Emitter, Manager};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;
use crate::db::DatabaseManager;

const AUDIO_EXTS: &[&str] = &["mp3", "flac", "wav", "aac", "m4a", "ogg", "wma"];

#[derive(serde::Serialize, Clone)]
struct ScanProgressPayload {
    progress: f64,
    current: String,
    total: usize,
    scanned: usize,
}

#[tauri::command]
pub async fn scan_directories(dirs: Vec<String>, app: AppHandle) -> Result<(), String> {
    // Run in a background thread
    tokio::spawn(async move {
        let db = app.state::<DatabaseManager>();
        
        // Step 1: Collect all audio files in the directories
        let mut files = Vec::new();
        for dir_str in &dirs {
            let path = Path::new(dir_str);
            if !path.exists() {
                continue;
            }
            for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    let ext = entry.path().extension()
                        .and_then(|s| s.to_str())
                        .map(|s| s.to_lowercase())
                        .unwrap_or_default();
                    if AUDIO_EXTS.contains(&ext.as_str()) {
                        files.push(entry.path().to_path_buf());
                    }
                }
            }
        }

        let total = files.len();
        let mut scanned = 0;

        // Step 2: Parse tags and upsert in DB
        let conn = db.get_local_conn().expect("Failed to get SQLite connection");
        for file_path in files {
            scanned += 1;
            
            // Emit progress event every 5 files or on completion
            if scanned % 5 == 0 || scanned == total {
                let payload = ScanProgressPayload {
                    progress: (scanned as f64) / (total as f64),
                    current: file_path.to_string_lossy().to_string(),
                    total,
                    scanned,
                };
                let _ = app.emit("scan-progress", payload);
            }

            // Extract metadata using lofty
            let size = fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);
            let mtime = fs::metadata(&file_path)
                .and_then(|m| m.modified())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)))
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);

            let path_str = file_path.to_string_lossy().to_string();
            let songmid = uuid::Uuid::new_v4().to_string(); // Generate mid if local

            let mut title = file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let mut artist = "未知艺术家".to_string();
            let mut album = "未知专辑".to_string();
            let mut year = 0;
            let mut duration = 0.0;
            let mut bitrate = 0;
            let mut sample_rate = 0;
            let mut channels = 0;
            let mut has_cover = 0;

            if let Ok(tagged_file) = lofty::read_from_path(&file_path) {
                let properties = tagged_file.properties();
                duration = properties.duration().as_secs_f64();
                bitrate = properties.audio_bitrate().unwrap_or(0) as i64;
                sample_rate = properties.sample_rate().unwrap_or(0) as i64;
                channels = properties.channels().unwrap_or(0) as i64;

                if let Some(tag) = tagged_file.primary_tag() {
                    if let Some(t) = tag.title() {
                        if !t.trim().is_empty() {
                            title = t.to_string();
                        }
                    }
                    if let Some(a) = tag.artist() {
                        if !a.trim().is_empty() {
                            artist = a.to_string();
                        }
                    }
                    if let Some(al) = tag.album() {
                        if !al.trim().is_empty() {
                            album = al.to_string();
                        }
                    }
                    year = tag.year().unwrap_or(0) as i64;
                    has_cover = if tag.pictures().is_empty() { 0 } else { 1 };
                }
            }

            // Insert or replace in DB
            let _ = conn.execute(
                "INSERT OR REPLACE INTO tracks (
                    songmid, path, url, singer, name, albumName, albumId, source, interval,
                    hasCover, coverKey, year, lrc, types, _types, typeUrl,
                    bitrate, sampleRate, channels, duration, size, mtime_ms, hash, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                    ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                    ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24
                )",
                rusqlite::params![
                    songmid,
                    path_str,
                    format!("file://{}", path_str),
                    artist,
                    title,
                    album,
                    0,
                    "local",
                    format!("{:.0}", duration),
                    has_cover,
                    "",
                    year,
                    "",
                    "[]",
                    "{}",
                    "{}",
                    bitrate,
                    sample_rate,
                    channels,
                    duration,
                    size as i64,
                    mtime,
                    "",
                    chrono::Utc::now().timestamp_millis()
                ],
            );
        }

        // Set the scanned directories
        let _ = conn.execute("DELETE FROM dirs", []);
        for d in &dirs {
            let _ = conn.execute("INSERT OR REPLACE INTO dirs (path) VALUES (?)", [d]);
        }

        // Emit completed event
        let _ = app.emit("scan-completed", ());
    });

    Ok(())
}
