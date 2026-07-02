//! Cloud coaching providers (Claude / OpenAI / OpenRouter / Gemini). This is the opt-in path that trades the
//! offline guarantee for a stronger model: the caller redacts the prompt before invoking, the UI
//! carries a data-leaves-device warning, and the API key is read server-side (secrets.rs) and never
//! returned to the webview. One `cloud_generate` command fans out to each provider's REST shape.

use std::io::Read;
use std::sync::Arc;

use serde_json::{json, Value};

use crate::secrets::api_key;

fn agent() -> Result<ureq::Agent, String> {
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    Ok(ureq::builder().tls_connector(Arc::new(tls)).build())
}

/// POST a JSON body and return the response text, mapping the common auth/rate failures to guidance.
fn post_json(agent: &ureq::Agent, url: &str, headers: &[(&str, &str)], body: &Value) -> Result<String, String> {
    let mut req = agent.post(url).set("content-type", "application/json");
    for (k, v) in headers {
        req = req.set(k, v);
    }
    let resp = req.send_string(&body.to_string()).map_err(|e| match e {
        ureq::Error::Status(401, _) | ureq::Error::Status(403, _) => "the provider rejected the API key — check it in settings.".to_string(),
        ureq::Error::Status(429, _) => "the provider is rate-limiting — try again shortly.".to_string(),
        ureq::Error::Status(c, r) => {
            let detail = r.into_string().unwrap_or_default();
            format!("provider returned {c}: {}", detail.chars().take(200).collect::<String>())
        }
        other => other.to_string(),
    })?;
    let mut bytes = Vec::new();
    resp.into_reader().take(5_000_000).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn parse(body: &str) -> Result<Value, String> {
    serde_json::from_str(body).map_err(|e| format!("couldn't parse the provider response: {e}"))
}

/// Generate a coaching completion from a cloud provider. `system`/`prompt` are already redacted by the
/// caller. Returns the model's text output (JSON when the prompt asks for it; the caller parses it).
#[tauri::command]
pub fn cloud_generate(provider: String, model: String, system: String, prompt: String) -> Result<String, String> {
    let key = api_key(&provider).ok_or("no API key set for this provider — add one in settings.")?;
    let agent = agent()?;
    match provider.as_str() {
        "anthropic" => {
            let body = json!({
                "model": model,
                "max_tokens": 1024,
                "system": system,
                "messages": [{ "role": "user", "content": prompt }],
            });
            let out = post_json(&agent, "https://api.anthropic.com/v1/messages", &[("x-api-key", &key), ("anthropic-version", "2023-06-01")], &body)?;
            let v = parse(&out)?;
            v["content"]
                .as_array()
                .and_then(|blocks| blocks.iter().find_map(|b| b.get("text").and_then(|t| t.as_str())))
                .map(String::from)
                .ok_or_else(|| "no text in the Claude response.".into())
        }
        // OpenRouter is OpenAI-compatible (same /chat/completions shape + Bearer auth), just a different
        // base URL — so both share one arm.
        "openai" | "openrouter" => {
            let openrouter = provider == "openrouter";
            let url = if openrouter {
                "https://openrouter.ai/api/v1/chat/completions"
            } else {
                "https://api.openai.com/v1/chat/completions"
            };
            let mut body = json!({
                "model": model,
                "messages": [{ "role": "system", "content": system }, { "role": "user", "content": prompt }],
            });
            // OpenAI supports strict JSON mode; OpenRouter fans out to many models that may not, so there
            // we lean on the system prompt + the client's JSON extraction instead.
            if !openrouter {
                body["response_format"] = json!({ "type": "json_object" });
            }
            let auth = format!("Bearer {key}");
            let mut headers: Vec<(&str, &str)> = vec![("authorization", &auth)];
            if openrouter {
                headers.push(("x-title", "The Watcher")); // app attribution on OpenRouter's dashboard
            }
            let out = post_json(&agent, url, &headers, &body)?;
            let v = parse(&out)?;
            v["choices"][0]["message"]["content"]
                .as_str()
                .map(String::from)
                .ok_or_else(|| "no content in the response.".into())
        }
        "gemini" => {
            let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}");
            let body = json!({
                "system_instruction": { "parts": [{ "text": system }] },
                "contents": [{ "parts": [{ "text": prompt }] }],
                "generationConfig": { "response_mime_type": "application/json" },
            });
            let out = post_json(&agent, &url, &[], &body)?;
            let v = parse(&out)?;
            v["candidates"][0]["content"]["parts"][0]["text"]
                .as_str()
                .map(String::from)
                .ok_or_else(|| "no text in the Gemini response.".into())
        }
        _ => Err(format!("unknown provider: {provider}")),
    }
}
