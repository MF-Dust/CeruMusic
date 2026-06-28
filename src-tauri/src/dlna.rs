// DLNA / UPnP MediaRenderer 投屏后端。
//
// 复刻 Electron 版 events/dlna.ts 的能力：
//   - SSDP 发现局域网内的 MediaRenderer 设备
//   - 解析设备描述，拿到 AVTransport / RenderingControl 控制地址
//   - 通过 SOAP 控制：SetAVTransportURI+Play / Pause / Stop / Seek / 音量 / 进度
//   - 一个本地 HTTP 文件服务器，把本地音乐文件（file://）暴露给投屏设备拉取
//
// 在线音源一般是公网 URL，设备可直接拉取，无需本地服务器。

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Clone, Serialize, Default)]
pub struct DlnaDevice {
    pub usn: String,
    pub location: String,
    pub address: String,
    pub name: String,
    #[serde(skip)]
    pub av_control_url: String,
    #[serde(skip)]
    pub rc_control_url: String,
}

#[derive(Clone, Default)]
struct CurrentRenderer {
    av_control_url: String,
    rc_control_url: String,
}

static DEVICES: OnceLock<Mutex<HashMap<String, DlnaDevice>>> = OnceLock::new();
static CURRENT: OnceLock<Mutex<Option<CurrentRenderer>>> = OnceLock::new();
static LOCAL_FILE: OnceLock<Mutex<String>> = OnceLock::new();
static LOCAL_SERVER_PORT: OnceLock<u16> = OnceLock::new();

fn devices() -> &'static Mutex<HashMap<String, DlnaDevice>> {
    DEVICES.get_or_init(|| Mutex::new(HashMap::new()))
}
fn current() -> &'static Mutex<Option<CurrentRenderer>> {
    CURRENT.get_or_init(|| Mutex::new(None))
}
fn local_file() -> &'static Mutex<String> {
    LOCAL_FILE.get_or_init(|| Mutex::new(String::new()))
}

// ---------------- 本地文件服务器 ----------------

fn local_ip() -> String {
    // 连接一个外网地址（不会真正发包）以得到出口网卡 IP。
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

fn ensure_local_server() -> u16 {
    *LOCAL_SERVER_PORT.get_or_init(|| {
        let listener = match TcpListener::bind("0.0.0.0:0") {
            Ok(l) => l,
            Err(_) => return 0,
        };
        let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                std::thread::spawn(move || {
                    let _ = handle_local_request(stream);
                });
            }
        });
        port
    })
}

fn handle_local_request(mut stream: TcpStream) -> std::io::Result<()> {
    let mut buf = [0u8; 2048];
    let n = stream.read(&mut buf)?;
    if n == 0 {
        return Ok(());
    }
    let req = String::from_utf8_lossy(&buf[..n]);
    let is_head = req.starts_with("HEAD");
    let range = req
        .lines()
        .find(|l| l.to_ascii_lowercase().starts_with("range:"))
        .and_then(|l| l.splitn(2, ':').nth(1))
        .map(|v| v.trim().to_string());

    let path = { local_file().lock().unwrap().clone() };
    if path.is_empty() || !std::path::Path::new(&path).exists() {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
        return Ok(());
    }

    let mut file = std::fs::File::open(&path)?;
    let total = file.metadata()?.len();
    let ctype = "audio/mpeg";

    // 解析 Range: bytes=start-end
    let (start, end) = if let Some(r) = &range {
        let spec = r.trim_start_matches("bytes=");
        let mut parts = spec.splitn(2, '-');
        let s = parts.next().unwrap_or("").trim().parse::<u64>().unwrap_or(0);
        let e = parts
            .next()
            .unwrap_or("")
            .trim()
            .parse::<u64>()
            .unwrap_or(total.saturating_sub(1));
        (s, e.min(total.saturating_sub(1)))
    } else {
        (0, total.saturating_sub(1))
    };

    if is_head {
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\n\r\n",
            total, ctype
        );
        stream.write_all(header.as_bytes())?;
        return Ok(());
    }

    let chunk = end - start + 1;
    let header = if range.is_some() {
        format!(
            "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {}-{}/{}\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\nContent-Type: {}\r\n\r\n",
            start, end, total, chunk, ctype
        )
    } else {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\n\r\n",
            total, ctype
        )
    };
    stream.write_all(header.as_bytes())?;

    file.seek(SeekFrom::Start(start))?;
    let mut remaining = chunk;
    let mut buf = [0u8; 64 * 1024];
    while remaining > 0 {
        let want = buf.len().min(remaining as usize);
        let read = file.read(&mut buf[..want])?;
        if read == 0 {
            break;
        }
        if stream.write_all(&buf[..read]).is_err() {
            break;
        }
        remaining -= read as u64;
    }
    Ok(())
}

