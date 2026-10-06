# Milestone 3：Audio Engine POC

日期：2026-10-06。狀態：POC 程式已實作；真實 YouTube 播放驗收未通過。

## 實際架構

採用 Web Audio，沒有使用原生 PCM 音訊引擎或 mpv。

Track → TypeScript YouTubeService.resolve → resolve_youtube_audio Tauri command
→ Rust YouTubeService → yt-dlp → AudioSource → DeckEngine → WebAudioSession。

DeckEngine 管理曲目、狀態、非同步世代、錯誤、play/pause/seek/volume/unload。
WebAudioRuntime 延遲建立 AudioContext；每個 WebAudioSession 管理一個媒體元素、
source 與 gain。React hook 管理生命週期並訂閱快照；UI 不直接操作播放器或 yt-dlp。

本階段訊號圖為：HTMLAudioElement → MediaElementAudioSourceNode → GainNode
→ AudioContext.destination。媒體元素 volume 固定 1，Deck volume 只改 GainNode。
未新增 EQ、crossfade/master gain、Deck B 音訊實例或 mixer。

## yt-dlp 解析

前端只傳 trackId；Rust 驗證 11 字元影片 ID，自行建立 YouTube watch URL。
既有搜尋不變，解析命令額外使用 `--no-playlist`、`--dump-single-json`、
`--simulate`、`--skip-download` 與
`bestaudio[protocol=https][ext=m4a]/bestaudio[protocol=https][ext=webm]`。
忽略外部 config，使用無 shell 子程序、45 秒逾時與 kill-on-drop。

Rust 與 TypeScript 只接受 googlevideo 子網域的 HTTPS 單一音訊來源，
不允許 credentials、非標準 port、fragment 或含 video codec 的結果。
正規化 AudioSource 只有 url、mimeType、expiresAt；不將 yt-dlp metadata/headers
傳入 UI。expire 查詢參數可解析時採 Unix 秒，否則為 null。每次 Load A 重新解析，
不保存 signed URL。已知過期網址拒絕載入／再次播放；未知過期及失效網址透過
媒體錯誤回報，使用者可重新 Load A，不無限重試。

## 狀態與 UI

狀態包括 idle、loading、ready、playing、paused、ended、error。
載入不自動播放，換曲先停止並釋放舊媒體；過期的 resolve、play promise 或媒體事件
不能覆蓋新曲目。unload/dispose 取消待完成載入並釋放事件、source、gain 與媒體。
使用者的 volume 保留。play 手勢會同時恢復 AudioContext 與呼叫 media.play。
啟動 promise 未完成時，starting 快照顯示等待狀態並保留 Pause 取消操作；
不會因先前狀態為 paused 而失去取消入口。

Deck A 顯示標題、頻道、狀態、錯誤、時間、媒體 duration、Play、Pause、seek 與 volume。
seek 需要有限 duration 及 seekable range；未知時長不使用搜尋 metadata 假裝可定位。
Load B、Deck B 播放、EQ、Cue 與 Mixer 維持停用。沒有 redesign 或新增其他 DJ 功能。

## 原生真實測試與限制

Windows x64 的既有 Rust/Cargo、WebView2、yt-dlp 均可用。
僅設定測試子程序 PATH，未修改系統設定、安裝工具或替換既有 yt-dlp。

1. 以既有 yt-dlp 真實解析 `_ovdm2yX4MA`（Avicii - Levels）：成功。
   取得 m4a、mp4a.40.2、vcodec none、https、duration 198 秒的來源。
   搜尋 metadata 顯示 199 秒；引擎以媒體實際時長為準。
2. 來源 HEAD 回應 200，Content-Type audio/mp4、Accept-Ranges bytes。
3. 附 Origin `http://127.0.0.1:1420` 的 Range GET 回應 206，
   Content-Range `bytes 0-1023/3211887`，收到 1024 bytes；沒有
   Access-Control-Allow-Origin 標頭。
4. 為避免覆寫兩個仍在執行的 Milestone 2 程序，編譯獨立 debug 執行檔，
   使用現有 Vite 開發伺服器。以原生 UI 搜尋 Avicii Levels，取得 10 筆真實結果；
   首筆 Load A 啟用、Load B 停用。點 Load A 後曲名更新並進入 loading。
5. 原生 UI 最後顯示「來源格式不支援或無法載入；請重新載入曲目，並確認來源允許 CORS。」
   currentTime 仍為 0，duration 未知，Play/Pause/seek 停用。
   該文字來自 MEDIA_ERR_SRC_NOT_SUPPORTED（code 4）的處理。

結論：真實原生載入失敗，沒有到達可播放狀態，因此未驗證 YouTube 的
play/pause/seek 或非零 Gain 輸出。HTTP 診斷支持 CORS 限制的判斷；
未取得 WebView network console，不能把 media code 4 單獨當成精確 CORS 原因。
匿名 CORS 保護保持啟用，未改為繞過處理圖的普通播放器。

