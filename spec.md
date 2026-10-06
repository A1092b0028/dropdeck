# DropDeck Specification

## 1. Overview

DropDeck is a desktop DJ mixing application built with:

- React
- TypeScript
- Vite
- Tauri
- Rust
- Web Audio API
- Audius

The application provides a dual-deck DJ workflow with real-time mixing,
waveforms, EQ, cue points, beat analysis, synchronization, performance tools,
and track management.

The architecture must remain modular so music providers and audio features can
evolve independently.

---

# 2. Core Principles

- Keep UI, provider, audio, analysis, deck, mixer, and persistence separated.
- Keep real-time audio processing outside React.
- Deck A and Deck B must share reusable implementations.
- UI must not directly manipulate Web Audio nodes.
- Provider-specific logic must remain behind a service abstraction.
- Avoid unnecessary dependencies and large architectural rewrites.
- Do not implement fake controls or simulated audio behavior.
- Prefer reliable functionality over feature quantity.
- Avoid audio-rate React state updates.

---

# 3. Architecture

```text
React UI
   │
   ├── Deck UI
   ├── Mixer UI
   ├── Waveform UI
   └── Library UI
        │
        ▼
Application Services
   │
   ├── MusicProvider
   ├── AnalysisService
   ├── PersistenceService
   └── SessionService
        │
        ▼
DJ Engines
   │
   ├── DeckEngine A
   ├── DeckEngine B
   ├── MixerEngine
   ├── BeatSyncEngine
   ├── QuantizeEngine
   └── Performance Engine
        │
        ▼
Web Audio
