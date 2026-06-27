use std::fs;
use std::path::PathBuf;
use rusqlite::{params, Connection, Result};
use serde_json::Value;
use tauri::{AppHandle, Manager};

pub struct DatabaseManager {
    local_music_path: PathBuf,
    playlists_path: PathBuf,
}

impl DatabaseManager {
    pub fn new(app: &AppHandle) -> Self {
        let path = app.path().app_local_data_dir().unwrap_or_else(|_| PathBuf::from("."));
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }

        let local_music_path = path.join("local-music.db");
        let playlists_path = path.join("playlists.db");

        let manager = Self {
            local_music_path,
            playlists_path,
        };

        manager.init_databases().expect("Failed to initialize SQLite databases");
        manager
    }

    pub fn get_local_conn(&self) -> Result<Connection> {
        let conn = Connection::open(&self.local_music_path)?;
        conn.execute("PRAGMA journal_mode = WAL", [])?;
        conn.execute("PRAGMA synchronous = NORMAL", [])?;
        Ok(conn)
    }

    fn get_playlist_conn(&self) -> Result<Connection> {
        let conn = Connection::open(&self.playlists_path)?;
        conn.execute("PRAGMA journal_mode = WAL", [])?;
        conn.execute("PRAGMA synchronous = NORMAL", [])?;
        conn.execute("PRAGMA foreign_keys = ON", [])?;
        Ok(conn)
    }

    fn init_databases(&self) -> Result<()> {
        // Init local-music.db
        let conn_local = self.get_local_conn()?;
        conn_local.execute(
            "CREATE TABLE IF NOT EXISTS tracks (
                songmid      TEXT PRIMARY KEY,
                path         TEXT NOT NULL UNIQUE,
                url          TEXT,
                singer       TEXT DEFAULT '',
                name         TEXT DEFAULT '',
                albumName    TEXT DEFAULT '',
                albumId      INTEGER DEFAULT 0,
                source       TEXT DEFAULT 'local',
                interval     TEXT DEFAULT '',
                hasCover     INTEGER DEFAULT 0,
                coverKey     TEXT,
                year         INTEGER DEFAULT 0,
                lrc          TEXT,
                types        TEXT DEFAULT '[]',
                _types       TEXT DEFAULT '{}',
                typeUrl      TEXT DEFAULT '{}',
                bitrate      INTEGER DEFAULT 0,
                sampleRate   INTEGER DEFAULT 0,
                channels     INTEGER DEFAULT 0,
                duration     REAL DEFAULT 0,
                size         INTEGER DEFAULT 0,
                mtime_ms     INTEGER DEFAULT 0,
                hash         TEXT,
                updated_at   INTEGER NOT NULL
            );",
            [],
        )?;
        conn_local.execute("CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);", [])?;
        conn_local.execute("CREATE TABLE IF NOT EXISTS dirs (path TEXT PRIMARY KEY);", [])?;

        // Init playlists.db
        let conn_playlists = self.get_playlist_conn()?;
        conn_playlists.execute(
            "CREATE TABLE IF NOT EXISTS playlists (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                description  TEXT DEFAULT '',
                coverImgUrl  TEXT DEFAULT '',
                source       TEXT DEFAULT 'local',
                meta         TEXT DEFAULT '{}',
                createTime   TEXT NOT NULL,
                updateTime   TEXT NOT NULL
            );",
            [],
        )?;
        conn_playlists.execute(
            "CREATE TABLE IF NOT EXISTS playlist_songs (
                playlist_id  TEXT NOT NULL,
                songmid      TEXT NOT NULL,
                position     INTEGER NOT NULL,
                data         TEXT NOT NULL,
                name         TEXT DEFAULT '',
                singer       TEXT DEFAULT '',
                albumName    TEXT DEFAULT '',
                img          TEXT DEFAULT '',
                PRIMARY KEY (playlist_id, songmid),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
            );",
            [],
        )?;

        Ok(())
    }
}

// ==================== LOCAL MUSIC COMMANDS ====================

#[tauri::command]
pub fn db_get_dirs(app: AppHandle) -> Result<Vec<String>, String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_local_conn().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT path FROM dirs").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    for r in rows {
        if let Ok(path) = r {
            list.push(path);
        }
    }
    Ok(list)
}

