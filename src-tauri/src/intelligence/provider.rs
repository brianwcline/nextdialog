use serde_json::json;

pub fn call_llm(
    client: &reqwest::blocking::Client,
    provider: &str,
    api_key: &str,
    api_url: &str,
    prompt: &str,
) -> Result<String, String> {
    let system = "Summarize what this terminal session just did in 5-10 words. Be specific. Reply with only the summary.";

    match provider {
        "anthropic" => call_anthropic(client, api_key, system, prompt),
        "openai" => call_openai(client, api_key, system, prompt),
        "gemini" => call_gemini(client, api_key, system, prompt),
        "ollama" => call_ollama(client, api_url, system, prompt),
        _ => Err(format!("Unknown provider: {provider}")),
    }
}

fn call_anthropic(
    client: &reqwest::blocking::Client,
    api_key: &str,
    system: &str,
    prompt: &str,
) -> Result<String, String> {
    let body = json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 30,
        "system": system,
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Anthropic request failed: {e}"))?;

    let json: serde_json::Value = resp.json().map_err(|e| format!("Parse failed: {e}"))?;

    json["content"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in response".to_string())
}

fn call_openai(
    client: &reqwest::blocking::Client,
    api_key: &str,
    system: &str,
    prompt: &str,
) -> Result<String, String> {
    let body = json!({
        "model": "gpt-4o-mini",
        "max_tokens": 30,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ]
    });

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("OpenAI request failed: {e}"))?;

    let json: serde_json::Value = resp.json().map_err(|e| format!("Parse failed: {e}"))?;

    json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in response".to_string())
}

fn call_gemini(
    client: &reqwest::blocking::Client,
    api_key: &str,
    system: &str,
    prompt: &str,
) -> Result<String, String> {
    let body = json!({
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 30}
    });

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key={api_key}"
    );

    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Gemini request failed: {e}"))?;

    let json: serde_json::Value = resp.json().map_err(|e| format!("Parse failed: {e}"))?;

    json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in response".to_string())
}

fn call_ollama(
    client: &reqwest::blocking::Client,
    api_url: &str,
    system: &str,
    prompt: &str,
) -> Result<String, String> {
    let base = if api_url.is_empty() {
        "http://localhost:11434"
    } else {
        api_url.trim_end_matches('/')
    };

    let body = json!({
        "model": "llama3.2:1b",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ],
        "stream": false,
        "options": {"num_predict": 30}
    });

    let resp = client
        .post(format!("{base}/api/chat"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Ollama request failed: {e}"))?;

    let json: serde_json::Value = resp.json().map_err(|e| format!("Parse failed: {e}"))?;

    json["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in response".to_string())
}
