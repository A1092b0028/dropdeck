# Milestone 4：Dual Deck + Mixer Core

日期：2026-10-06。Audius + Web Audio 為使用者接受的來源架構；此次只實作 M4，不修 YouTube 播放或重新設計 provider。最終手動 UI／音訊驗收由使用者執行及判定，本文不記錄手動 PASS。

## 最終音訊圖

```text
Deck A HTMLAudioElement → MediaElementAudioSourceNode
  → Deck Gain A → Crossfade Gain A ─┐
                                  ├→ Master Gain → AudioContext.destination
Deck B HTMLAudioElement → MediaElementAudioSourceNode
  → Deck Gain B → Crossfade Gain B ─┘
```

兩個 DeckEngine 使用完全相同的既有實作，各自持有曲目、狀態、generation、pending play、session 和事件防護。`createDualDeck` 是 composition owner，不是另一種播放引擎。

`useDualDeck` 只管理 owner 的 React 生命週期，並以 useSyncExternalStore 訂閱 A、B、Mixer snapshot。UI 不讀写 Web Audio 節點。Audius 結果可分別 Load A／B；原 YouTube 搜尋仍可使用，其 Load 按鈕停用。原 M3.5 本機測試資產與獨立測試頁保留，M4 主介面改為雙 Deck 工作區。

## 共享 runtime 與資源所有權

- 一個 WebAudioRuntime 擁有一個 AudioContext、一個 MixerEngine 與目前的 session 集合。
- 每個 WebAudioSession 擁有一個 HTMLAudioElement、MediaElementAudioSourceNode、Deck Gain 與自己的事件監聽。M4 `createDeckSession(A/B)` 將 Deck Gain 接至對應的 Crossfade Gain。
- `MixerEngine` 持有 Crossfade Gain A／B、Master Gain、crossfader／master volume snapshot 及訂閱者；不擁有 context 的關閉權。
- 換曲／unload／dispose 單一 Deck 只取消該 Deck 的 load/play intent、移除其事件、暫停媒體、清除 src、disconnect Source／Deck Gain；不移除 mixer 節點、不關閉 context、不操作另一 Deck。
- 應用 owner dispose 先 dispose A/B，再 dispose runtime；runtime 可清理剩餘 live／loading sessions、Mixer 節點，最後 close context。owner 重複 dispose 回傳同一個 cleanup Promise。
- `createSession` 的原 Source → Gain → destination 路徑仍供既有單 Deck POC／adapter 測試使用；M4 composition 只使用 `createDeckSession`，不存在繞過 Master 的輸出。

既有 DeckEngine generation 防護保留：晚到的 provider resolve／舊 playback events 不覆寫新曲目；一個 Deck 的 provider failure 不影響另一 Deck。

## Mixer 與等功率 Crossfade

公開控制：setCrossfader、setMasterVolume、getCrossfader、getMasterVolume；另提供 snapshot／subscribe 給 UI。Deck 音量依原 DeckEngine.setVolume，與 crossfade／master 分開。

對 crossfader x 限制於 [-1,1]：

`θ = (x + 1) × π / 4`，`gainA = cos(θ)`，`gainB = sin(θ)`。

| Crossfader | A | B |
| --- | --- | --- |
| -1 | 1 | 0 |
| 0 | 約 0.70710678 | 約 0.70710678 |
| +1 | 0 | 1 |

端點回傳精確零；中間 A²+B²≈1。不是 linear crossfade。非有限輸入拒絕，超界有限值 clamp；master 與 Deck 音量範圍 0–1。初始 crossfader=0、master=0.8、各 Deck=0.75。

獨立 gain stages 讓未來可在 Source 與 Deck Gain 中間插入 Low／Mid／High EQ；M4 未建立 EQ 或 filter 節點。

## 自動測試與驗證

新增 8 項 focused tests，保留既有 34 項：

- equal-power 左／中／右端點、power sum、clamp／NaN。
- Mixer node routing、獨立 crossfade／master 控制、snapshot 訂閱、idempotent disconnect，Mixer 不 close context。
- 真實 DeckEngine／WebAudioRuntime／MixerEngine composition 配合測試用 DOM／Web Audio 邊界：A/B 同時 playing、共用一個 context、完整 gain 圖且無繞路、獨立 Deck gain。
- A/B 雙向 pause／seek／replace／unload isolation；disposing A 不破壞 B。
- 舊事件／晚到 resolve／provider error isolation。
- runtime live session cleanup／loading cancellation／移除監聽與只 close 一次。

