# Stores

`useYouTubeSearch.ts` 管理搜尋 query、idle/loading/success/error 狀態及重送防護。
依賴 MusicProvider 搜尋介面，沒有音訊或 Mixer 邏輯，也沒有新增狀態管理套件。
`useDualDeck.ts` 持有共享雙 Deck owner，以 useSyncExternalStore 訂閱兩個 Deck
與 Mixer snapshot。React 不操作音訊節點；清理 owner 後 runtime 才關閉共享 context。
原 `useDeckEngine.ts` 保留作既有單 Deck POC；M4 主介面使用 useDualDeck。
`WorkflowStore.ts` 使用 WebView origin 的 localStorage 保存版本 1 資料：最多
200 筆 Queue、500 筆收藏／曲目 Cue 與分析、100 筆載入／每次載入首次播放歷史。
只保存白名單 Track 資料與固定曲目頁面網址，不保存 signed stream URL、音訊樣本
或執行期資源。Cue 與手動 Beat Origin 於 fresh load ready 後按 provider/id 還原；
新來源 BPM 不同時捨棄舊 Beat Grid。Tempo 只保存手動設定，不保存 Sync 暫時修正。
重啟還原 Queue、收藏、Mixer／Deck 設定，但不載入 Deck、不還原 Sync 啟用狀態、
不自動播放；播放來源每次重新解析。開發與 release origin 儲存空間不同。
損壞／未知版本資料使用安全預設，讀寫失敗時保留本次工作階段的記憶體資料。
清理順序為快捷鍵、Workflow 訂閱，再清理 Deck／共享音訊 runtime；音訊時間更新
不觸發持久化。快捷鍵對應集中於 services/shortcuts.ts，輸入欄位／IME 不觸發。
滑桿設定最多每 250 ms 合併儲存一次；音訊變更立即生效。pagehide 與 owner 清理
會寫入尚未儲存的最後值並取消排程；強制中止程序仍可能遺失最後短暫變更。
Workflow 清單訂閱獨立且穩定的 view snapshot，EQ／Mixer 滑桿更新不重繪整個清單。
