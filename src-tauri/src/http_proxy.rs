use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

#[derive(Deserialize)]
pub struct RequestOptions {
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<Value>,
    timeout: Option<u64>,
}

#[derive(Serialize)]
pub struct ResponseResult {
    body: Value,
    #[serde(rename = "statusCode")]
    status_code: u16,
    headers: HashMap<String, String>,
    url: String,
}

#[tauri::command]
pub async fn tauri_request(url: String, options: Option<RequestOptions>) -> Result<ResponseResult, String> {
    let client = reqwest::Client::new();

    let opt = options.unwrap_or(RequestOptions {
        method: None,
        headers: None,
        body: None,
        timeout: None,
    });

    let method = match opt.method.as_deref().unwrap_or("GET").to_uppercase().as_str() {
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "DELETE" => Method::DELETE,
        "PATCH" => Method::PATCH,
        _ => Method::GET,
    };

    let mut req = client.request(method, &url);

    // Set headers
    if let Some(headers_map) = opt.headers {
        let mut headers = HeaderMap::new();
        for (k, v) in headers_map {
            if let Ok(name) = HeaderName::from_bytes(k.as_bytes()) {
                if let Ok(value) = HeaderValue::from_str(&v) {
                    headers.insert(name, value);
                }
            }
        }
        req = req.headers(headers);
    }

    // Set body
    if let Some(body_val) = opt.body {
        if let Some(s) = body_val.as_str() {
            req = req.body(s.to_string());
        } else if body_val.is_object() || body_val.is_array() {
            req = req.json(&body_val);
        } else {
            req = req.body(body_val.to_string());
        }
    }

    // Set timeout
    if let Some(t) = opt.timeout {
        req = req.timeout(std::time::Duration::from_millis(t));
    } else {
        req = req.timeout(std::time::Duration::from_secs(15));
    }

    // Execute request
    let resp = req.send().await.map_err(|e| e.to_string())?;
    
    let status_code = resp.status().as_u16();
    let final_url = resp.url().to_string();

    // Map response headers
    let mut resp_headers = HashMap::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(val_str) = v.to_str() {
            resp_headers.insert(k.to_string(), val_str.to_string());
        }
    }

    // Try parsing as JSON first, otherwise return as String
    let content_type = resp_headers.get("content-type").cloned().unwrap_or_default().to_lowercase();
    let body = if content_type.contains("application/json") {
        resp.json::<Value>().await.unwrap_or(Value::Null)
    } else {
        let text = resp.text().await.unwrap_or_default();
        if let Ok(json_val) = serde_json::from_str::<Value>(&text) {
            json_val
        } else {
            Value::String(text)
        }
    };

    Ok(ResponseResult {
        body,
        status_code,
        headers: resp_headers,
        url: final_url,
    })
}

/// 拉取远程图片并返回 data URL。
/// Tauri webview 下跨域 fetch 图片会被 CORS 拦截、且无法上传到 WebGL 纹理（污染），
/// 因此封面等图片统一经此命令走 Rust 代理转为同源 data URL。
#[tauri::command]
pub async fn fetch_image_as_data_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("image request failed: {}", resp.status()));
    }

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .filter(|s| s.starts_with("image/"))
        .unwrap_or_else(|| "image/jpeg".to_string());

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(format!("data:{};base64,{}", content_type, BASE64.encode(&bytes)))
}
