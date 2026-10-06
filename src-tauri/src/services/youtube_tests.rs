use super::*;
use serde_json::json;

#[test]
fn packaged_search_tool_is_found_without_path_or_working_directory_dependencies() {
    let directory = std::env::temp_dir().join(format!("drop-deck-tool-test-{}", std::process::id()));
    std::fs::create_dir_all(directory.join("tools")).unwrap();
    let name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
    let tool = directory.join("tools").join(name);
    std::fs::write(&tool, b"test fixture").unwrap();
    assert_eq!(executable_at(Some(&directory.join("drop-deck.exe"))), tool);
    std::fs::remove_file(&tool).unwrap();
    assert_eq!(executable_at(Some(&directory.join("drop-deck.exe"))), std::path::PathBuf::from(name));
    std::fs::create_dir(&tool).unwrap();
    assert_eq!(executable_at(Some(&directory.join("drop-deck.exe"))), std::path::PathBuf::from(name));
    std::fs::remove_dir(&tool).unwrap();
    std::fs::remove_dir(directory.join("tools")).unwrap();
    std::fs::remove_dir(directory).unwrap();
}

#[test]
fn search_tool_keeps_path_fallback_when_executable_location_is_unavailable() {
    let name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
    assert_eq!(executable_at(None), std::path::PathBuf::from(name));
}

fn output(entries: serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(&json!({ "entries": entries })).unwrap()
}

#[test]
fn normalizes_search_metadata_without_exposing_stream_fields() {
    let tracks = normalize_output(&output(json!([{
        "id": "abcdefghijk", "title": " 音樂標題 ", "channel": "頻道",
        "duration": 214, "thumbnail": "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
        "url": "https://untrusted.example/stream", "formats": [{"url": "stream"}]
    }]))).unwrap();
    let track = &tracks[0];
    assert_eq!(track.id, "abcdefghijk");
    assert_eq!(track.title, "音樂標題");
    assert_eq!(track.channel, "頻道");
    assert_eq!(track.duration, Some(214.0));
    assert_eq!(track.source_url, "https://www.youtube.com/watch?v=abcdefghijk");
    let serialized = serde_json::to_value(track).unwrap();
    assert_eq!(serialized.as_object().unwrap().len(), 6);
    assert!(serialized.get("formats").is_none());
}

#[test]
fn missing_optional_metadata_has_stable_fallbacks() {
    let tracks = normalize_output(&output(json!([{
        "id": "abcdefghijk", "title": "直播", "uploader": "Uploader", "duration": null,
        "thumbnails": [{"url": "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg"}]
    }, {"id": "lmnopqrstuv", "title": "沒有 metadata"}]))).unwrap();
    assert_eq!(tracks[0].channel, "Uploader");
    assert_eq!(tracks[0].duration, None);
    assert_eq!(tracks[0].thumbnail, "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg");
    assert_eq!(tracks[1].channel, "未知頻道");
    assert_eq!(tracks[1].thumbnail, "https://i.ytimg.com/vi/lmnopqrstuv/hqdefault.jpg");
}

#[test]
fn empty_entries_are_a_successful_empty_search() {
    assert!(normalize_output(&output(json!([]))).unwrap().is_empty());
}

#[test]
fn duplicate_search_entries_do_not_create_duplicate_results() {
    let entry = json!({"id": "abcdefghijk", "title": "Music"});
    let tracks = normalize_output(&output(json!([entry.clone(), entry]))).unwrap();
    assert_eq!(tracks.len(), 1);
}

#[test]
fn malformed_output_is_distinct_from_empty_results() {
    for bytes in [b"not JSON".to_vec(), b"{}".to_vec(), b"{\"entries\":null}".to_vec(),
        output(json!([null])), output(json!([{"id": "bad", "title": "title"}])),
        output(json!([{"id": "abcdefghijk", "title": "title", "duration": -1}]))] {
        assert_eq!(normalize_output(&bytes).unwrap_err().code, ErrorCode::InvalidOutput);
    }
}

