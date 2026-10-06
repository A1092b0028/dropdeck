use std::{collections::HashSet, io, path::{Path, PathBuf}, process::Stdio, time::Duration};

use serde::Serialize;
use serde_json::Value;
use tokio::{process::Command, time::timeout};

use crate::models::{Track, AudioSource};

const SEARCH_LIMIT: usize = 10;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    InvalidQuery,
    NotInstalled,
    ExecutionFailed,
    SearchFailed,
    InvalidOutput,
    InvalidTrack,
    ResolutionFailed,
    UnsupportedSource,
}

#[derive(Debug, Serialize)]
pub struct YouTubeError {
    pub code: ErrorCode,
    pub message: String,
}

impl YouTubeError {
    fn new(code: ErrorCode, message: &str) -> Self {
        Self { code, message: message.to_owned() }
    }
}

pub struct YouTubeService;

fn executable_at(app_executable: Option<&Path>) -> PathBuf {
    let name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
    if let Some(directory) = app_executable.and_then(Path::parent) {
        let bundled = directory.join("tools").join(name);
        if bundled.is_file() {
            return bundled;
        }
    }
    PathBuf::from(name)
}

fn yt_dlp_executable() -> PathBuf {
    executable_at(std::env::current_exe().ok().as_deref())
}

impl YouTubeService {
    pub async fn resolve(&self, track_id: &str) -> Result<AudioSource, YouTubeError> {
        validate_track_id(track_id)?;
        let executable = yt_dlp_executable();
        let url = format!("https://www.youtube.com/watch?v={track_id}");
        let mut command = Command::new(executable);
        command.args([
            "--ignore-config", "--no-playlist", "--dump-single-json", "--skip-download",
            "--simulate", "--no-warnings", "--no-progress", "--socket-timeout", "15",
            "--retries", "1", "--extractor-retries", "1", "-f",
            "bestaudio[protocol=https][ext=m4a]/bestaudio[protocol=https][ext=webm]",
            "--", &url,
        ]);
        command.stdin(Stdio::null()).kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let output = timeout(SEARCH_TIMEOUT, command.output()).await
            .map_err(|_| YouTubeError::new(ErrorCode::ResolutionFailed, "音訊解析逾時，請重新載入曲目。"))?
            .map_err(execution_error)?;
        if !output.status.success() {
            return Err(classify_resolution_error(&output.stderr));
        }
        normalize_audio_output(&output.stdout)
    }

    pub async fn search(&self, query: &str) -> Result<Vec<Track>, YouTubeError> {
        let query = validate_query(query)?;
        let executable = yt_dlp_executable();
        let mut command = Command::new(executable);
        command.args([
            "--ignore-config", "--flat-playlist", "--dump-single-json",
            "--skip-download", "--simulate", "--no-warnings", "--no-progress",
            "--socket-timeout", "15", "--retries", "1", "--extractor-retries", "1",
            "--", &format!("ytsearch{SEARCH_LIMIT}:{query}"),
        ]);
        command.stdin(Stdio::null()).kill_on_drop(true);
        // Hide the subprocess console in Windows desktop builds.
        #[cfg(windows)]
        command.creation_flags(0x08000000);

        let output = timeout(SEARCH_TIMEOUT, command.output())
            .await
            .map_err(|_| YouTubeError::new(ErrorCode::SearchFailed, "搜尋逾時，請檢查網路連線後再試一次。"))?
            .map_err(execution_error)?;

        if !output.status.success() {
            return Err(classify_process_error(&output.stderr));
        }
        normalize_output(&output.stdout)
    }
}

fn validate_track_id(id: &str) -> Result<(), YouTubeError> {
    if id.len() != 11 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return Err(YouTubeError::new(ErrorCode::InvalidTrack, "曲目 ID 無效，請重新搜尋。"));
    }
    Ok(())
}

fn classify_resolution_error(stderr: &[u8]) -> YouTubeError {
    if String::from_utf8_lossy(stderr).contains("Requested format is not available") {
        YouTubeError::new(ErrorCode::UnsupportedSource, "此曲目沒有支援的直接音訊來源。")
    } else {
        YouTubeError::new(ErrorCode::ResolutionFailed, "YouTube 音訊解析失敗，請檢查網路、yt-dlp 版本或曲目可用性後重試。")
    }
}