測試使用 mock Web Audio／media 邊界；只證明程式 routing、狀態與資源操作，**不證明實際可聽見雙 Deck 或 mixer 效果**。

| 檢查 | 本次結果 |
| --- | --- |
| npm test | 初始 M4 PASS，42/42；節點修正後 PASS，43/43 |
| npm run typecheck | PASS（也包含於正式 build） |
| npm run build | PASS |
| cargo check --manifest-path src-tauri/Cargo.toml | PASS |
| cargo test --manifest-path src-tauri/Cargo.toml | PASS，12/12 |
| npm run tauri -- build --no-bundle | PASS；產出 src-tauri/target/release/yt-dj.exe |
| 獨立唯讀 review | 未發現重大阻擋；另重跑 mixer／dual-deck／web-audio 11/11 |
| 最終手動 UI／音訊驗收 | 未執行，由使用者判定 |

## 已知限制與未解項目

- Audius adapter 仍使用受限來源清單；除 validator 外，後續修正加入實测通過的 Figment／Altego 確切節點。其他未驗證節點仍可能 resolutionFailed，錯誤現在顯示 hostname。限制仍須在使用者驗收時記錄。
- 原生雙 Deck 聽感、crossfader／master 實際效果及長時間資源穩定性尚未由使用者驗收。
- React StrictMode 的 effect 建立／cleanup／重新建立尚無 React 層自動測試；composition 的清理／隔離有測試。程式生命週期每次建立獨立 owner，舊 owner 的 cleanup 不持有新 owner。
- equal-power 不保證峰值小於 1；高音量或相同／相關訊號混合可能 clipping。未加入 limiter、gain ramp 或其他額外 DSP。
- provider 解析不支援 caller AbortSignal；unload 會立刻使結果失效，但 API 請求可能持續到完成／既有 timeout；不會恢復舊 session。
- EQ／filters／waveform／BPM／tempo／cue／loops／recording 等未實作。原有停用 EQ／Cue 視覺保留。

## 檔案變更

新增：

- `src/audio/MixerEngine.ts`、`src/audio/DualDeck.ts`
- `src/stores/useDualDeck.ts`
- `tests/mixer.test.ts`、`tests/dual-deck.test.ts`、`tests/helpers/audio-context.ts`
- 本報告、`docs/superpowers/plans/2026-10-06-milestone-4.md`

修改：

- `src/audio/WebAudioSession.ts`：routing output 與 runtime session／mixer ownership
- `src/App.tsx`：雙 Deck composition、Audius 預設搜尋與 Load callbacks
- `src/components/Deck.tsx`、`Mixer.tsx`、`SearchResults.tsx`：兩 Deck controls、Unload、Mixer 接線
- README 與 audio／stores 說明

初始 M4 未修改 DeckEngine、Audius provider、YouTube service／Rust／CSP，既有測試未刪改。後續節點相容性修正另修改 Audius allowlist／錯誤文字、對應 media-src 與新增一項 provider regression test，未重新設計 provider 或 mixer。

### 使用者回報的節點拒絕修正

2026-10-06，使用者確認 `Day Dreamin'`（VRAJYZ9）出現「節點尚未納入 POC」。同一首曲目實際可由官方 API 解析至 validator 或 `audius-content-13.figment.io`；後者遭舊 validator-only policy 拒絕，並非 MixerEngine 故障。

對官方 API 提供的原始 signed URL 僅讀媒體標頭：Figment HEAD200／Range206、audio/mpeg、CORS*、Accept-Ranges bytes、Content-Range bytes 0-0/7298083；未 redirect。另一首公開曲目官方提供 `audius-discovery-3.altego.net`，同樣通過 MP3／CORS／Range206 標頭檢查。

修正只加入以上兩個確切 host，保持 HTTPS、安全 URL、CID stream path、公开非 gated 檢查，並同步 Tauri media-src；未改寫 signed URL、下載、proxy 或繞過 CORS。新增 regression test 先紅後綠；未知 host 仍拒絕，錯誤顯示 hostname，不暴露簽名 query。

節點傳輸證據不是最終可聽見驗收。M4 使用者清單保持未勾選，修正後需重新開啟最新桌面程式並由使用者再測。

修正後驗證：npm test 43/43、typecheck／production build、cargo check、cargo test 12/12 均通過。首次 Tauri build 因舊 release exe 執行中、Windows 拒絕覆寫而失敗；關閉該視窗後重建通過，產出更新的 release exe。未將檔案鎖定造成的失敗記為 PASS；沒有執行最終手動音訊驗收。

