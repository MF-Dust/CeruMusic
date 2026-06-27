use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;

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
    })
}