#[tauri::command]
pub fn db_set_dirs(dirs: Vec<String>, app: AppHandle) -> Result<(), String> {
    let db = app.state::<DatabaseManager>();
    let mut conn = db.get_local_conn().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM dirs", []).map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare("INSERT OR REPLACE INTO dirs (path) VALUES (?)").map_err(|e| e.to_string())?;
        for d in dirs {
            stmt.execute([d]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_tracks_get_all(app: AppHandle) -> Result<Vec<Value>, String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_local_conn().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT * FROM tracks").map_err(|e| e.to_string())?;
    
    // We can map SQLite columns directly to JSON Value
    let names: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map([], |row| {
        let mut map = serde_json::Map::new();
        for (i, name) in names.iter().enumerate() {
            let val: Value = match row.get_ref(i) {
                Ok(rusqlite::types::ValueRef::Null) => Value::Null,
                Ok(rusqlite::types::ValueRef::Integer(n)) => Value::Number(n.into()),
                Ok(rusqlite::types::ValueRef::Real(n)) => serde_json::Number::from_f64(n)
                    .map(Value::Number)
                    .unwrap_or(Value::Null),
                Ok(rusqlite::types::ValueRef::Text(s)) => {
                    let s_str = std::str::from_utf8(s).unwrap_or("");
                    if s_str.starts_with('{') || s_str.starts_with('[') {
                        serde_json::from_str(s_str).unwrap_or(Value::String(s_str.to_string()))
                    } else {
                        Value::String(s_str.to_string())
                    }
                }
                Ok(rusqlite::types::ValueRef::Blob(b)) => Value::String(String::from_utf8_lossy(b).into_owned()),
                Err(_) => Value::Null,
            };
            map.insert(name.clone(), val);
        }
        Ok(Value::Object(map))
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        if let Ok(v) = r {
            list.push(v);
        }
    }
    Ok(list)
}

#[tauri::command]
pub fn db_track_upsert(track: Value, app: AppHandle) -> Result<(), String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_local_conn().map_err(|e| e.to_string())?;
    
    let obj = track.as_object().ok_or("Track must be a JSON object")?;
    
    conn.execute(
        "INSERT OR REPLACE INTO tracks (
            songmid, path, url, singer, name, albumName, albumId, source, interval,
            hasCover, coverKey, year, lrc, types, _types, typeUrl,
            bitrate, sampleRate, channels, duration, size, mtime_ms, hash, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?13, ?14, ?15, ?16,
            ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24
        )",
        params![
            obj.get("songmid").and_then(|v| v.as_str()).unwrap_or(""),
            obj.get("path").and_then(|v| v.as_str()).unwrap_or(""),
            obj.get("url").and_then(|v| v.as_str()),
            obj.get("singer").and_then(|v| v.as_str()).unwrap_or(""),
            obj.get("name").and_then(|v| v.as_str()).unwrap_or(""),
            obj.get("albumName").and_then(|v| v.as_str()).unwrap_or(""),
            obj.get("albumId").and_then(|v| v.as_i64()).unwrap_or(0),
            obj.get("source").and_then(|v| v.as_str()).unwrap_or("local"),
            obj.get("interval").and_then(|v| v.as_str()).unwrap_or(""),
            obj.get("hasCover").and_then(|v| v.as_i64()).unwrap_or(0),
            obj.get("coverKey").and_then(|v| v.as_str()),
            obj.get("year").and_then(|v| v.as_i64()).unwrap_or(0),
            obj.get("lrc").and_then(|v| v.as_str()),
            obj.get("types").map(|v| v.to_string()).unwrap_or_else(|| "[]".to_string()),
            obj.get("_types").map(|v| v.to_string()).unwrap_or_else(|| "{}".to_string()),
            obj.get("typeUrl").map(|v| v.to_string()).unwrap_or_else(|| "{}".to_string()),
            obj.get("bitrate").and_then(|v| v.as_i64()).unwrap_or(0),
            obj.get("sampleRate").and_then(|v| v.as_i64()).unwrap_or(0),
            obj.get("channels").and_then(|v| v.as_i64()).unwrap_or(0),
            obj.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0),
            obj.get("size").and_then(|v| v.as_i64()).unwrap_or(0),
            obj.get("mtime_ms").and_then(|v| v.as_i64()).unwrap_or(0),
            obj.get("hash").and_then(|v| v.as_str()),
            chrono::Utc::now().timestamp_millis()
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn db_track_delete_by_path(path: String, app: AppHandle) -> Result<(), String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_local_conn().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tracks WHERE path = ?", [path]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_tracks_clear(app: AppHandle) -> Result<(), String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_local_conn().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tracks", []).map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== PLAYLIST COMMANDS ====================

#[tauri::command]
pub fn db_playlist_create(playlist: Value, app: AppHandle) -> Result<(), String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_playlist_conn().map_err(|e| e.to_string())?;
    
    let obj = playlist.as_object().ok_or("Playlist must be a JSON object")?;
    let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let desc = obj.get("description").and_then(|v| v.as_str()).unwrap_or("");
    let cover = obj.get("coverImgUrl").and_then(|v| v.as_str()).unwrap_or("");
    let src = obj.get("source").and_then(|v| v.as_str()).unwrap_or("local");
    let meta = obj.get("meta").map(|v| v.to_string()).unwrap_or_else(|| "{}".to_string());
    let create_time = obj.get("createTime").and_then(|v| v.as_str()).unwrap_or("");
    let update_time = obj.get("updateTime").and_then(|v| v.as_str()).unwrap_or("");

    conn.execute(
        "INSERT INTO playlists (id, name, description, coverImgUrl, source, meta, createTime, updateTime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, name, desc, cover, src, meta, create_time, update_time],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn db_playlist_get_all(app: AppHandle) -> Result<Vec<Value>, String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_playlist_conn().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT * FROM playlists").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        let meta_str: String = row.get(5)?;
        let meta_val: Value = serde_json::from_str(&meta_str).unwrap_or(Value::Null);

        let mut map = serde_json::Map::new();
        map.insert("id".to_string(), Value::String(row.get(0)?));
        map.insert("name".to_string(), Value::String(row.get(1)?));
        map.insert("description".to_string(), Value::String(row.get(2)?));
        map.insert("coverImgUrl".to_string(), Value::String(row.get(3)?));
        map.insert("source".to_string(), Value::String(row.get(4)?));
        map.insert("meta".to_string(), meta_val);
        map.insert("createTime".to_string(), Value::String(row.get(6)?));
        map.insert("updateTime".to_string(), Value::String(row.get(7)?));
        Ok(Value::Object(map))
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        if let Ok(v) = r {
            list.push(v);
        }
    }
    Ok(list)
}

