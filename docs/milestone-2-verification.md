# Milestone 2 變更與驗證

日期：2026-10-06。

## 檔案變更

新增：

- `AGENTS.md`
- `src/types/track.ts`、`src/types/search.ts`
- `src/services/youtube.ts`
- `src/stores/useYouTubeSearch.ts`
- `src/components/SearchResults.tsx`
- `src-tauri/src/models.rs`、`src-tauri/src/commands.rs`
- `src-tauri/src/services/mod.rs`、`src-tauri/src/services/youtube.rs`、`src-tauri/src/services/youtube_tests.rs`
- `tests/youtube.test.ts`、`tests/search-ui.html`、`tests/search-ui.tsx`
- `tsconfig.test.json`
- `docs/superpowers/plans/2026-10-06-milestone-2.md`
- `docs/milestone-2-verification.md`

修改：

- `src/App.tsx`、`src/App.css`、`src/components/Search.tsx`
- `src/services/README.md`、`src/stores/README.md`、`src/types/README.md`
- `src-tauri/Cargo.toml`、`src-tauri/src/lib.rs`、`src-tauri/tauri.conf.json`
- `package.json`、`package-lock.json`、`README.md`

`spec.md` 與既有 Deck/Mixer 元件未修改。

## 架構

UI → useYouTubeSearch → YouTubeService → Tauri search_youtube → Rust YouTubeService → yt-dlp。

Rust 執行固定的搜尋參數並正規化 Track[]，不經 shell，不下載或解析串流。
query 最多 200 個 Unicode 字元，最多 10 筆結果，45 秒逾時並終止子程序。
時長為秒數或 null；channel/thumbnail 有缺省值，sourceUrl 為 canonical YouTube watch URL。
縮圖 CSP 僅新增 `https://i.ytimg.com`。錯誤以 code/message 跨 IPC 邊界回傳。
TS adapter 驗證 Track 契約；UI 只接觸 service 與搜尋狀態，Load A/B 皆 disabled。

## 已執行

- 測試先失敗於尚未建立的 service module，再實作。
- `npm test`：10/10 通過。
- `npm run typecheck`：通過，包含應用程式、Vite 設定與測試頁。
- `npm run build`：通過，產出 dist，26 個 modules；建置使用獲准的沙箱外子程序。
- 正式應用在瀏覽器提交搜尋：正確顯示需使用 Tauri 桌面版的提示；主控台無警告或錯誤。
- 獨立測試 transport + 真實 UI/hook：驗證 loading 期間停用控制項、2 筆結果、
  時長 1:01:01/時長未知、Load A/B 停用、empty、network error、invalid output、
  missing yt-dlp、Enter 提交、錯誤後重試成功及清除過期结果。
- 結果區於 375px 與 1100px 寬度均無水平溢出。
- 唯讀審查未發現阻擋性問題；Unicode 輸入上限不一致已修正。

## 初次實作時尚未驗證

初次實作時，程序 PATH 找不到 Cargo、rustc 或 yt-dlp；依使用者指示跳過 Rust/Tauri 原生檢查。
Rust 正規化測試已加入，但未執行；原生編譯、IPC 整合、子程序逾時與真實
YouTube 搜尋均尚未驗證。前端與 fixture 檢查不能替代上述原生驗證。

工具可用後需執行 README 所列的 cargo check、cargo test、Tauri build，
並在桌面版實際搜尋以驗證 yt-dlp metadata 與網路行為。

後續已找到既有工具並進行原生驗證，最新結果見
[Milestone 2 原生整合驗證](milestone-2-native-verification.md)。