## Milestone 5 建議

先由使用者完成下列 M4 驗收，記錄節點失敗及音訊問題；只有使用者判定後才決定是否開始 M5。接續 EQ 可在 session 的 Source → Deck Gain 之間插入三個 BiquadFilterNode，保持獨立 Deck／Crossfade／Master gain；此次沒有預先實作。

## 使用者驗收（全部未勾選）

使用正式 `src-tauri/target/release/yt-dj.exe` 或正常 `npm run tauri -- dev`；`npm run verify:source` 是 M3.5 單 Deck 測試頁，不能用來驗收 M4。

- [ PASS ] Audius Track 1 loads into Deck A
- [PASS  ] Audius Track 2 loads into Deck B
- [ PASS ] Deck A plays correctly
- [ PASS ] Deck B plays correctly
- [PASS  ] Both decks can play simultaneously
- [ PASS ] Deck A volume affects only Deck A
- [PASS  ] Deck B volume affects only Deck B
- [ PASS ] Crossfader full left effectively silences Deck B
- [ PASS ] Crossfader center allows both decks to be heard
- [PASS  ] Crossfader full right effectively silences Deck A
- [PASS  ] Master volume affects both decks
- [ PASS ] Deck A pause/seek does not affect Deck B
- [PASS  ] Deck B pause/seek does not affect Deck A
- [PASS  ] Replacing Deck A does not interrupt Deck B
- [ PASS ] Replacing Deck B does not interrupt Deck A
- [ PASS ] Unloading one deck does not break the other
- [ PASS ] No obvious audio/resource problems occur during normal use

Only the user decides PASS or FAIL.

IMPLEMENTATION READY FOR USER ACCEPTANCE

## 2026-10-06 重新載入故障重現

使用者授權由代理操作正式 Tauri 視窗重新 Load A。搜尋 love music，重新載入同一首 toxic-love-hiphop-music-117607 old music（camiloy88t7te）。操作前拒絕節點為 v.monophonic.digital；再次 Load A 後變為 audius-content-11.figment.io，仍被目前已驗證來源清單拒絕，Deck A 維持 error、0:00、時長未知。這是來源解析階段的拒絕，尚未載入媒體，不能據此判定 Web Audio 播放失敗。

Deck B 保持 REAL TRAP SH*T（zaza）、播放結束、55.20000076293945 秒、音量 100；crossfader -0.37、master 40 均保持。Deck B 當時並未播放，因此此觀察不構成雙 Deck 同時播放或播放不中斷的驗收證據。

本次只操作重新載入並記錄結果，未修改來源清單或產品程式，未聲稱可聽見播放或最終驗收通過。待驗證上述新節點的實際 signed URL 傳輸與原生音訊行為；不以重新載入成功率或 HTTP 200 取代音訊驗證。

## 2026-10-06 節點輪替修正

確認 A、B 使用相同 DeckEngine 與 Audius provider；故障出現在共同 provider 的節點清單，並非需要複製另一個 Deck 的播放程式。官方 API 對同一首曲目會分配不同媒體節點。

透過官方 API 回傳的原始 signed URL 實測：
- toxic-love-hiphop-music-117607 old music，ID 17ZzBWQ：audius-content-11.figment.io、audius-creator-6.theblueprint.xyz。
- Day Dreamin'，ID VRAJYZ9：audius-creator-12.theblueprint.xyz（另有已允許的 Figment 13／validator 節點）。
- 上述新增三個節點均 HEAD 200、Range GET 206、audio/mpeg、Access-Control-Allow-Origin: *、Accept-Ranges: bytes，無轉址。診斷僅檢查標頭／一位元 Range，不儲存音樂。
- v.monophonic.digital 會轉址至 Cloudflare 儲存服務；HEAD 403，而實際 Range GET 206、有 CORS。未加入此節點或其轉址來源。

最終修正只新增上述三個確切 host，同步 Tauri media-src。若官方 API 分配未驗證 host，最多要求三次原始 stream 解析；不改寫簽名網址、不借用其他曲目來源、不 proxy、不下載、不繞過 CORS。格式／安全 URL、非 stream path、API／網路錯誤仍直接拒絕，避免盲目重試。未修改 DeckEngine、MixerEngine 或 A/B UI。

曾嘗試按儲存服務網域辨識節點，但建置被自動審查拒絕，理由是萬用網域與轉址來源擴大持久性媒體安全邊界。已撤回該方案，改為確切節點清單；最終產品不包含新萬用网域、Monophonic 或 Cloudflare 放行。

