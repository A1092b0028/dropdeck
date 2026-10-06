# Drop Deck
Drop Deck Desktop App
│
├── Frontend
│   ├── React
│   ├── TypeScript
│   └── Tauri
│
├── YouTube Service
│   ├── Search
│   ├── Metadata
│   ├── Stream Resolver
│   └── yt-dlp
│
├── Audio Engine
│   ├── Deck A
│   ├── Deck B
│   ├── EQ
│   ├── Gain
│   ├── Crossfader
│   └── Master
│
└── Storage
    └── Settings / History

## Goal

Build a desktop DJ application that can search for YouTube
music and load tracks into two independent decks for mixing.

## MVP

Users must be able to:

1. Search YouTube for music.
2. Load a search result into Deck A or Deck B.
3. Play both decks simultaneously.
4. Play, pause, and seek independently.
5. Adjust volume independently.
6. Adjust Low, Mid, and High EQ independently.
7. Mix Deck A and Deck B using a crossfader.
8. Control master output volume.

## Architecture

Keep the following layers independent:

- UI
- YouTube service
- Audio engine
- Mixer engine

UI components must not call yt-dlp directly.

YouTube operations must go through a dedicated service.

Deck A and Deck B must use the same reusable DeckEngine
implementation.

## YouTube

Use yt-dlp for:

- search
- metadata extraction
- stream resolution

Normalize yt-dlp results into an internal Track model.

## Audio

Each deck should have an independent audio processing chain:

Source
→ Low EQ
→ Mid EQ
→ High EQ
→ Deck Gain
→ Crossfade Gain
→ Master Gain
→ Output

## Crossfader

Use an equal-power crossfade curve.

## Out of Scope

Do not implement these during the MVP:

- BPM detection
- Beat sync
- waveform
- loops
- hot cues
- stem separation
- authentication
- cloud sync
- playlists

## Development Principles

Follow existing patterns and make focused changes.

Keep YouTube-specific logic isolated from the UI.

Keep audio processing independent from UI state.

Do not add dependencies unless required.

Implement one milestone at a time.

Verify each milestone before proceeding.

Do not implement out-of-scope features.