// ---------------- SSDP 发现 ----------------

fn parse_headers(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in text.lines() {
        if let Some(idx) = line.find(':') {
            let k = line[..idx].trim().to_ascii_uppercase();
            let v = line[idx + 1..].trim().to_string();
            map.insert(k, v);
        }
    }
    map
}

fn extract_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml[start..end].trim().to_string())
}

fn resolve_url(location: &str, url_base: &Option<String>, control: &str) -> String {
    if control.starts_with("http") {
        return control.to_string();
    }
    if let Some(base) = url_base {
        let base = base.trim_end_matches('/');
        let ctrl = control.trim_start_matches('/');
        return format!("{}/{}", base, ctrl);
    }
    // 用 location 的 scheme://host:port 作为基址
    if let Ok(parsed) = url::Url::parse(location) {
        let origin = format!(
            "{}://{}",
            parsed.scheme(),
            parsed.host_str().unwrap_or("")
        );
        let origin = if let Some(port) = parsed.port() {
            format!("{}:{}", origin, port)
        } else {
            origin
        };
        let ctrl = control.trim_start_matches('/');
        return format!("{}/{}", origin, ctrl);
    }
    control.to_string()
}

/// 解析设备描述 XML，提取 friendlyName 与各服务的控制地址。
async fn fetch_device_detail(location: &str, address: &str, usn: &str, server: &str) -> Option<DlnaDevice> {
    let client = reqwest::Client::new();
    let body = client.get(location).send().await.ok()?.text().await.ok()?;

    let name = extract_tag(&body, "friendlyName").unwrap_or_else(|| {
        if server.is_empty() {
            address.to_string()
        } else {
            server.to_string()
        }
    });
    let url_base = extract_tag(&body, "URLBase");

    let mut av = String::new();
    let mut rc = String::new();
    // 逐个 <service> 块解析 serviceType + controlURL
    for chunk in body.split("<service>").skip(1) {
        let service = chunk.split("</service>").next().unwrap_or("");
        let stype = extract_tag(service, "serviceType").unwrap_or_default();
        let control = extract_tag(service, "controlURL").unwrap_or_default();
        if control.is_empty() {
            continue;
        }
        let resolved = resolve_url(location, &url_base, &control);
        if stype.contains("AVTransport") {
            av = resolved;
        } else if stype.contains("RenderingControl") {
            rc = resolved;
        }
    }

    Some(DlnaDevice {
        usn: usn.to_string(),
        location: location.to_string(),
        address: address.to_string(),
        name,
        av_control_url: av,
        rc_control_url: rc,
    })
}

