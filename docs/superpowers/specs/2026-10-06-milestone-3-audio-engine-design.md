# Milestone 3：Audio Engine POC 設計提案

狀態：待設計審閱，尚未實作。日期：2026-10-06。

## 目的與範圍

保留 Milestone 1、2 的介面與搜尋功能，驗證真實 YouTube 音訊能否進入可供未來 DJ 混音使用的音訊處理圖。只啟用 Deck A 的載入、播放、暫停、定位與音量。Deck B、EQ、Cue 與 Mixer 控制維持停用。未確認原因的 Milestone 2 `invalidOutput` 保留在原驗證紀錄，不進行推測性修正。

## 架構選擇

建議使用 Web Audio：HTMLAudioElement 負責媒體載入與時間定位，MediaElementAudioSourceNode → GainNode → AudioContext.destination 負責訊號輸出。媒體元素不放在 React 元件；React 只訂閱引擎快照並呼叫命令。AudioContext 在使用者操作時建立／恢復，避免自動播放限制。

比較方案：原生 PCM 引擎可提供更完整的 DSP 與時間控制，但本階段將增加解碼、緩衝、裝置管理與定位實作。mpv 適合一般播放，但播放成功不足以證明所需的共享處理圖可用，因此不作為此次引擎。

Web Audio 方案仍是待驗證選擇，不能預先宣稱 YouTube 直連來源可用。

## 服務與資料流

Track → TypeScript YouTubeService.resolve(track) → resolve_youtube_audio Tauri command → Rust YouTubeService → yt-dlp → 正規化 AudioSource → DeckEngine。

Rust 驗證影片 ID 並自行組合 YouTube watch URL；不接受任意來源 URL 或前端 yt-dlp 參數。以無 shell 的子程序、忽略外部設定、禁止 playlist、有限逾時及 kill-on-drop 執行解析，選取單一可播放的 audio-only HTTPS 來源。依照實際 metadata 正規化 url、MIME 類型及可取得的到期資訊；到期時間未知時回傳 null。原始 metadata、headers 與格式選取細節留在後端。限制 CSP 僅放行必要的媒體來源，維持既有 IPC 與縮圖設定。

解析結果不持久儲存；每次 load 重新解析。已知到期來源不送入播放。播放錯誤提供重新 Load A 的恢復方式，不無限重試，也不把所有網路錯誤都誤報為過期。

## 引擎介面與生命週期

可重用 DeckEngine 提供 load(track)、play()、pause()、seek(seconds)、setVolume(value)、unload()，並提供 subscribe/getSnapshot 與 dispose。解析服務及媒體輸出 adapter 可注入，以便測試。

快照包含 idle/loading/ready/playing/paused/ended/error、Track、currentTime、duration、volume 及可讀錯誤。duration 以媒體 metadata 為準；未知或非有限值維持 null。無可定位範圍時停用 seek；有限數值與範圍由引擎再次驗證。

替換曲目立即停止舊媒體，遞增載入世代，解除舊事件與訊號連接。較早解析或 play promise 完成不得覆蓋新曲目。unload 同樣使待完成請求失效。load 不自動播放；volume 保留使用者設定。ended 停止播放並保留曲目以便重播。

實際瀏覽器 adapter 處理 loadedmetadata、timeupdate、ended、error 與載入逾時。解析失敗、媒體載入失敗、不支援格式及 play 拒絕均轉為明確狀態，不產生未處理 promise rejection。使用者手勢限制的錯誤應可透過再次 Play 恢復。

## 處理圖與未來能力

本階段只有 Source → Deck Gain → Output；不建立 EQ 或 crossfade 節點。未來兩個 DeckEngine 實例可共用 AudioContext，各自擁有 source 與 gain，並由獨立 MixerEngine 管理 crossfade/master routing。

Web Audio 的 BiquadFilterNode、GainNode 與 AnalyserNode 為 EQ、crossfading 與分析提供可行擴充點，但本階段不表示已驗證雙 deck、節拍同步或波形功能。HTMLAudioElement 的 playbackRate 不等同獨立 tempo/pitch 或高精度 DJ time-stretch；後續需另外評估 AudioWorklet／原生 DSP。完整離線 waveform/BPM 分析也需要可解碼 PCM，不可僅從串流播放成功推論可行。

## CORS 與可行性驗證

媒體能播放不等於 Web Audio 能處理。跨來源媒體必須以 anonymous CORS 載入；缺少適當回應時可能載入失敗或處理圖靜音。依 Web Audio 規範，CORS-cross-origin 的 MediaElementAudioSourceNode 必須輸出靜音。

本階段先驗證直接 HTTPS 音訊來源。若 CORS、格式、簽名或來源要求使處理圖不可用，明確記錄限制與失敗結果，不偷偷切換到繞過 GainNode 的普通播放器。代理或下載快取不在這份提案內；若需要，列為後續架構決策。

參考：https://www.w3.org/TR/webaudio/ 、https://developer.mozilla.org/en-US/docs/Web/API/MediaElementAudioSourceNode 。

## UI 變更

SearchResults 只增加 Load A callback。App／專用 hook 管理 Deck A 引擎生命週期。Deck A 顯示載入曲目、狀態／錯誤、Play、Pause、seek、volume、currentTime 與 duration；原有樣式優先沿用，僅加入必要控制。Deck B 不建立音訊實例。標示 Milestone 3 POC 與未啟用功能。

## 測試與驗收

以現有 Node TypeScript 測試方式，注入假 resolver 與媒體 adapter，驗證狀態轉移、load、play/pause、seek、volume、unload、ended、載入／播放錯誤、播放中替換、競態與 dispose。TypeScript 服務測試驗證 command 參數、結果正規化與錯誤分類；Rust 測試驗證 ID、解析正常／畸形輸出、無 audio-only 格式及子程序錯誤。既有搜尋測試必須保留通過。

執行 npm test、npm run typecheck、npm run build、cargo check 與 cargo test。工具路徑若不足，僅設定驗證子程序 PATH，不改系统設定或安裝工具。

原生環境可用時，以真實 Track 測試 resolve → load → Play → Pause → seek → volume；確認時間前進、實際處理圖非靜音，且 Gain 0 與非零音量確實影響輸出。測試證據區分程式觀察、訊號量測及使用者聽感；未取得實際證據不宣稱真實播放成功。移除暫時診斷後重新執行受影響檢查。

最終建立 docs/milestone-3-audio-engine-poc.md，記錄實際架構、訊號圖、解析方法、測試結果、原生播放證據／阻礙、未來雙 deck／EQ／crossfade／tempo／BPM 適用性與 Milestone 4 建議。報告所有變更檔案與未解決限制。即使 POC 發現來源不可用，也保留測試與如實記錄結果；不將失敗稱為播放驗收通過。