#[test]
fn thumbnail_urls_are_limited_to_the_allowed_youtube_image_host() {
    let tracks = normalize_output(&output(json!([{
        "id": "abcdefghijk", "title": "title", "thumbnail": "https://other.example/image"
    }]))).unwrap();
    assert_eq!(tracks[0].thumbnail, "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
}

#[test]
fn validates_queries_before_starting_a_process() {
    assert_eq!(validate_query("  音樂  ").unwrap(), "音樂");
    for query in [" ".to_string(), "音".repeat(201)] {
        assert_eq!(validate_query(&query).unwrap_err().code, ErrorCode::InvalidQuery);
    }
    assert!(validate_query(&"🎵".repeat(200)).is_ok());
    assert_eq!(validate_query(&"🎵".repeat(201)).unwrap_err().code, ErrorCode::InvalidQuery);
}

#[test]
fn classifies_missing_executable_and_execution_failures() {
    assert_eq!(execution_error(std::io::Error::from(std::io::ErrorKind::NotFound)).code, ErrorCode::NotInstalled);
    assert_eq!(execution_error(std::io::Error::from(std::io::ErrorKind::PermissionDenied)).code, ErrorCode::ExecutionFailed);
    assert_eq!(classify_process_error(b"ERROR: Unable to download API page: HTTP Error 503").code, ErrorCode::SearchFailed);
    assert_eq!(classify_process_error(b"ERROR: unexpected extractor failure").code, ErrorCode::ExecutionFailed);
}

#[test]
fn validates_resolve_id_before_execution() {
    assert!(validate_track_id("_ovdm2yX4MA").is_ok());
    for id in ["", "--version", "abcdefghij!", "https://example.com"] {
        assert_eq!(validate_track_id(id).unwrap_err().code, ErrorCode::InvalidTrack);
    }
}

#[test]
fn normalizes_single_audio_only_source() {
    let bytes = serde_json::to_vec(&json!({
        "url": "https://rr1.googlevideo.com/videoplayback?expire=2000000000",
        "ext": "m4a", "acodec": "mp4a.40.2", "vcodec": "none",
        "http_headers": {"User-Agent": "secret"}, "formats": []
    })).unwrap();
    let source = normalize_audio_output(&bytes).unwrap();
    assert_eq!(source.mime_type, "audio/mp4");
    assert_eq!(source.expires_at, Some(2000000000));
    assert_eq!(serde_json::to_value(source).unwrap().as_object().unwrap().len(), 3);
}

#[test]
fn handles_webm_and_unknown_expiry() {
    let source = normalize_audio_output(&serde_json::to_vec(&json!({
        "url": "https://rr1.googlevideo.com/audio", "ext": "webm", "acodec": "opus", "vcodec": "none"
    })).unwrap()).unwrap();
    assert_eq!(source.mime_type, "audio/webm");
    assert_eq!(source.expires_at, None);
}

#[test]
fn rejects_malformed_or_unsupported_audio_sources() {
    assert_eq!(normalize_audio_output(b"not json").unwrap_err().code, ErrorCode::InvalidOutput);
    for (url, ext, acodec, vcodec) in [
        ("http://rr1.googlevideo.com/a", "m4a", "aac", "none"),
        ("https://googlevideo.com.evil.example/a", "m4a", "aac", "none"),
        ("https://user:pass@rr1.googlevideo.com/a", "m4a", "aac", "none"),
        ("https://rr1.googlevideo.com/a", "m3u8", "aac", "none"),
        ("https://rr1.googlevideo.com/a", "m4a", "none", "none"),
        ("https://rr1.googlevideo.com/a", "m4a", "aac", "h264"),
    ] {
        let bytes = serde_json::to_vec(&json!({"url": url, "ext": ext, "acodec": acodec, "vcodec": vcodec})).unwrap();
        assert_eq!(normalize_audio_output(&bytes).unwrap_err().code, ErrorCode::UnsupportedSource);
    }
}
