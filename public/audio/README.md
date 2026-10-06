# 本機控制音

poc-tone.wav 是本專案自行合成的 12 秒 440/660 Hz 控制音，無外部採樣或遠端音樂。
PCM 16-bit mono、22050 Hz，低振幅並帶短淡入／淡出。可自由用於本專案測試。

可用 `node scripts/generate-poc-tone.mjs` 重建。此檔案只作為來源相容性基準，
必須經過既有 DeckEngine → WebAudioSession → Source → Gain → Output 播放。
