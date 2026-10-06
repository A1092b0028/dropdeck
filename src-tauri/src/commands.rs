use crate::{models::{Track, AudioSource}, services::youtube::{YouTubeError, YouTubeService}};

#[tauri::command]
pub async fn search_youtube(query: String) -> Result<Vec<Track>, YouTubeError> {
    YouTubeService.search(&query).await
}

#[tauri::command]
pub async fn resolve_youtube_audio(track_id: String) -> Result<AudioSource, YouTubeError> {
    YouTubeService.resolve(&track_id).await
}