#[tauri::command]
pub fn db_playlist_get_by_id(id: String, app: AppHandle) -> Result<Value, String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_playlist_conn().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT * FROM playlists WHERE id = ?").map_err(|e| e.to_string())?;
    let row = stmt.query_row([id], |row| {
        let meta_str: String = row.get(5)?;
        let meta_val: Value = serde_json::from_str(&meta_str).unwrap_or(Value::Null);

        let mut map = serde_json::Map::new();
        map.insert("id".to_string(), Value::String(row.get(0)?));
        map.insert("name".to_string(), Value::String(row.get(1)?));
        map.insert("description".to_string(), Value::String(row.get(2)?));
        map.insert("coverImgUrl".to_string(), Value::String(row.get(3)?));
        map.insert("source".to_string(), Value::String(row.get(4)?));
        map.insert("meta".to_string(), meta_val);
        map.insert("createTime".to_string(), Value::String(row.get(6)?));
        map.insert("updateTime".to_string(), Value::String(row.get(7)?));
        Ok(Value::Object(map))
    });

    match row {
        Ok(v) => Ok(v),
        Err(_) => Ok(Value::Null),
    }
}

#[tauri::command]
pub fn db_playlist_delete(id: String, app: AppHandle) -> Result<(), String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_playlist_conn().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM playlists WHERE id = ?", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_playlist_songs_add(playlist_id: String, songs: Vec<Value>, app: AppHandle) -> Result<i32, String> {
    let db = app.state::<DatabaseManager>();
    let mut conn = db.get_playlist_conn().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut added = 0;
    {
        // Get max position
        let max_pos: i32 = tx.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM playlist_songs WHERE playlist_id = ?",
            [&playlist_id],
            |row| row.get(0),
        ).unwrap_or(-1);

        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO playlist_songs (playlist_id, songmid, position, data, name, singer, albumName, img)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).map_err(|e| e.to_string())?;

        for (idx, song) in songs.into_iter().enumerate() {
            let obj = song.as_object().ok_or("Each song must be a JSON object")?;
            let songmid = obj.get("songmid").map(|v| v.to_string()).unwrap_or_default();
            let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let singer = obj.get("singer").and_then(|v| v.as_str()).unwrap_or("");
            let album = obj.get("albumName").and_then(|v| v.as_str()).unwrap_or("");
            let img = obj.get("img").and_then(|v| v.as_str()).unwrap_or("");
            let data_str = serde_json::to_string(&song).unwrap_or_default();

            stmt.execute(params![
                playlist_id,
                songmid,
                max_pos + 1 + (idx as i32),
                data_str,
                name,
                singer,
                album,
                img
            ]).map_err(|e| e.to_string())?;
            added += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(added)
}

#[tauri::command]
pub fn db_playlist_songs_get(playlist_id: String, app: AppHandle) -> Result<Vec<Value>, String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_playlist_conn().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT data FROM playlist_songs WHERE playlist_id = ? ORDER BY position ASC"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([playlist_id], |row| {
        let s: String = row.get(0)?;
        Ok(serde_json::from_str::<Value>(&s).unwrap_or(Value::Null))
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        if let Ok(v) = r {
            list.push(v);
        }
    }
    Ok(list)
}

#[tauri::command]
pub fn db_playlist_song_remove(playlist_id: String, songmid: String, app: AppHandle) -> Result<(), String> {
    let db = app.state::<DatabaseManager>();
    let conn = db.get_playlist_conn().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM playlist_songs WHERE playlist_id = ? AND songmid = ?",
        [playlist_id, songmid],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
