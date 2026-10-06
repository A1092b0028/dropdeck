# Services

`youtube.ts` 定義 YouTubeService 介面與 Tauri adapter。UI 只呼叫 `search(query)`，
不直接執行 yt-dlp。結果為 Track[]；錯誤包含固定 code 與可顯示的 message。

Rust 實作位於 `src-tauri/src/services/youtube.rs`，負責 subprocess、逾時、
metadata 正規化與錯誤分類。Milestone 2 不解析串流、不下載或播放。

`harmonic.ts` 解讀 provider-neutral 調性 metadata，拒絕缺少 major/minor 或
不支援的模式；處理等音異名、Camelot 及同號／相鄰／相對調性建議。
Audius adapter 正規化 musical_key／is_custom_musical_key，區分作者資料與平台估計，
不虛構信心值、不下載曲目作調性偵測。建議基於原曲調性；Key Lock OFF 且 Tempo
非零時不代表實際輸出音高。缺少資料仍可播放並顯示未知。
