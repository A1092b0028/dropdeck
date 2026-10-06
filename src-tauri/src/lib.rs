mod commands;
mod models;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::search_youtube, commands::resolve_youtube_audio])
        .run(tauri::generate_context!())
        .expect("error while running Drop Deck");
}
