use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::{Accessor, ItemKey};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

use crate::db::DatabaseManager;

const AUDIO_EXTS: &[&str] = &["mp3", "flac", "wav", "aac", "m4a", "ogg", "wma"];

#[derive(Clone)]
struct TrackStat {
    songmid: String,
    size: i64,
    mtime_ms: i64,
}

#[derive(Serialize, Clone)]
struct ScanProgressPayload {
    processed: usize,
    total: usize,
    scanned: usize,
    reused: usize,
}

fn norm_path(path: &str) -> String {
    path.trim_start_matches("file://")
        .replace('\\', "/")
        .to_lowercase()
}

fn md5_hex(input: &str) -> String {
    format!("{:x}", md5::compute(input.as_bytes()))
}

fn song_id_for_path(path: &str) -> String {
    md5_hex(&norm_path(path))
}

fn cover_key(file_path: &str, mtime_ms: i64) -> String {
    if mtime_ms > 0 {
        md5_hex(&format!("{}:{}", file_path, mtime_ms))
    } else {
        md5_hex(file_path)
    }
}

fn format_time(sec: f64) -> String {
    if !sec.is_finite() || sec <= 0.0 {
        return String::new();
    }
    let total = sec.floor() as u64;
    format!("{}:{:02}", total / 60, total % 60)
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| AUDIO_EXTS.contains(&s.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn collect_audio_files(dirs: &[String]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for dir in dirs {
        let path = Path::new(dir);
        if !path.exists() {
            continue;
        }
        for entry in WalkDir::new(path).into_iter().filter_map(|entry| entry.ok()) {
            if entry.file_type().is_file() && is_audio_file(entry.path()) {
                files.push(entry.path().to_path_buf());
            }
        }
    }
    files
}

fn all_stats(db: &DatabaseManager) -> Result<HashMap<String, TrackStat>, String> {
    let conn = db.get_local_conn().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT songmid, path, size, mtime_ms FROM tracks")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let path: String = row.get(1)?;
            Ok((
                path,
                TrackStat {
                    songmid: row.get(0)?,
                    size: row.get(2)?,
                    mtime_ms: row.get(3)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    for row in rows.flatten() {
        map.insert(row.0, row.1);
    }
    Ok(map)
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let types: String = row.get("types")?;
    let type_url: String = row.get("typeUrl")?;
    let underscore_types: String = row.get("_types")?;
    let has_cover: i64 = row.get("hasCover")?;
    Ok(json!({
        "songmid": row.get::<_, String>("songmid")?,
        "path": row.get::<_, String>("path")?,
        "url": row.get::<_, Option<String>>("url")?,
        "singer": row.get::<_, String>("singer")?,
        "name": row.get::<_, String>("name")?,
        "albumName": row.get::<_, String>("albumName")?,
        "albumId": row.get::<_, i64>("albumId")?,
        "source": row.get::<_, String>("source")?,
        "interval": row.get::<_, String>("interval")?,
        "img": "",
        "hasCover": has_cover != 0,
        "coverKey": row.get::<_, Option<String>>("coverKey")?,
        "year": row.get::<_, i64>("year")?,
        "lrc": row.get::<_, Option<String>>("lrc")?,
        "types": serde_json::from_str::<Value>(&types).unwrap_or_else(|_| json!([])),
        "_types": serde_json::from_str::<Value>(&underscore_types).unwrap_or_else(|_| json!({})),
        "typeUrl": serde_json::from_str::<Value>(&type_url).unwrap_or_else(|_| json!({})),
        "bitrate": row.get::<_, i64>("bitrate")?,
        "sampleRate": row.get::<_, i64>("sampleRate")?,
        "channels": row.get::<_, i64>("channels")?,
        "duration": row.get::<_, f64>("duration")?,
        "hash": row.get::<_, Option<String>>("hash")?,
    }))
}

fn get_all_items(db: &DatabaseManager) -> Result<Vec<Value>, String> {
    let conn = db.get_local_conn().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT * FROM tracks").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_item).map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

fn get_track_path(db: &DatabaseManager, songmid: &str) -> Result<Option<String>, String> {
    let conn = db.get_local_conn().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT path FROM tracks WHERE songmid = ?",
        [songmid],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn read_tag_info(file_path: &Path, include_lyrics: bool) -> Value {
    if let Ok(tagged_file) = lofty::read_from_path(file_path) {
        if let Some(tag) = tagged_file.primary_tag() {
            return json!({
                "name": tag.title().map(|v| v.to_string()).unwrap_or_default(),
                "singer": tag.artist().map(|v| v.to_string()).unwrap_or_default(),
                "albumName": tag.album().map(|v| v.to_string()).unwrap_or_default(),
                "year": tag.year().unwrap_or(0),
                "lrc": if include_lyrics {
                    tag.get_string(&ItemKey::Lyrics).unwrap_or("").to_string()
                } else {
                    String::new()
                },
            });
        }
    }
    Value::Null
}

fn cover_data_url(file_path: &Path) -> String {
    let Ok(tagged_file) = lofty::read_from_path(file_path) else {
        return String::new();
    };
    let Some(tag) = tagged_file.primary_tag() else {
        return String::new();
    };
    let Some(pic) = tag.pictures().first() else {
        return String::new();
    };
    let data = pic.data();
    let mime = if data.starts_with(b"\x89PNG") {
        "image/png"
    } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        "image/jpeg"
    };
    format!("data:{};base64,{}", mime, BASE64.encode(data))
}

#[tauri::command]
pub fn local_music_get_dirs(app: AppHandle) -> Result<Vec<String>, String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_local_conn().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT path FROM dirs").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

#[tauri::command]
pub fn local_music_set_dirs(dirs: Vec<String>, app: AppHandle) -> Result<(), String> {
    let db = app.state::<DatabaseManager>();
    let mut conn = db.get_local_conn().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM dirs", []).map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("INSERT OR IGNORE INTO dirs(path) VALUES (?)")
            .map_err(|e| e.to_string())?;
        for dir in dirs.into_iter().filter(|dir| !dir.trim().is_empty()) {
            stmt.execute([dir]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_music_get_list(app: AppHandle) -> Result<Vec<Value>, String> {
    let db = app.state::<DatabaseManager>();
    get_all_items(&db)
}

#[tauri::command]
pub fn local_music_get_url(id: String, app: AppHandle) -> Result<Value, String> {
    let db = app.state::<DatabaseManager>();
    match get_track_path(&db, &id)? {
        Some(path) => Ok(Value::String(format!("file://{}", path))),
        None => Ok(json!({ "error": "未找到本地文件" })),
    }
}

#[tauri::command]
pub fn local_music_clear_index(app: AppHandle) -> Result<Value, String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_local_conn().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tracks", []).map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn local_music_get_cover(songmid: String, app: AppHandle) -> Result<String, String> {
    let db = app.state::<DatabaseManager>();
    let Some(path) = get_track_path(&db, &songmid)? else {
        return Ok(String::new());
    };
    Ok(cover_data_url(Path::new(&path)))
}

#[tauri::command]
pub fn local_music_get_covers(track_ids: Vec<String>, app: AppHandle) -> Result<Value, String> {
    let db = app.state::<DatabaseManager>();
    let mut result = serde_json::Map::new();
    for id in track_ids {
        if let Some(path) = get_track_path(&db, &id)? {
            let data = cover_data_url(Path::new(&path));
            if !data.is_empty() {
                result.insert(id, Value::String(data));
            }
        }
    }
    Ok(Value::Object(result))
}

#[tauri::command]
pub fn local_music_get_tags(
    songmid: String,
    include_lyrics: bool,
    app: AppHandle,
) -> Result<Value, String> {
    let db = app.state::<DatabaseManager>();
    let Some(path) = get_track_path(&db, &songmid)? else {
        return Ok(Value::Null);
    };
    Ok(read_tag_info(Path::new(&path), include_lyrics))
}

#[tauri::command]
pub fn local_music_get_lyric(songmid: String, app: AppHandle) -> Result<String, String> {
    let tags = local_music_get_tags(songmid, true, app)?;
    Ok(tags
        .get("lrc")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string())
}

#[tauri::command]
pub fn local_music_write_tags(
    file_path: String,
    song_info: Value,
    tag_write_options: Value,
    app: AppHandle,
) -> Result<Value, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Ok(json!({ "success": false, "message": "文件不存在" }));
    }
    if path.extension().and_then(|s| s.to_str()).unwrap_or("").eq_ignore_ascii_case("wav") {
        return Ok(json!({ "success": false, "message": "WAV 文件不支持写入封面/歌词标签" }));
    }

    let backup_path = path.with_extension(format!(
        "{}.bak_{}",
        path.extension().and_then(|s| s.to_str()).unwrap_or("audio"),
        chrono::Utc::now().timestamp_millis()
    ));
    fs::copy(path, &backup_path).map_err(|e| e.to_string())?;

    let result = (|| -> Result<(), String> {
        let mut tagged_file = lofty::read_from_path(path).map_err(|e| e.to_string())?;
        let Some(tag) = tagged_file.primary_tag_mut() else {
            return Err("文件缺少可写标签".to_string());
        };

        if let Some(name) = song_info.get("name").and_then(|v| v.as_str()) {
            tag.set_title(name.to_string());
        }
        if let Some(singer) = song_info.get("singer").and_then(|v| v.as_str()) {
            tag.set_artist(singer.to_string());
        }
        if let Some(album) = song_info.get("albumName").and_then(|v| v.as_str()) {
            tag.set_album(album.to_string());
        }
        if let Some(year) = song_info.get("year").and_then(|v| v.as_u64()) {
            tag.set_year(year as u32);
        }
        if tag_write_options
            .get("lyrics")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            if let Some(lrc) = song_info.get("lrc").and_then(|v| v.as_str()) {
                tag.insert_text(ItemKey::Lyrics, lrc.to_string());
            }
        }
        tagged_file
            .save_to_path(path, WriteOptions::default())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();

    if let Err(err) = result {
        let _ = fs::copy(&backup_path, path);
        let _ = fs::remove_file(&backup_path);
        return Ok(json!({ "success": false, "message": err }));
    }

    let _ = fs::remove_file(&backup_path);

    let db = app.state::<DatabaseManager>();
    let p = path.to_string_lossy().to_string();
    let songmid = song_id_for_path(&p);
    let conn = db.get_local_conn().map_err(|e| e.to_string())?;
    let _ = conn.execute(
        "UPDATE tracks SET singer = COALESCE(?1, singer), name = COALESCE(?2, name), albumName = COALESCE(?3, albumName), year = COALESCE(?4, year), updated_at = ?5 WHERE songmid = ?6",
        params![
            song_info.get("singer").and_then(|v| v.as_str()),
            song_info.get("name").and_then(|v| v.as_str()),
            song_info.get("albumName").and_then(|v| v.as_str()),
            song_info.get("year").and_then(|v| v.as_i64()),
            chrono::Utc::now().timestamp_millis(),
            songmid,
        ],
    );
    let all = get_all_items(&db).unwrap_or_default();
    let _ = app.emit("local-music:scan-finished", all);
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn local_music_scan(dirs: Vec<String>, app: AppHandle) -> Result<Vec<Value>, String> {
    if dirs.is_empty() {
        return Ok(Vec::new());
    }

    let app_for_work = app.clone();
    tokio::task::spawn_blocking(move || -> Result<Vec<Value>, String> {
        let db = app_for_work.state::<DatabaseManager>();
        let existing_dirs: Vec<String> = dirs
            .into_iter()
            .filter(|dir| Path::new(dir).exists())
            .collect();
        let files = collect_audio_files(&existing_dirs);
        let stats = all_stats(&db)?;
        let total = files.len();
        let mut processed = 0;
        let mut scanned = 0;
        let mut reused = 0;
        let mut keep_paths = HashSet::new();

        let mut conn = db.get_local_conn().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut upsert = tx
                .prepare(
                    "INSERT INTO tracks (
                        songmid, path, url, singer, name, albumName, albumId, source, interval,
                        hasCover, coverKey, year, lrc, types, _types, typeUrl,
                        bitrate, sampleRate, channels, duration, size, mtime_ms, hash, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                        ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                        ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24
                    )
                    ON CONFLICT(songmid) DO UPDATE SET
                        path=excluded.path,
                        url=excluded.url,
                        singer=excluded.singer,
                        name=excluded.name,
                        albumName=excluded.albumName,
                        albumId=excluded.albumId,
                        source=excluded.source,
                        interval=excluded.interval,
                        hasCover=excluded.hasCover,
                        coverKey=excluded.coverKey,
                        year=excluded.year,
                        lrc=excluded.lrc,
                        types=excluded.types,
                        _types=excluded._types,
                        typeUrl=excluded.typeUrl,
                        bitrate=excluded.bitrate,
                        sampleRate=excluded.sampleRate,
                        channels=excluded.channels,
                        duration=excluded.duration,
                        size=excluded.size,
                        mtime_ms=excluded.mtime_ms,
                        hash=excluded.hash,
                        updated_at=excluded.updated_at",
                )
                .map_err(|e| e.to_string())?;

            for file_path in &files {
                let path_str = file_path.to_string_lossy().to_string();
                keep_paths.insert(norm_path(&path_str));
                let metadata = match fs::metadata(file_path) {
                    Ok(meta) => meta,
                    Err(_) => continue,
                };
                let size = metadata.len() as i64;
                let mtime_ms = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                let songmid = song_id_for_path(&path_str);

                if let Some(stat) = stats.get(&path_str) {
                    if stat.songmid == songmid && stat.size == size && stat.mtime_ms == mtime_ms {
                        reused += 1;
                        processed += 1;
                        if processed % 5 == 0 || processed == total {
                            let _ = app_for_work.emit(
                                "local-music:scan-progress",
                                ScanProgressPayload {
                                    processed,
                                    total,
                                    scanned,
                                    reused,
                                },
                            );
                        }
                        continue;
                    }
                }

                let mut name = file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("未知曲目")
                    .to_string();
                let mut singer = "未知艺术家".to_string();
                let mut album = "未知专辑".to_string();
                let mut year = 0_i64;
                let mut duration = 0.0_f64;
                let mut bitrate = 0_i64;
                let mut sample_rate = 0_i64;
                let mut channels = 0_i64;
                let mut has_cover = 0_i64;

                if let Ok(tagged_file) = lofty::read_from_path(file_path) {
                    let properties = tagged_file.properties();
                    duration = properties.duration().as_secs_f64();
                    bitrate = properties.audio_bitrate().unwrap_or(0) as i64;
                    sample_rate = properties.sample_rate().unwrap_or(0) as i64;
                    channels = properties.channels().unwrap_or(0) as i64;

                    if let Some(tag) = tagged_file.primary_tag() {
                        if let Some(v) = tag.title().filter(|v| !v.trim().is_empty()) {
                            name = v.to_string();
                        }
                        if let Some(v) = tag.artist().filter(|v| !v.trim().is_empty()) {
                            singer = v.to_string();
                        }
                        if let Some(v) = tag.album().filter(|v| !v.trim().is_empty()) {
                            album = v.to_string();
                        }
                        year = tag.year().unwrap_or(0) as i64;
                        has_cover = if tag.pictures().is_empty() { 0 } else { 1 };
                    }
                }

                upsert
                    .execute(params![
                        songmid,
                        path_str,
                        format!("file://{}", file_path.to_string_lossy()),
                        singer,
                        name,
                        album,
                        0_i64,
                        "local",
                        format_time(duration),
                        has_cover,
                        cover_key(&file_path.to_string_lossy(), mtime_ms),
                        year,
                        Option::<String>::None,
                        "[]",
                        "{}",
                        "{}",
                        bitrate,
                        sample_rate,
                        channels,
                        duration,
                        size,
                        mtime_ms,
                        Option::<String>::None,
                        chrono::Utc::now().timestamp_millis()
                    ])
                    .map_err(|e| e.to_string())?;

                scanned += 1;
                processed += 1;
                if processed % 5 == 0 || processed == total {
                    let _ = app_for_work.emit(
                        "local-music:scan-progress",
                        ScanProgressPayload {
                            processed,
                            total,
                            scanned,
                            reused,
                        },
                    );
                }
            }
        }

        tx.execute("DELETE FROM dirs", []).map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare("INSERT OR IGNORE INTO dirs(path) VALUES (?)")
                .map_err(|e| e.to_string())?;
            for dir in &existing_dirs {
                stmt.execute([dir]).map_err(|e| e.to_string())?;
            }
        }

        let prefixes: Vec<String> = existing_dirs
            .iter()
            .map(|dir| {
                let mut normalized = norm_path(dir);
                if !normalized.ends_with('/') {
                    normalized.push('/');
                }
                normalized
            })
            .collect();
        let mut remove_ids = Vec::new();
        {
            let mut stmt = tx
                .prepare("SELECT songmid, path FROM tracks")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?;
            for row in rows.flatten() {
                let normalized = norm_path(&row.1);
                let under_scan = prefixes.iter().any(|prefix| normalized.starts_with(prefix));
                if under_scan && !keep_paths.contains(&normalized) {
                    remove_ids.push(row.0);
                }
            }
        }
        for id in remove_ids {
            tx.execute("DELETE FROM tracks WHERE songmid = ?", [id])
                .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;

        let all = get_all_items(&db)?;
        let _ = app_for_work.emit("local-music:scan-finished", all.clone());
        Ok(all)
    })
    .await
    .map_err(|e| e.to_string())?
}