新增回歸驗證涵蓋已測節點原始 signed URL、未驗證節點後解析成功、三次上限、錯誤格式不重試與偽裝 hostname 拒絕。回歸測試先重現失敗後通過。完整 npm test 44/44、型別與前端 production build、cargo check、cargo test 12/12 通過。桌面最終建置與原生重新載入結果於下方記錄。

限制：有限重試不能保證官方 API 一定分配到允許的節點；例如 Blueprint 14 尚未取得傳輸驗證，仍可能被拒絕。重試不會修正遠端節點本身的故障；使用者最終音訊驗收保持未勾選。

最終縮限方案的 Tauri build --no-bundle 通過，release exe 更新時間為 2026-10-06 06:23:57（本機時間）。已開啟此新版，搜尋 love music，在原生 UI 載入 toxic-love-hiphop-music-117607 old music：到達「已載入」、時長 2:45、seek 啟用、Play 啟用。再次按同一曲目的 Load A，仍到達相同就緒狀態，未出現節點拒絕。這是實際原生載入／重新載入觀察；未按 Play、未驗證可聽見輸出。新版 Deck B 為空，不能將此測試當成 Deck B 播放不中斷的驗收。所有使用者音訊驗收項目保持未勾選。

## 2026-10-06 Eleanor Rigby 節點追加修正

使用者回報 The Beatles- Eleanor Rigby (DeemZoo Remix)，DeemZoo，在 audius-content-4.figment.io 三次解析後仍遭拒絕。官方搜尋找到曲目 ID 9bPvO。實際官方 signed URL 的 Figment 4 與同曲目 Blueprint 8（audius-creator-8.theblueprint.xyz）皆 HEAD 200、Range GET 206、audio/mpeg、Access-Control-Allow-Origin: *、Accept-Ranges: bytes、Content-Range bytes 0-0/9053805，無轉址。只檢查標頭／一位元 Range，未儲存音樂。

只在共同 Audius provider 與 Tauri media-src 加入這兩個確切 hostname，原始 signed URL 保持不變。回歸测试先重現 Figment 4 拒絕，修正後完整 npm test 44/44 通過。DeckEngine、MixerEngine、React 元件均未改動。

相同曲目亦曾分配 v.monophonic.digital 及 cn3.mainnet.audiusindex.org，未在此次納入，因此有限次重試仍不能保證每次載入成功。HTTP 相容性檢查不代表可聽見音訊通過；最終音訊驗收保留給使用者。

後續實際 provider 解析曾連續失敗於 cn3.mainnet.audiusindex.org，未將那兩次失敗記為通過。補查官方 signed URL：cn3 初始 HEAD／Range GET 302 均含 Access-Control-Allow-Origin: *；自動跟隨官方轉址後到 audius-content-4.figment.io，HEAD 200／GET 206、audio/mpeg、CORS *、bytes Range 正常。因而最終清單再加入 cn3 這個確切 host，同步 media-src；前段所述 cn3 未納入只描述中間版本，最終版本已納入。Monophonic 仍未放行。

最終 provider 在實際官方 API 上連續兩次成功解析 ID 9bPvO 至 audius-creator-8.theblueprint.xyz。這只證明實際解析成功，不是可聽見播放證據。最終 npm test 44/44、typecheck、production build 通過。

## 2026-10-06 使用者授權營運商命名規則

使用者明確選擇「按已知營運商的節點命名規則放行」，以取代 Figment／Blueprint 逐一加入節點編號的方式。此授權範圍不包含任意媒體網站、其他新營運商或新增轉址儲存服務；先前未獲授權的廣泛方案已由這個較明確的範圍取代。

最終共同 provider 使用完整 hostname 正規式，只接受 audius-content-<正整數>.figment.io 及 audius-creator-<正整數>.theblueprint.xyz。正整數不含 0 或前導零；根網域、任意其他子網域、非數字編號、巢狀子網域及相似網域均拒絕。cn3.mainnet.audiusindex.org 與 audius-discovery-3.altego.net 維持確切 host 清單，既有 open-audio-validator 規則維持。Monophonic／Cloudflare 不新增放行。

Tauri media-src 以 https://*.figment.io、https://*.theblueprint.xyz 支援這兩個營運商的編號變動；CSP 無法表達這種數字 hostname 正規式，因此 provider 的來源判斷比 CSP 更嚴格。其他 CSP 指令、YouTube 來源設定、原生安全權限均維持。來源必須為官方 API 回傳原始 signed URL，仍檢查 HTTPS、無憑證／額外 port／fragment、CID stream 路徑及曲目公開可串流條件；不改寫 URL，不 proxy、不下載、不繞過 CORS。

