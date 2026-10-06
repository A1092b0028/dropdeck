Drop Deck

Drop Deck 是 Windows 桌面 DJ 混音應用程式，提供雙 Deck 播放、波形與混音控制，適合混搭音樂與管理播放佇列。

功能

- 雙 Deck 播放、定位與音量控制
- 波形、Cue、Hot Cue、Loop、Beat Jump、Quantize 與 Slip
- BPM、節拍格線、節拍同步及調性／Camelot 資訊
- High、Mid、Low EQ、Filter、主音量及 Crossfader
- Audius 搜尋與串流播放
- Queue、History、Favorites 與本機資料保存

下載與安裝

請前往 [Drop Deck Releases](https://github.com/A1092b0028/dropdeck/releases/tag/Drop-Deck)，下載 Windows 安裝程式並依照畫面指示安裝。

安裝程式提供繁體中文與英文介面，並包含 YouTube 搜尋所需的 `yt-dlp`。若電腦缺少 Microsoft WebView2，安裝程式會嘗試下載並安裝；此步驟需要網路連線。Windows 可能對尚未簽章的安裝程式顯示未知發行者提示。

開發環境

- Windows x64
- Node.js 與 npm
- Rust 工具鏈及 Visual Studio C++ Build Tools


目前限制


- YouTube 提供搜尋；串流播放可能受來源及瀏覽器跨來源限制影響。
- 波形只呈現實際觀察到的音訊區段；串流 Loop 不保證無縫。


