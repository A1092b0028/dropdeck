# Milestone 5 — 3-Band EQ + Filter

實作日期：2026-10-06。範圍僅為每個 Deck 的 EQ／Filter；Audius provider、來源政策與 Mixer 行為維持既有設計。最終 UI／聲音驗收由使用者執行，以下項目均尚未判定 PASS。

## 訊號路徑與所有權

每個 Deck：

`MediaElementAudioSourceNode → Low shelf → Mid peaking → High shelf → Filter (Low-pass → High-pass) → Deck Gain → Crossfade Gain → Master Gain → destination`

A／B 使用同一個 DeckEngine 實作，各自持有不可變的 DSP snapshot。React 僅呼叫 setLow／setMid／setHigh／setFilter／resetDsp，不操作音訊節點。DeckDsp 位於 audio 層，每個 WebAudioSession 擁有五個獨立 BiquadFilterNode。WebAudioRuntime 繼續共享 AudioContext；MixerEngine 繼續擁有 crossfade／master 節點，不因 DSP 重設或單 Deck 釋放而被銷毀。

createDeckSession 加入 DSP；原本 createSession 保留 M3 baseline 路徑，既有來源相容性測試仍使用原路徑。本次未新增播放引擎或修改 provider。

## EQ 設定

所有控制採 [-1, 1]，0 為預設。有限數值會 clamp，NaN／Infinity 會拒絕。

| Band | Type | Frequency | Q | Gain |
|---|---|---|---|---|
| Low | lowshelf | 250 Hz | 1（此類型不使用 Q） | -24 至 +6 dB |
| Mid | peaking | 1000 Hz | √(1/2)，約 0.7071（線性） | -24 至 +6 dB |
| High | highshelf | 4000 Hz | 1（此類型不使用 Q） | -24 至 +6 dB |

負控制值的 gain = value × 24 dB；正值 = value × 6 dB；0 = 0 dB。低頻 shelf 涵蓋 bass、中頻為較寬的聲音主體調整、高頻 shelf 調整亮度。削減範圍大於提升範圍以便 DJ 調整，同時限制額外提升。這不是完全 kill EQ。低取樣率時 EQ 頻率上限為 Nyquist × 0.9。

## Filter 映射與平滑

一個雙向控制操控固定串接的 LP／HP 節點，避免播放中切換節點類型或重接 graph。N = sampleRate / 2。

- center：LP = N，HP = 0，採用中性端點。
- x < 0：LP = N × (L/N)^(-x)，HP = 0；L = min(60 Hz, N × 0.1)。向左逐漸降至 60 Hz（一般取樣率）。
- x > 0：LP = N，HP = 20 × ((1 + H/20)^x − 1)；H = min(12000 Hz, N × 0.95)。向右逐漸提高至 12 kHz（一般取樣率）。

LP／HP Q = 20 log10(√(1/2))，約 -3.0103 **dB**；它與 peaking Q 的線性單位不同。依據 [Web Audio filter 規範](https://webaudio.github.io/web-audio-api/#filters-characteristics)。中心的實際中性聽感仍待使用者驗收。

已變更的 EQ gain 與 filter cutoff 使用 30 ms linear ramp；先 cancelAndHoldAtTime 保留目前自動化值。舊 WebView 若缺少該 API，退回 cancelScheduledValues／setValueAtTime。初始化在媒體載入前直接套用，避免預設值過渡；控制更新沒有 timer 或 graph 重接。

## 狀態與清理

- DSP 設定獨立於 deck volume／crossfader／master。
- play／pause／換曲／unload／錯誤均保留該 Deck 設定。
- resetDsp 僅將四個 DSP 控制歸零，不改變其他 Deck 或 Mixer。
- resolve 尚未完成時修改控制，新 session 會取得最新 snapshot。
- 換曲、unload、錯誤、dispose 取消舊節點自動化並 disconnect；清理可重複呼叫，不重複 disconnect。
- 既有 generation／session 事件隔離保持有效，舊事件不覆蓋新曲目狀態。
- 另一個 Deck 的 source／DSP／gain／播放狀態與共享 context 不受清理影響。

## 自動化測試與建置

變更檔案：

- src/audio/DeckDsp.ts（新增）
- src/audio/DeckEngine.ts
- src/audio/WebAudioSession.ts
- src/components/Deck.tsx
- src/App.tsx
- src/App.css
- tests/dsp.test.ts（新增）
- tests/deck-dsp.test.ts（新增）
- tests/helpers/audio-context.ts
- tests/dual-deck.test.ts
- README.md
- src/audio/README.md
- docs/superpowers/plans/2026-10-06-milestone-5.md（新增）
- docs/milestone-5-eq-filter.md（新增）

新增 tests/dsp.test.ts（5 項）及 tests/deck-dsp.test.ts（5 項），涵蓋三個 EQ、neutral／LP／HP、clamping、非法值、參數平滑、預設與 reset、A／B 獨立、播放／暫停、換曲／unload、解析中設定變更、stale event、錯誤重載與清理。擴充測試音訊邊界以記錄 Biquad 與 AudioParam 自動化；既有雙 Deck graph assertion 更新為 DSP 路徑，其餘既有測試保留。

| 檢查 | 結果 |
|---|---|
| npm test | PASS，56/56 |
| npm run typecheck | PASS，包含新增測試 |
| npm run build | PASS，正式前端產物 |
| cargo check --manifest-path src-tauri/Cargo.toml | PASS |
| cargo test --manifest-path src-tauri/Cargo.toml | PASS，12/12 |
| npm run tauri -- build --no-bundle | PASS，release 執行檔已產生 |
| 最終聲音／UI 驗收 | 未執行，交由使用者 |

測試先觀察缺少 DSP 實作的失敗，再完成實作。過程中的舊 graph assertion 和測試 mock 型別錯誤已修正；最終測試與型別檢查通過。一般沙箱首次桌面建置因子程序 spawn EPERM 失敗；允許建置工具啟動子程序後重新執行，未修改產品安全設定。

Mock 測試只證明程式路徑、參數與生命週期；不證明真實 DSP 聽感、無 clicks 或無 distortion。

## 限制與下一階段

提升多個 EQ band 或混合兩個 Deck 可能超過可用 headroom；本里程碑沒有 limiter／自動增益補償。需要使用 deck／master volume 控制音量。30 ms 平滑不是所有裝置均無 clicks 的保證；舊 WebView fallback 和極端取樣率仍需實機評估。既有 Audius 網路、CORS、媒體格式相容性限制仍存在。

目前沒有已確認而未修復的 M5 程式問題；聲音／UI 驗收待完成。使用者判定 PASS 後，且另行要求時，才進入 Milestone 6 Waveform + Cue；本次未實作任何 M6 功能。

## 使用者驗收（尚未勾選）

- [ ] Deck A Low changes the low-frequency content
- [ ] Deck A Mid changes the mid-frequency content
- [ ] Deck A High changes the high-frequency content
- [ ] Deck B EQ works independently
- [ ] EQ changes while music is playing
- [ ] Filter center sounds neutral
- [ ] Filter low-pass direction works
- [ ] Filter high-pass direction works
- [ ] Deck A controls do not affect Deck B
- [ ] Deck B controls do not affect Deck A
- [ ] Crossfader still works
- [ ] Master volume still works
- [ ] No obvious clicks, distortion, or audio interruption during normal control changes

只有使用者決定以上項目的 PASS／FAIL。
