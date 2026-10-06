# Milestone 3.5：Audio Source Compatibility POC

更新：2026-10-06。僅處理來源相容性，未開始 Milestone 4。

## 驗收狀態

| 項目 | 結果與證據 |
| --- | --- |
| 本機控制來源 | **PASS（原生 Tauri 開發視窗）**。12 秒自行合成 PCM WAV，沿用正式 DeckEngine / WebAudioSession。 |
| 本機實際聲音／Gain | **PASS**。使用者已確認「有聽到，而且音量變小後靜音」。 |
| Audius 官方搜尋／解析 | **PASS（API／adapter 層）**。真實 `Electronic Butterflies`，ID `abkvg`，Seb Park，metadata 時長 117 秒；adapter 真實搜尋得到 4 筆結果並解析為 MP3。 |
| Audius 媒體傳輸 | validator 範例通過 HEAD／Range 標頭檢查；不等同播放 PASS。 |
| Audius 原生播放／Gain／seek | 使用者提供 `VRAJYZ9` 原生結果：playing 時間前進、Gain 後非零訊號／靜音、pause 與 seek 通過，並確認「我有聽到」。**實際聲音通過；Gain 音量變化聽感待明確確認**。 |
| Audius 換曲／卸載／清理 | 後續 dispose PASS、idle、AudioContext closed；換入 `abkvg` 仍遭 provider 節點 allowlist 拒絕，**完整換曲驗收未通過**。 |
| 目前 Audio Engine | 接受其本機 Source → Gain → Output baseline；遠端 provider 與完整 DJ 功能尚未驗收。 |
| Milestone 4 | **目前不開始**。需先完成 Audius 真實可聽見的原生驗證，再依決策表評估。 |

## 架構

`MusicProvider.search/resolve → Track / AudioSource → DeckEngine → WebAudioSession → HTMLAudioElement → MediaElementAudioSourceNode → GainNode → AudioContext.destination`

新增最小 `MusicProvider` 介面及 local／Audius adapter。Track 的 provider 為可選欄位，舊 YouTube IPC 仍相容。DeckEngine 不認識 Audius 原始 metadata。沒有變更 DeckEngine 或 WebAudioSession，也沒有另外建立 baseline 播放器。

通用 AudioSource 加入 WAV／MP3 與同源來源；YouTube host、HTTPS 與 m4a/webm 驗證保留於 YouTube service。媒體仍使用 `crossOrigin = anonymous`，没有更改 YouTube CORS、建立 proxy、下載音樂、使用 mpv 或 native PCM engine。

CSP 只新增本機 media `'self'`、官方 API `https://api.audius.co` 的 connect，以及 `https://*.open-audio-validator.com` 的 media。原 YouTube 規則保留。Audius artwork 分散於不同節點，此 POC 顯示占位符，不擴大圖片來源。

## 本機 baseline

`public/audio/poc-tone.wav` 由專案自行合成：12 秒、22050 Hz、16-bit mono、440／660 Hz，低振幅及淡入淡出；產生腳本 `scripts/generate-poc-tone.mjs`。此資產不含遠端音樂。

原生測試使用正式引擎，僅在測試 harness 為 Gain 加上並聯 AnalyserNode 讀取 RMS。此量測不是產品 waveform 功能，也不替代使用者聽感。

| 驗證 | 原生結果 |
| --- | --- |
| load／ready／duration | ready；12 秒；canSeek = true |
| play／currentTime | playing；從 1 秒前進至 1.536032 秒 |
| pause | 實際媒體時鐘差 0；media.paused = true |
| seek | 成功跳至 3 秒 |
| Gain 1／0.25／0 | Gain 後 RMS 0.082668／0.020641／0；比例符合 0.25 |
| 聽感 | 使用者確認一般 → 較小 → 靜音 |
| replacement／舊事件 | 舊來源暫停、src 移除；舊 timeupdate／ended 不影響新狀態 |
| unload | idle、來源暫停、src 移除；source／gain disconnect 共 4 次 |
| dispose | AudioContext closed；3 個測試 media 均暫停且移除 src；disconnect 共 6 次 |

首次暫停測試把事件快照延遲誤當成播放未停止。核對實際 media.currentTime 後，時鐘停止；快照另修正 0.271479 秒，屬 timeupdate 更新時序，沒有据此修改引擎。舊 baseline replacement 是重新載入相同控制曲目；最新版 Audius harness 另測「播放中載入另一首搜尋結果」。

本機觀測來自 `http://127.0.0.1:1420` 原生開發視窗。release 應用已建置；尚未另外宣告 release origin 的本機聽感驗證通過。

## Audius adapter 與真實 HTTP 觀測