依 [Web Audio 規範](https://www.w3.org/TR/webaudio/)，跨來源受限的媒體
不能直接提供可處理的訊號；移除 crossOrigin 並不能證明可供混音。
測試 adapter 的路由與 Gain 控制已由單元測試覆蓋，但替身測試不代表
真實音訊輸出成功。未新增來源代理或下載快取來隱藏此限制。

## 未來 DJ 適用性

| 功能 | 評估與限制 |
| --- | --- |
| 雙 deck／獨立 gain | 可共用 WebAudioRuntime，使用兩個 DeckEngine 與獨立 source/gain；本階段未實測雙來源。 |
| EQ/filter | Web Audio 處理圖可插入 BiquadFilterNode；來源必須先能進入處理圖。本階段未建立 EQ。 |
| Crossfading | 可由獨立 MixerEngine 接管兩組 deck gain 後的 crossfade/master routing；未實作或驗證。 |
| Tempo/pitch | 媒體 playbackRate 不等於獨立、保音高的 tempo 控制；需要 AudioWorklet／原生 DSP 另行 POC。 |
| BPM/beat sync | 串流播放不提供可靠節拍資訊；需 PCM 分析、時鐘及排程策略，尚未驗證。 |
| Waveform | Analyser 可供即時分析；完整曲目波形仍需可解碼音訊與分析流程，尚未實作。 |

## 自動檢查

- 已先觀察新增解析與引擎測試因缺少實作失敗，再實作至通過。
- TypeScript 測試涵蓋解析契約、狀態、load、play/pause、seek、volume、unload、error、
  expiry、換曲、待完成 play 取消、過期事件及 dispose。
- Web Audio adapter 測試涵蓋 anonymous CORS、source→gain→destination、Gain、
  timeout、abort、格式／媒體錯誤與資源解除。
- Rust 測試涵蓋 ID、m4a/webm 正規化、未知 expire、畸形 metadata、
  非 HTTPS／不安全 host／credentials／含影像來源；保留既有搜尋測試。

| 檢查 | 結果 |
| --- | --- |
| npm test | 28/28 通過，包含最後的 pending Play 取消回歸測試。 |
| TypeScript typecheck | 最後修正後通過，包含 src、Vite config 與 tests 型別檢查。 |
| 前端 production build | 最後修正後通過。 |
| cargo check | 通過。 |
| cargo test | 12/12 通過。 |
| Tauri build --no-bundle | 最後修正後完整 release 建置通過，產出 src-tauri/target/release/yt-dj.exe。 |
| 原生真實 YouTube 播放 | 載入失敗，播放驗收未通過。 |

一般沙箱下曾遇到 Vite 子程序 `spawn EPERM` 與 yt-dlp 解壓暫存目錄錯誤；
允許執行後同一工具成功，沒有改動工具或系統設定。
為避開既有 debug exe 的使用中狀態，獨立原生診斷編譯使用 rustc `-o`，
出現輸出檔名調整與忽略 out-dir 的警告；編譯 exit 0，正式 Tauri release 建置沒有這些警告。

獨立唯讀審查確認一項重要 UI 取消問題，已以失敗→通過測試修正。
兩項次要事項保留：Rust 正規化尚未額外拒絕帶有 entries/playlist `_type` 的畸形頂層資料
（目前固定影片 URL 與 --no-playlist 防護仍在）；StrictMode hook 重掛載的資源清理
經程式碼審閱與原生啟動觀察，尚未有專門 hook 自動測試。未發現確定資源洩漏。

## 變更檔案

- 新增 src/types/audio.ts、src/audio/DeckEngine.ts、src/audio/WebAudioSession.ts、src/stores/useDeckEngine.ts。
- 修改 src/services/youtube.ts、src/App.tsx、src/App.css、src/components/Deck.tsx、src/components/SearchResults.tsx。
- 修改 src-tauri/src/models.rs、commands.rs、lib.rs、services/youtube.rs、services/youtube_tests.rs、tauri.conf.json。
- 新增 tests/audio-engine.test.ts、tests/web-audio.test.ts；修改 tests/youtube.test.ts 與 search-ui.tsx transport narrowing。
- 修改 tsconfig.json 以支援 Node 測試需要的 .ts imports；仍使用 noEmit。
- 更新 README.md、src/audio/README.md；新增本文件與設計／實作計畫。
- .verification 僅存暫時 metadata、HTTP 診斷、原生 UI 證據及測試執行檔，不參與產品建置。

## Milestone 4 建議

先決定能提供可處理音訊的來源傳輸：評估受限的 Rust 來源傳輸／快取，或直接採用
可取得 PCM 的原生解碼與 DSP。需重新驗證 Range/seek、來源失效、格式、資源清理
及 Source→Gain 的實際非靜音輸出，才能進入雙 deck 或 EQ/mixer 實作。
不建議在尚未通過來源與處理圖驗證時堆疊 DJ 介面，也不因 mpv 可以播放就選為最終引擎。
直接媒體元素也無法像原生 HTTP 用戶端一樣任意附加 yt-dlp 建議的來源 headers，
後續傳輸評估應包含來源的標頭要求。此 POC 不證明純直連能普遍處理所有 YouTube 來源。
Milestone 2 原有兩筆未知 `invalidOutput` 保留為未重現事項，本次未修正或正式結案。