A、B 共用此 provider，不修改 DeckEngine、WebAudioSession、MixerEngine 或 UI。新增兩項回歸測試：尚未逐節點登錄的合法編號可直接解析且不改 signed URL；不合法命名、巢狀與偽裝網域拒絕。正向測試先重現失敗，修正後完整 npm test 46/46 通過，typecheck 及 production build 通過。

重要限制：接受營運商命名空間不等於每個編號節點已實測可播放。原先 Blueprint 14 等「未列入 host 清單」限制對此營運商規則已解除，但遠端節點若無 CORS、格式不支援或失效，仍由既有 Web Audio 錯誤流程回報。新的營運商仍需確認；本次不進行最終手動音訊驗收，驗收項目維持未勾選。

此授權版本 cargo check、cargo test 12/12、Tauri build --no-bundle 均通過。桌面新版已啟動供使用者測試；未執行或聲稱最終音訊驗收。此版本未被自動審查拒絕。

## 2026-10-06 使用者授權官方 API HTTPS 串流信任

使用者選擇「信任官方 API 回傳的 HTTPS 串流」，並在明確列出 media-src 'self' https:／允許任意 HTTPS 媒體網域的確認題回答「同意擴大 HTTPS 媒體來源範圍」。本節為最新方案，取代上述確切節點清單及營運商命名規則。

共同 Audius provider 固定從 https://api.audius.co/v1 取得曲目資料及 stream JSON，API 請求使用 redirect:error、credentials:omit、cache:no-store；不把 API 的信任經由轉址擴大到其他網站。曲目須重查公開可串流／非 gated，ID 必須有效且與回應一致。Track 自帶的 sourceUrl 不用作串流來源或請求端點。僅使用官方 stream JSON 回傳的原始 HTTPS URL，不改寫 host、path 或 query，不附加代理，不借用其他曲目來源。

移除媒體 host／CID path 白名單及因此產生的三次節點重試；官方回傳的新節點或 CDN path 不再要求逐一登錄。仍透過 AudioSource 檢查拒絕 HTTP、非網址、網址憑證、額外 port、fragment 與不支援的 source 資料。DeckEngine、WebAudioSession、MixerEngine、React 元件維持原樣；HTMLMediaElement 的 crossOrigin=anonymous 及真實 CORS 檢查維持。

Tauri 僅將 media-src 改成 'self' https:，允許初始媒體與媒體轉址使用任意 HTTPS 網域。default-src、style-src、img-src、connect-src 及原生權限不改動。此策略擴大媒體網域信任範圍，信任邊界改為固定官方 API 的回應；不是對每個官方節點播放相容性的保證，也不是關閉整體 CSP。YouTube service 的 URL 限制及 CORS 設定維持，沒有修復 YouTube 播放或繞過保護。

來源規則行為變更因此更新對應 provider 測試：官方回傳的新 HTTPS host／CDN path 可解析、signed URL 保持、只呼叫固定 API 且不跟隨 API 轉址、忽略 Track 提供的 sourceUrl、unsafe URL 拒絕。三項回歸先重現舊規則／API redirect 設定失敗，修正後完整 npm test 46/46、typecheck、production build、cargo check、cargo test 12/12 通過。所有 M1–M4 音訊核心測試保留。

實際官方 API 上連續兩次成功解析 Eleanor Rigby ID 9bPvO 至 v.monophonic.digital。此結果只證明解析成功，沒有播放或聽感驗收。HTTP 200、解析成功或模擬測試均不當成真實音訊 PASS。

首次桌面建置因 media-src 任意 HTTPS 範圍被自動審查拒絕，未記為通過，也未用其他方式繞過。完成獨立檢查後取得使用者對該範圍的明確同意，再重試正常 Tauri 建置。

限制：媒體仍須滿足 WebView 的 CORS、格式、HTTPS 轉址及有效簽名條件；若官方 API 改成轉址提供 JSON，目前會拒絕並回報網路錯誤。來源失效仍由既有載入／播放錯誤流程處理，使用者重新 Load 會重新取得官方來源。本次不加入載入失敗自動恢復功能或其他里程碑功能。手動音訊驗收項目維持未勾選。

取得明確授權後，最終 Tauri build --no-bundle 通過，採用新策略的 release exe 已開啟供使用者驗收。先前拒絕的建置不計為通過；沒有聲稱新版實際可聽見播放或最終驗收 PASS。