依 [官方 API reference](https://docs.audius.co/api/) 與 [官方 Tracks 文件](https://docs.audius.co/sdk/tracks/) 使用唯讀 REST，沒有增加 SDK 或申請憑證。

1. `/v1/tracks/search?query=…&limit=10&app_name=YT-DJ`：正規化公開、streamable、非 gated 曲目，移除重複／無效資料。
2. `/v1/tracks/{id}`：重新檢查存取狀態。真實回應 `data` 是單一物件，已以實際格式修正並新增紅綠測試。
3. `/v1/tracks/{id}/stream?no_redirect=true&app_name=YT-DJ`：取得官方提供的 signed media URL；轉成 AudioSource，沒有暴露 provider metadata 給引擎。

每次載入重新解析；15 秒 API timeout；credentials omit。簽名有效期限未由公開契約明確提供，expiresAt = null，不猜測 TTL；載入失敗可重新 Load A。

觀測曲目：`https://audius.co/sebbie2k/electronic-butterflies`。下列標頭來自 2026-10-06 的真實 HTTP，診斷僅讀媒體標頭並關閉回應，不保存音樂。

| 傳輸項目 | 觀測 |
| --- | --- |
| API search | 200，Access-Control-Allow-Origin: * |
| 媒體 host／path | val001.open-audio-validator.com /tracks/cidstream/QmasRWYeSMzpSJG9M44b1sdf1fjbcnVP5u3aCvxjwRKaGP |
| MIME | audio/mpeg |
| HEAD | 200；未提供 Accept-Ranges／Content-Length，不能單靠 HEAD 判定 seek |
| Range bytes=0-0 | 206；Accept-Ranges: bytes；Content-Range: bytes 0-0/4694445；Content-Length: 1 |
| 媒體 CORS | Access-Control-Allow-Origin: *；Vary: Origin；允許 GET／HEAD 等方法與標頭 |
| 其他 | X-Content-Type-Options: nosniff；Range 回應有 Last-Modified |
| Redirect | no_redirect=true 回傳 JSON URL；上述 signed media HEAD／Range 未再次 redirect |

同一首曲目也曾由官方 API 解析到 `v.monophonic.digital`。此 POC 尚未驗證該節點的 signed stream，相容性 allowlist 會明確拒絕它，不改寫 host、不選替代 URL、不重試到指定節點。另一次不含簽名的 HEAD 得到 401；它不能證明官方 signed URL 播放失敗。未驗證節點仍是限制，不能把 allowlist 拒絕解讀為 Web Audio 或 DeckEngine 故障。

HTTP 200／206 只證明傳輸；Audius 的原生 ready、實際聲音、Gain、seek、時間與清理仍需以下測試完成。

### 使用者回報的 Audius 原生測試

來源 `http://127.0.0.1:1420` 的原生 harness：`VRAJYZ9`，Day Dreamin' (Electronic Type Beat)[Remake]，uezurii.flac。

| 項目 | 回報結果 |
| --- | --- |
| 實際媒體時長／播放時間 | 182.4 秒／1.789333 秒；與 metadata 182 秒的小幅差異為實際媒體時長 |
| Gain 後 RMS：1／0.25／0 | 0.0597367921／0.0103400764／0；音樂不同片段振幅不同，不要求比例恰為 0.25 |
| Pause | 媒體時鐘差 0；快照修正 0.170667 秒 |
| Seek | canSeek=true；成功跳至 3 秒 |
| 換曲 | 目標 `abkvg`；resolutionFailed：「此 Audius 節點尚未納入來源相容性 POC；請選擇其他曲目。」 |
| 整體 technicalResult | FAIL，原因為 replacement load failed；不得把前段成功改寫成完整 PASS |
| unload／dispose | 換曲失敗後，使用者另提供 dispose PASS：idle、track=null、error=null、contexts=[closed]、mediaCount=4、disconnects=8。harness 在回報 PASS 前已檢查所有 media 暫停且移除 src。 |
| 真實聽感／音量變化 | 使用者確認「我有聽到」；確認實際聲音，但尚未明確確認一般 → 較小 → 靜音的聽感。不能由 RMS 代替 Gain 聽感。 |

此結果證明至少一個 Audius 來源可在原生 WebView 通過既有音訊圖產生非零訊號。換曲阻塞已定位於 provider adapter 的節點限制，尚無證據需要更換 DeckEngine／WebAudioSession；也未因此擴大 allowlist、改寫 URL 或加入 workaround。

後續使用者的聲音確認加上 dispose 結果，補足實際可聽見輸出與最終資源清理證據；仍保留 Gain 聽感確認及完整換曲的缺口，不將先前 technicalResult FAIL 改寫為 PASS。

## 使用者原生驗證步驟

一般介面可直接使用 `src-tauri/target/release/yt-dj.exe`：選 Audius，搜尋，Load A，操作 Play／Pause、時間滑桿、音量及 Unload A。正式視窗不能提供 Gain 後 RMS／事件清理證據，完整驗收請使用測試頁。

從專案根目錄開終端機，先停止其他開發伺服器與 Tauri dev，再執行：

```powershell
# 此處 PATH 僅影響目前終端機，未更改系統設定。
$env:PATH = 'C:\Users\user\.cargo\bin;' + $env:PATH
npm run verify:source
```

此命令開啟 Tauri 原生 harness，不是在一般瀏覽器測試。設定獨立於正式應用；測試頁不打包到正式前端。

1. 搜尋 `electronic`，建議選 `Electronic Butterflies`（Seb Park／117 秒），按「載入 Audius」。若官方解析到未驗證節點，記錄完整錯誤，換另一首公開曲目。
2. 到 ready 後，按「執行播放與 Gain 檢查」。它會測試 play、pause、seek（若來源支援）、時長／時間、Gain 後非零訊號／靜音、播放中換另一首、舊事件移除、unload。需要至少兩首搜尋結果；第二首來源若失敗，會保留 FAIL 原因，不宣告引擎故障。
3. 檢查完成會卸載。重新載入要驗證的曲目，再按「聽感：一般 → 較小 → 靜音」。確認真正有聲音，並聽到音量變小與靜音。
4. 按「關閉引擎與檢查清理」，確認 dispose PASS／contexts closed。關閉後須重新開啟測試視窗才能再次載入。
5. 回報下方 JSON、曲目名稱、是否聽見音量變化、是否成功 seek，以及任何錯誤。測試失敗也請保留原文。

建議回報格式：

```text
曲目／ID：
搜尋與 ready：
technicalResult 與 JSON：
實際聽到音樂：是／否
一般 → 較小 → 靜音：符合／不符合
Pause／seek／currentTime／duration：
換曲／unload／dispose：
錯誤原文：
```

測試程式保留 media 參照供 stale-event 檢查；清理驗證是來源／事件／節點與 context 的釋放，不宣稱已做完整 heap／記憶體長時間壓力測試。

## 未來音訊圖評估

既有 MediaElementAudioSourceNode 輸出可接 BiquadFilterNode／GainNode，合理延伸為 Source → Low EQ → Mid EQ → High EQ → Deck Gain → Crossfade Gain → Master Gain → Output。此次本機已證明實際音訊可經 GainNode 控制。

- 雙 Deck：共用 WebAudioRuntime context、兩個 DeckEngine／session 可形成獨立來源與 gain；尚未實作或實測雙來源。
- EQ／crossfade：節點架構相容；新增濾波與 gain 即可評估，但本里程碑未實作。
- Tempo／pitch：HTMLMediaElement 的 playbackRate 不等於高品質、獨立 pitch／tempo；精確 DJ 時序及 time stretching 仍須另外 POC。
- BPM／分析：合法且 CORS 相容的來源可作後續分析研究；串流不自動提供完整離線樣本或精準 beat grid，本里程碑未分析或下載音樂。

## 與 YouTube 直接來源比較及決策

YouTube googlevideo 原生失敗為 MEDIA_ERR_SRC_NOT_SUPPORTED，先前 HTTP 診斷缺少 Access-Control-Allow-Origin。Audius validator 提供 MP3／CORS／Range，但尚未完成原生聲音驗收；兩者使用同一引擎。沒有藉本里程碑修補或繞過 YouTube 保護。

| 最終結果 | 建議 |
| --- | --- |
| Local PASS + Audius PASS | 推薦 Audius 作第一個真實音訊 provider，再規劃 Milestone 4；仍需處理節點覆蓋／穩定性。 |
| Local PASS + Audius FAIL | 先定位 provider transport／WebView／格式／CORS；無引擎證據前不替換 Audio Engine。 |
| Local FAIL | 停止 provider 工作，調查 WebAudioSession／Tauri／WebView。 |
| **目前：Local PASS + Audius 待驗證** | **保留既有引擎；Audius 為候選；不開始 Milestone 4。** |

## 檔案與檢查

主要變更：`src/services/music.ts`、`local.ts`、`audius.ts`、`youtube.ts`；`src/types/audio.ts`／`track.ts`；`src/stores/useDeckEngine.ts`／`useYouTubeSearch.ts`；`src/App.tsx`；Search／SearchResults；Tauri CSP；合法 WAV／資產說明／生成腳本；provider／baseline tests；原生 harness；`scripts/source-poc.tauri.json`；`package.json`；README 與本文件／實作計畫。

DeckEngine／WebAudioSession 與既有引擎測試未重寫。未新增 Deck B、EQ、crossfade、tempo、BPM、waveform 或其他 Milestone 4 功能。

目前驗證：npm test 34/34；typecheck／production build 通過；cargo check 通過；cargo test 12/12；`npm run tauri -- build --no-bundle` 完整建置通過，產出 `src-tauri/target/release/yt-dj.exe`。唯讀審查未發現重要 regression；verify:source 設定從專案根目錄解析成功，尚不等同使用者原生播放驗收。