fn normalize_audio_output(stdout: &[u8]) -> Result<AudioSource, YouTubeError> {
    let value: Value = serde_json::from_slice(stdout).map_err(|_| invalid_output())?;
    let raw_url = text(&value, "url").ok_or_else(invalid_output)?;
    let url = tauri::Url::parse(raw_url).map_err(|_| invalid_output())?;
    let mime_type = match text(&value, "ext") {
        Some("m4a") => "audio/mp4",
        Some("webm") => "audio/webm",
        _ => return Err(YouTubeError::new(ErrorCode::UnsupportedSource, "不支援此音訊格式。")),
    };
    if url.scheme() != "https" || !url.host_str().is_some_and(|host| host.ends_with(".googlevideo.com"))
        || !url.username().is_empty() || url.password().is_some() || url.port().is_some()
        || url.fragment().is_some() || text(&value, "vcodec") != Some("none")
        || text(&value, "acodec").map_or(true, |codec| codec == "none") {
        return Err(YouTubeError::new(ErrorCode::UnsupportedSource, "不支援此音訊來源，請重新載入曲目。"));
    }
    let expires_at = url.query_pairs().find(|(key, _)| key == "expire")
        .and_then(|(_, value)| value.parse::<u64>().ok())
        .filter(|value| *value <= 9_007_199_254_740_991);
    Ok(AudioSource { url: url.to_string(), mime_type: mime_type.to_owned(), expires_at })
}

fn validate_query(query: &str) -> Result<&str, YouTubeError> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 200 {
        return Err(YouTubeError::new(ErrorCode::InvalidQuery, "請輸入 1 到 200 個字元的搜尋關鍵字。"));
    }
    Ok(query)
}

fn execution_error(error: io::Error) -> YouTubeError {
    if error.kind() == io::ErrorKind::NotFound {
        YouTubeError::new(ErrorCode::NotInstalled, "找不到 yt-dlp，請先安裝並加入 PATH，再重新啟動 Drop Deck。")
    } else {
        YouTubeError::new(ErrorCode::ExecutionFailed, "無法執行 yt-dlp，請確認安裝與執行權限後重試。")
    }
}

fn classify_process_error(stderr: &[u8]) -> YouTubeError {
    let detail = String::from_utf8_lossy(stderr).to_lowercase();
    if ["unable to download", "http error", "timed out", "timeout", "connection", "network", "unable to resolve", "name resolution", "sign in", "429"]
        .iter().any(|pattern| detail.contains(pattern)) {
        YouTubeError::new(ErrorCode::SearchFailed, "YouTube 搜尋失敗，請檢查網路連線或稍後再試。")
    } else {
        YouTubeError::new(ErrorCode::ExecutionFailed, "yt-dlp 搜尋執行失敗，請確認 yt-dlp 版本與安裝狀態後重試。")
    }
}

fn invalid_output() -> YouTubeError {
    YouTubeError::new(ErrorCode::InvalidOutput, "yt-dlp 回傳的資料格式無效，請更新 yt-dlp 或稍後重試。")
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty())
}

fn youtube_thumbnail(url: &str) -> bool {
    url.starts_with("https://i.ytimg.com/")
}

fn normalize_output(stdout: &[u8]) -> Result<Vec<Track>, YouTubeError> {
    let value: Value = serde_json::from_slice(stdout).map_err(|_| invalid_output())?;
    let entries = value.get("entries").and_then(Value::as_array).ok_or_else(invalid_output)?;
    let mut ids = HashSet::new();
    let mut tracks = Vec::new();

    for entry in entries.iter().take(SEARCH_LIMIT) {
        let id = text(entry, "id").ok_or_else(invalid_output)?;
        if id.len() != 11 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-') {
            return Err(invalid_output());
        }
        let title = text(entry, "title").ok_or_else(invalid_output)?;
        let channel = text(entry, "channel").or_else(|| text(entry, "uploader")).unwrap_or("未知頻道");
        let duration = match entry.get("duration") {
            None | Some(Value::Null) => None,
            Some(value) => Some(value.as_f64().filter(|duration| duration.is_finite() && *duration >= 0.0).ok_or_else(invalid_output)?),
        };
        let thumbnail = text(entry, "thumbnail").filter(|url| youtube_thumbnail(url))
            .or_else(|| entry.get("thumbnails").and_then(Value::as_array)
                .and_then(|images| images.iter().rev().find_map(|image| text(image, "url").filter(|url| youtube_thumbnail(url)))))
            .map(str::to_owned)
            .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"));

        if ids.insert(id.to_owned()) {
            tracks.push(Track {
                id: id.to_owned(), title: title.to_owned(), channel: channel.to_owned(), duration,
                thumbnail, source_url: format!("https://www.youtube.com/watch?v={id}"),
            });
        }
    }
    Ok(tracks)
}

#[cfg(test)]
#[path = "youtube_tests.rs"]
mod tests;
