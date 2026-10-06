# Milestone 2 原生整合驗證

日期：2026-10-06。本次僅驗證搜尋整合，未新增播放或音訊功能。

## 環境

- Windows x64，MSVC Visual Studio 2022，WebView2 154.0.4258.53。
- rustc 1.99.0、cargo 1.99.0；工具位於 `C:\Users\user\.cargo\bin`。
- yt-dlp 2026.08.19；使用既有 LightYTP 安裝的 `tools\yt-dlp.exe`。
- Node.js 24.18.0、npm 11.16.0；Tauri 2.12.1。
- Codex 程序繼承的 PATH 尚未包含上述工具；驗證時只設定子程序 PATH。
  日常啟動需確保 YT-DJ 繼承的 PATH 能找到 yt-dlp。

## 真實搜尋證據

以 Tauri CLI 啟動 `yt-dj.exe`，由使用者操作桌面搜尋介面；唯讀觀察
Windows 原生視窗的可及性樹，確認「Avicii Levels」找到 10 筆結果，
第一筆顯示 Avicii - Levels、Avicii、3:19，Load A/B 停用。

暫時於 Tauri command 邊界記錄實際回傳值，確認下列路徑：

React UI → YouTubeService → Tauri IPC → Rust YouTubeService → yt-dlp
→ YouTube → 正規化 Track[] → 原生 UI。

第一筆實際 Track：

| 欄位 | 值 |
| --- | --- |
| id | `_ovdm2yX4MA` |
| title | `Avicii - Levels` |
| channel | `Avicii` |
| duration | `199` 秒 |
| thumbnail | `https://i.ytimg.com/vi/_ovdm2yX4MA/hq720.jpg` 加搜尋回傳的查詢參數 |
| sourceUrl | `https://www.youtube.com/watch?v=_ovdm2yX4MA` |

縮圖與 sourceUrl 均以實際 HTTP 請求確認回應 200。獨立執行相同 yt-dlp
參數也取得真實 metadata；正式搜尋沒有使用測試 transport 或 mock 資料。
診斷記錄已自原始碼移除，command 與驗證前備份的 SHA-256 一致。

## 情境

- 正常搜尋：原生 IPC 與 UI 均確認 10 筆 Avicii 結果。
- 無結果：精確引號包住 `zzqvYTNativeM2_8cd8b4e9047f4b9fabdf93801766c77c`；
  yt-dlp 回傳 `entries: []`，原生 IPC 回傳 `Ok: []`，使用者回報
  「沒有找到結果，請換個關鍵字」。
- 空白查詢：初始原生 UI 的搜尋按鈕停用；Rust 與 TypeScript 的空白驗證測試通過。
- 缺少 yt-dlp：開啟另一個不包含 yt-dlp 路徑的原生程序，未移動或刪除工具；
  使用者搜尋 Avicii Levels，IPC 實際回傳 `notInstalled`，使用者回報畫面顯示
  「找不到 yt-dlp，請先安裝並加入 PATH，再重新啟動 YT-DJ」。
- 執行失敗與網路失敗的分類：Rust 單元測試通過；未刻意中斷整台電腦的網路。

## 發現與變更

- 首次啟動時既有 Vite 佔用 1420 埠；以僅供驗證的設定重用該伺服器，
  未修改正式 Tauri 設定。
- 搜尋記錄曾出現兩次 `invalidOutput`；觸發文字尚未確認。指定的 Avicii
  與無結果字串均成功，未對未知原因進行推測性修改。
- 新增 `src-tauri/Cargo.lock`，固定本次驗證的原生依賴版本。
- 更新驗證文件；未修改產品行為。

## 檢查與結案狀態

原生 cargo check、cargo test（8/8），TypeScript 測試（10/10）、型別檢查
與前端 production build 已通過。移除診斷後再次執行 cargo check、cargo test
與 TypeScript 測試，均通過。

`npm run tauri -- build --no-bundle` 完整通過，包含前端型別檢查與正式建置，
產出 `src-tauri/target/release/yt-dj.exe`；原生 release 編譯耗時 7 分 29 秒。
沒有把僅前端通過誤報為原生通過。

正常搜尋、空白防護、無結果與缺少工具的整合已驗證。兩次 `invalidOutput`
尚缺觸發關鍵字與原始輸出，無法判斷是否有需修正的 metadata 邊界情境；
保留為結案前待確認項目，目前不建議正式關閉 Milestone 2。

本次持久檔案變更為 Cargo.lock、本文件、前次驗證文件與 README。
暫時診斷及啟動設定只供驗證，未保留在正式產品程式碼中。
