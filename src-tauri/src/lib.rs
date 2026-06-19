// The Watcher desktop shell. A thin window around the React report, plus commands the webview
// invokes — here, managing the offline LLM (Ollama) sidecar (brief §5.1).

mod llm;
mod pwnbox;
mod sessions;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            llm::ollama_status,
            llm::start_ollama,
            sessions::list_sessions,
            pwnbox::pull_pwnbox
        ])
        .run(tauri::generate_context!())
        .expect("error while running The Watcher");
}
