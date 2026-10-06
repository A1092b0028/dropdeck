# Audio

The DJ workspace uses two instances of the same `DeckEngine`. `createDualDeck`
owns both engines and one shared `WebAudioRuntime` / AudioContext.

`DeckEngine` owns state, stream resolution, replacement/cancellation and controls.
It also owns one cue and four hot cues per deck/load. Navigation uses its existing
seek path and preserves playback state; every load/unload clears markers, including
reloading the same ID. WorkflowStore restores validated per-track markers after
loading, without seeking or starting playback. Markers do not enter the DSP path.
AnalysisService interprets normalized provider timing outside DeckEngine/React;
the composition layer injects its result function. Invalid/absent analysis never
blocks playback. Each deck holds immutable TrackAnalysis; BPM and beat origin reset
on every load, while tempo percent is retained like deck/DSP controls. Provider
estimates remain labeled approximate with unknown confidence. First beat defaults
to an explicitly assumed 0-second origin; setBeatOrigin captures source time manually.
Beat-grid calculations use source seconds and never change with playback rate;
dense drawing retains every Nth source beat and makes no bar/downbeat assumptions.
WebAudioSession sets playbackRate/defaultPlaybackRate in [0.8,1.2] (Tempo ±20%) with
preservesPitch=false by default. Independent Key Lock requests native
HTMLMediaElement.preservesPitch where available; tempo/Sync never overwrite it.
Browser pitch-preservation quality requires audible user acceptance and is not
a dedicated professional time-stretching DSP. Tempo utilities only
convert constant-rate segment durations, not lifetime elapsed wall-clock time.

The composition owner also owns BeatSyncEngine, disposed before the decks/runtime.
It owns one master/follower relationship and a 250 ms timer only while enabled;
React observes snapshots and invokes operations, without timing/DSP calculations.
Pure beat-sync math matches effective master BPM against follower BPM with factors
1/2/0.5 and refuses rates beyond 0.8..1.2. Phase uses source beat intervals adjusted
by that factor; explicit Sync performs one nearest in-range follower seek. Original
BPM/grid/cue data is not rewritten. Assumed origins remain visibly unverified.
Drift uses shortest circular phase error in real seconds: 15 ms deadband, at most
0.5% relative-rate trim, hard tempo bounds; >180 ms stops correction rather than
adding repeated seeks. Trim errors immediately disable Sync. No sample-accurate
audible phase lock, bar alignment or whole-beat drift detection is claimed.
Disable/replacement releases captured timing snapshots and clears the displayed
match; restoring a drift trim happens before notifying Sync subscribers.
DeckEngine tracks user seek/tempo intent revisions separately from Sync commands.
Pause waits without transport changes; resume or a quiet user seek allows one
re-alignment after 300 ms and after media.seeking ends. Manual tempo/grid changes,
replacement, unload/end/error and master selection disable Sync. Disable restores
the matched base tempo after trims, except a follower's new manual tempo always wins.
Initial phase failure restores the pre-Sync tempo. Timer and deck subscriptions are
released idempotently; the master is never controlled by Sync. HTMLMediaElement seek,
decoding latency and throttled background timers limit audible synchronization.
`WebAudioSession` owns media events and Source → `DeckDsp` → Deck Gain → its assigned output.
`MixerEngine` owns Crossfade Gain A/B → Master Gain → Output, using an
equal-power crossfade. React only subscribes to snapshots and sends commands.
`DeckDsp` owns Low shelf → Mid peaking → High shelf → fixed LP/HP filter stage.
DeckEngine snapshots own independent normalized DSP state, retained across
pause/replacement/unload; resetDsp only resets EQ/filter. Each replacement
session gets current DSP state before media loading and owns/disconnects its nodes.
Legacy runtime.createSession keeps the original M3 Source → Gain route;
runtime.createDeckSession creates the production DSP route for both decks.
Each production session also owns a raw-source AnalyserNode side branch with no
output connection. Runtime reads samples by deck; WaveformService outside DeckEngine
collects bounded observed peaks only. Canvas redraw/sample reads are capped at 20 Hz
and canceled on track replacement/unmount. Playhead reads DeckEngine position without
audio-rate React updates. DeckEngine.getCurrentTime reads the current session position
for cue capture and canvas observations without notifying subscribers; event snapshots
remain the ordinary React update path. Missing peaks remain unknown; this is not a decoded full-track
waveform. Sessions disconnect analysers on replacement, unload, error and disposal.

Resolution and session factories are injected for focused tests. The production
resolver uses the existing Audius provider; the media element
uses anonymous CORS. Source URLs are refreshed on load and never persisted.

Native play completion checks the latest transport intent: a late Play cannot
restart paused/unloaded media, and a failed context resume silences its pending
media play. Disposal rejects reentrant deck loads before notifying subscribers.
Partial session/DSP/mixer allocation failures disconnect already-created nodes;
all runtime disposal callers await the same context shutdown. Seek ranges are
bounded by valid media duration; unavailable timing never blocks ordinary playback.

Deck gain, crossfade gains and master gain retarget 20 ms ramps, canceled at
disposal, without graph reconnection. EQ/filter retain their existing 30 ms ramps.
React subscriptions reside in individual Deck/Mixer panels, keeping ordinary
position updates out of App/search. Waveform uses one cancellable 20 Hz frame loop,
reuses its sample buffer and caches beat markers until analysis/duration changes.
Stress tests count node disconnections, media listeners and context ownership;
they do not establish long-duration audible stability or native memory usage.

PerformanceEngine owns per-deck source-time beat loops/jumps and optional Slip.
Pure performance-timing utilities centralize grid snapping, boundary clamping and
logical timeline integration. Quantize snaps cue capture to the nearest source
beat; loops start at the preceding beat and require their full region in the track.
RAF observes actual media position for loop-end seeks, not a UI beat timer.
Streaming loops are not seamless/sample-accurate and foreground RAF throttling,
media seeking/buffering latency and assumed beat origins limit their accuracy.
Slip preserves a rate-integrated monotonic logical timeline while looping or during
explicit Cue/Hot Cue excursions, freezes when paused and returns via Slip Return
or Loop OFF. Manual seeking/track replacement/end/error cancels the excursion.
Performance navigation disables Sync explicitly; Sync refuses active Loop/Slip.
No automatic phase correction competes with these temporary actions. Controls
do not reconnect the audio graph; performance schedulers are stopped on cleanup.

Real native YouTube loading failed in this POC. See
`docs/milestone-3-audio-engine-poc.md` for evidence and the transport limitation.
M4 ownership, checks and unchecked user acceptance are documented in
`docs/milestone-4-dual-deck-mixer.md`. M5 DSP configuration and unchecked audio
acceptance are in `docs/milestone-5-eq-filter.md`. Mock audio tests do not prove audible output.