#[tauri::command]
pub async fn dlna_start_search() -> Result<bool, String> {
    devices().lock().unwrap().clear();

    // SSDP M-SEARCH（阻塞 UDP 收发放到 blocking 线程）。
    let responses = tokio::task::spawn_blocking(|| -> Vec<HashMap<String, String>> {
        let mut out = Vec::new();
        let socket = match UdpSocket::bind("0.0.0.0:0") {
            Ok(s) => s,
            Err(_) => return out,
        };
        let _ = socket.set_read_timeout(Some(Duration::from_millis(800)));
        let msg = "M-SEARCH * HTTP/1.1\r\n\
                   HOST: 239.255.255.250:1900\r\n\
                   MAN: \"ssdp:discover\"\r\n\
                   MX: 2\r\n\
                   ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";
        let _ = socket.send_to(msg.as_bytes(), "239.255.255.250:1900");

        let deadline = Instant::now() + Duration::from_millis(3000);
        let mut buf = [0u8; 2048];
        while Instant::now() < deadline {
            match socket.recv_from(&mut buf) {
                Ok((n, addr)) => {
                    let text = String::from_utf8_lossy(&buf[..n]);
                    let mut headers = parse_headers(&text);
                    headers.insert("__ADDR__".into(), addr.ip().to_string());
                    out.push(headers);
                }
                Err(_) => continue,
            }
        }
        out
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut seen = std::collections::HashSet::new();
    for headers in responses {
        let usn = headers.get("USN").cloned().unwrap_or_default();
        let location = headers.get("LOCATION").cloned().unwrap_or_default();
        if usn.is_empty() || location.is_empty() || !seen.insert(usn.clone()) {
            continue;
        }
        let address = headers.get("__ADDR__").cloned().unwrap_or_default();
        let server = headers.get("SERVER").cloned().unwrap_or_default();
        if let Some(dev) = fetch_device_detail(&location, &address, &usn, &server).await {
            devices().lock().unwrap().insert(usn, dev);
        }
    }

    Ok(true)
}

#[tauri::command]
pub fn dlna_stop_search() -> bool {
    true
}

#[tauri::command]
pub fn dlna_get_devices() -> Vec<DlnaDevice> {
    devices().lock().unwrap().values().cloned().collect()
}

// ---------------- SOAP 控制 ----------------

async fn soap_call(
    control_url: &str,
    service: &str,
    action: &str,
    args: &str,
) -> Result<String, String> {
    if control_url.is_empty() {
        return Err("missing control url".into());
    }
    let envelope = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" \
s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">\
<s:Body><u:{action} xmlns:u=\"{service}\">{args}</u:{action}></s:Body></s:Envelope>",
        action = action,
        service = service,
        args = args
    );
    let soap_action = format!("\"{}#{}\"", service, action);
    let client = reqwest::Client::new();
    let resp = client
        .post(control_url)
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .header("SOAPAction", soap_action)
        .body(envelope)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

const AV_SERVICE: &str = "urn:schemas-upnp-org:service:AVTransport:1";
const RC_SERVICE: &str = "urn:schemas-upnp-org:service:RenderingControl:1";

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn av_url() -> Result<String, String> {
    current()
        .lock()
        .unwrap()
        .as_ref()
        .map(|c| c.av_control_url.clone())
        .ok_or_else(|| "no current renderer".to_string())
}

fn rc_url() -> Result<String, String> {
    current()
        .lock()
        .unwrap()
        .as_ref()
        .map(|c| c.rc_control_url.clone())
        .ok_or_else(|| "no current renderer".to_string())
}

#[tauri::command]
pub async fn dlna_play(args: Value) -> Result<bool, String> {
    let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let location = args.get("location").and_then(|v| v.as_str()).unwrap_or("");
    let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("CeruMusic");

    // 找到设备的控制地址（优先用已发现的设备，否则现拉一次描述）。
    let device = {
        let map = devices().lock().unwrap();
        map.values().find(|d| d.location == location).cloned()
    };
    let device = match device {
        Some(d) => d,
        None => fetch_device_detail(location, "", "", "")
            .await
            .ok_or_else(|| "device not reachable".to_string())?,
    };

    *current().lock().unwrap() = Some(CurrentRenderer {
        av_control_url: device.av_control_url.clone(),
        rc_control_url: device.rc_control_url.clone(),
    });

    // 计算实际播放 URL：本地文件走本地服务器，其它（公网 http）直接给设备。
    let play_url = if url.starts_with("file://") || !url.starts_with("http") {
        let path = url::Url::parse(url)
            .ok()
            .and_then(|u| u.to_file_path().ok())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| url.to_string());
        *local_file().lock().unwrap() = path;
        let port = ensure_local_server();
        format!("http://{}:{}/audio.mp3", local_ip(), port)
    } else {
        url.to_string()
    };

    let metadata = format!(
        "&lt;DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" \
xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"&gt;\
&lt;item id=\"0\" parentID=\"-1\" restricted=\"1\"&gt;\
&lt;dc:title&gt;{}&lt;/dc:title&gt;\
&lt;upnp:class&gt;object.item.audioItem.musicTrack&lt;/upnp:class&gt;\
&lt;res protocolInfo=\"http-get:*:audio/mpeg:*\"&gt;{}&lt;/res&gt;\
&lt;/item&gt;&lt;/DIDL-Lite&gt;",
        xml_escape(title),
        xml_escape(&play_url)
    );

    let av = device.av_control_url.clone();
    let set_args = format!(
        "<InstanceID>0</InstanceID><CurrentURI>{}</CurrentURI><CurrentURIMetaData>{}</CurrentURIMetaData>",
        xml_escape(&play_url),
        metadata
    );
    soap_call(&av, AV_SERVICE, "SetAVTransportURI", &set_args).await?;
    let play_args = "<InstanceID>0</InstanceID><Speed>1</Speed>";
    let _ = soap_call(&av, AV_SERVICE, "Play", play_args).await;
    Ok(true)
}

#[tauri::command]
pub async fn dlna_pause() -> Result<bool, String> {
    let av = av_url()?;
    soap_call(&av, AV_SERVICE, "Pause", "<InstanceID>0</InstanceID>").await?;
    Ok(true)
}

#[tauri::command]
pub async fn dlna_resume() -> Result<bool, String> {
    let av = av_url()?;
    soap_call(
        &av,
        AV_SERVICE,
        "Play",
        "<InstanceID>0</InstanceID><Speed>1</Speed>",
    )
    .await?;
    Ok(true)
}

#[tauri::command]
pub async fn dlna_stop() -> Result<bool, String> {
    let av = av_url()?;
    soap_call(&av, AV_SERVICE, "Stop", "<InstanceID>0</InstanceID>").await?;
    *current().lock().unwrap() = None;
    Ok(true)
}

fn secs_to_hms(seconds: i64) -> String {
    let s = seconds.max(0);
    format!("{:02}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
}

fn hms_to_secs(hms: &str) -> i64 {
    let parts: Vec<i64> = hms.split(':').filter_map(|p| p.trim().parse().ok()).collect();
    match parts.len() {
        3 => parts[0] * 3600 + parts[1] * 60 + parts[2],
        2 => parts[0] * 60 + parts[1],
        1 => parts[0],
        _ => 0,
    }
}

#[tauri::command]
pub async fn dlna_seek(seconds: i64) -> Result<bool, String> {
    let av = av_url()?;
    let target = secs_to_hms(seconds);
    let args = format!(
        "<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>{}</Target>",
        target
    );
    let _ = soap_call(&av, AV_SERVICE, "Seek", &args).await;
    Ok(true)
}

#[tauri::command]
pub async fn dlna_get_volume() -> Result<i64, String> {
    let rc = rc_url()?;
    let body = soap_call(
        &rc,
        RC_SERVICE,
        "GetVolume",
        "<InstanceID>0</InstanceID><Channel>Master</Channel>",
    )
    .await?;
    Ok(extract_tag(&body, "CurrentVolume")
        .and_then(|v| v.parse().ok())
        .unwrap_or(100))
}

#[tauri::command]
pub async fn dlna_set_volume(volume: i64) -> Result<bool, String> {
    let rc = rc_url()?;
    let args = format!(
        "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>{}</DesiredVolume>",
        volume.clamp(0, 100)
    );
    soap_call(&rc, RC_SERVICE, "SetVolume", &args).await?;
    Ok(true)
}

#[tauri::command]
pub async fn dlna_get_position() -> Result<i64, String> {
    let av = av_url()?;
    let body = soap_call(
        &av,
        AV_SERVICE,
        "GetPositionInfo",
        "<InstanceID>0</InstanceID>",
    )
    .await?;
    Ok(extract_tag(&body, "RelTime").map(|t| hms_to_secs(&t)).unwrap_or(0))
}
