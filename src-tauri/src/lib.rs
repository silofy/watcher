// The Watcher desktop shell. A thin window around the React report, plus commands the webview
// invokes — here, managing the offline LLM (Ollama) sidecar (brief §5.1).

mod cloud;
mod htb;
mod llm;
mod net;
mod pwnbox;
mod secrets;
mod sessions;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            llm::ollama_status,
            llm::start_ollama,
            llm::pull_model,
            sessions::list_sessions,
            sessions::list_ssh_logs,
            net::fetch_writeup,
            net::open_url,
            htb::set_htb_token,
            htb::has_htb_token,
            htb::clear_htb_token,
            htb::fetch_htb_writeup,
            secrets::set_api_key,
            secrets::has_api_key,
            secrets::clear_api_key,
            cloud::cloud_generate,
            pwnbox::pull_pwnbox
        ])
        .run(tauri::generate_context!())
        .expect("error while running The Watcher");
}
