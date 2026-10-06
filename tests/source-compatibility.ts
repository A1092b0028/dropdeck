// Native test-only harness: no additional player and no remote music download.
import { DeckEngine } from '../src/audio/DeckEngine';
import { WebAudioRuntime } from '../src/audio/WebAudioSession';
import { createLocalProvider, localControlTrack } from '../src/services/local';
import type { MusicProvider } from '../src/services/music';
import type { Track } from '../src/types/track';
import { audiusProvider } from '../src/services/audius';

const status = document.querySelector<HTMLPreElement>('#status')!;
const result = document.querySelector<HTMLPreElement>('#result')!;
const checks = document.querySelector<HTMLButtonElement>('#checks')!;
const listen = document.querySelector<HTMLButtonElement>('#listen')!;
const local = createLocalProvider(location.origin);
let provider: MusicProvider = local;
let selected: Track = localControlTrack;
let audiusTracks: Track[] = [];
let busy = false, disposed = false;
const trackSelect = document.querySelector<HTMLSelectElement>('#tracks')!;
const searchResult = document.querySelector<HTMLPreElement>('#search-result')!;
const media: HTMLAudioElement[] = [];
const contexts: AudioContext[] = [];
const meters: AnalyserNode[] = [];
let postMeter: AnalyserNode;
let disconnects = 0, rawEvents = 0;

const runtime = new WebAudioRuntime(() => {
  const context = new AudioContext(); contexts.push(context);
  const createGain = context.createGain.bind(context);
  context.createGain = () => {
    const gain = createGain(); const meter = context.createAnalyser(); meter.fftSize = 2048;
    gain.connect(meter); meters.push(meter); postMeter = meter;
    const disconnect = gain.disconnect.bind(gain);
    gain.disconnect = (() => { disconnects++; disconnect(); }) as typeof gain.disconnect;
    return gain;
  };
  const createSource = context.createMediaElementSource.bind(context);
  context.createMediaElementSource = element => {
    const source = createSource(element); const disconnect = source.disconnect.bind(source);
    source.disconnect = (() => { disconnects++; disconnect(); }) as typeof source.disconnect;
    return source;
  };
  return context;
}, () => { const element = new Audio(); media.push(element); return element; });
const deck = new DeckEngine(track => provider.resolve(track), event => {
  const session = runtime.createSession(value => { rawEvents++; event(value); });
  return session;
});
function updateControls() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button')) button.disabled = busy || disposed;
  trackSelect.disabled = busy || disposed;
  const ready = ['ready', 'paused', 'playing', 'ended'].includes(deck.getSnapshot().status);
  checks.disabled = busy || disposed || !ready; listen.disabled = busy || disposed || !ready;
  document.querySelector<HTMLButtonElement>('#audius')!.disabled = busy || disposed || audiusTracks.length === 0;
}
deck.subscribe(() => {
  status.textContent = JSON.stringify(deck.getSnapshot(), null, 2);
  updateControls();
});
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function rms(): number {
  const values = new Float32Array(postMeter.fftSize); postMeter.getFloatTimeDomainData(values);
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}
async function level(volume: number) {
  deck.setVolume(volume); await sleep(350);
  const samples: number[] = [];
  for (let i = 0; i < 6; i++) { samples.push(rms()); await sleep(80); }
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}
async function prepare(nextProvider: MusicProvider, track: Track) {
  provider = nextProvider; selected = track;
  await deck.load(track);
  assert(deck.getSnapshot().status === 'ready', `load failed: ${JSON.stringify(deck.getSnapshot().error)}`);
  result.textContent = 'ready：可執行檢查／聽感確認';
}
async function runChecks() {
  const report: Record<string, unknown> = { provider: selected.provider, track: selected.id, origin: location.origin };
  try {
    deck.seek(1); await deck.play(); await sleep(800);
    const playing = deck.getSnapshot();
    assert(playing.status === 'playing' && playing.currentTime > 1.2, 'play/currentTime failed');
    assert(playing.duration !== null && playing.duration > 0, 'finite duration missing');
    report.duration = playing.duration; report.currentTime = playing.currentTime;
    report.gain1 = await level(1); report.gainQuarter = await level(0.25); report.gain0 = await level(0);
    assert((report.gain1 as number) > 0.001, 'post-Gain output is silent');
    if (selected.provider === 'local') {
      const ratio = (report.gainQuarter as number) / (report.gain1 as number);
      assert(ratio > 0.20 && ratio < 0.30, 'Gain ratio does not match 0.25');
    }
    assert((report.gain0 as number) < 0.00001, 'Gain 0 did not mute output');
    deck.pause();
    // timeupdate snapshots may lag the media clock by ~250ms. Test the clock
    // itself for continued playback, and record snapshot convergence separately.
    const pausedMedia = media.at(-1)!;
    const pausedAt = pausedMedia.currentTime;
    const pausedSnapshot = deck.getSnapshot().currentTime;
    await sleep(500);
    report.pauseDrift = Math.abs(pausedMedia.currentTime - pausedAt);
    report.pauseSnapshotCorrection = Math.abs(deck.getSnapshot().currentTime - pausedSnapshot);
    assert(pausedMedia.paused && deck.getSnapshot().status === 'paused', 'paused state missing');
    assert((report.pauseDrift as number) < 0.1, 'pause did not stop time');
    report.canSeek = deck.getSnapshot().canSeek;
    if (deck.getSnapshot().canSeek) {
      deck.seek(3); await sleep(300);
      report.seek = deck.getSnapshot().currentTime;
      assert(Math.abs((report.seek as number) - 3) < 0.2, 'seek failed');
    }
    const replacement = selected.provider === 'audius' ? audiusTracks.find(track => track.id !== selected.id) : selected;
    assert(replacement, '請搜尋至少兩首曲目，才能檢查換曲');
    deck.setVolume(0.25); await deck.play(); await sleep(300);
    const oldMedia = media.at(-1)!;
    assert(!oldMedia.paused, 'replacement test must start while playing');
    await deck.load(replacement);
    assert(deck.getSnapshot().status === 'ready', `replacement load failed: ${JSON.stringify(deck.getSnapshot().error)}`);
    assert(oldMedia.paused && !oldMedia.hasAttribute('src'), 'replacement retained old source');
    const before = rawEvents; const snapshot = deck.getSnapshot();
    oldMedia.dispatchEvent(new Event('timeupdate')); oldMedia.dispatchEvent(new Event('ended'));
    assert(rawEvents === before && deck.getSnapshot() === snapshot, 'stale events leaked after replacement');
    report.replacement = 'old source released; stale events removed';
    report.replacementTrack = replacement.id;
    const current = media.at(-1)!; deck.unload();
    assert(current.paused && !current.hasAttribute('src') && deck.getSnapshot().status === 'idle', 'unload failed');
    report.unload = 'idle; paused; src removed'; report.disconnects = disconnects;
    assert(disconnects >= 4, 'source/gain disconnect missing');
    report.technicalResult = 'PASS'; report.audibleResult = 'REQUIRES USER CONFIRMATION';
    result.textContent = JSON.stringify(report, null, 2);
  } catch (error) { report.technicalResult = 'FAIL'; report.error = String(error); result.textContent = JSON.stringify(report, null, 2); }
}
async function audibleSweep() {
  deck.seek(0); deck.setVolume(1); await deck.play();
  result.textContent = '聽感測試：一般音量（Gain 1）'; await sleep(2500);
  deck.setVolume(0.25); result.textContent = '聽感測試：較小音量（Gain 0.25）'; await sleep(2500);
  deck.setVolume(0); result.textContent = '聽感測試：靜音（Gain 0）'; await sleep(1500);
  deck.pause(); result.textContent = '聽感測試完成。請確認一般 → 較小 → 靜音。';
}
function action(button: string, operation: () => Promise<void> | void) {
  document.querySelector<HTMLButtonElement>(button)!.addEventListener('click', async () => {
    if (busy || disposed) return;
    busy = true; updateControls();
    try { await operation(); }
    catch (error) { result.textContent = String(error); }
    finally { busy = false; updateControls(); }
  });
}
action('#search', async () => {
  audiusTracks = []; trackSelect.replaceChildren(); searchResult.textContent = '搜尋中…';
  audiusTracks = await audiusProvider.search(document.querySelector<HTMLInputElement>('#query')!.value);
  // Put shorter tracks first for a small compatibility test; no playlist behavior.
  audiusTracks.sort((a,b) => (a.duration ?? 0) - (b.duration ?? 0));
  for (const track of audiusTracks) {
    const option = document.createElement('option'); option.value = track.id;
    option.textContent = `${track.title} · ${track.channel} · ${track.duration}s`; trackSelect.append(option);
  }
  searchResult.textContent = JSON.stringify(audiusTracks,null,2);
});
action('#audius', async () => {
  const track = audiusTracks.find(track => track.id === trackSelect.value);
  assert(track, '請先搜尋並選擇曲目'); await prepare(audiusProvider,track);
});
action('#local', () => prepare(local, localControlTrack));
action('#checks', runChecks); action('#listen', audibleSweep); action('#unload', () => deck.unload());
action('#dispose', async () => {
  deck.dispose(); for (const meter of meters) meter.disconnect(); await runtime.dispose();
  assert(contexts.every(context => context.state === 'closed'), 'AudioContext not closed');
  assert(media.every(element => element.paused && !element.hasAttribute('src')), 'media retained source');
  disposed = true;
  result.textContent = JSON.stringify({dispose:'PASS',contexts:contexts.map(context=>context.state),mediaCount:media.length,disconnects},null,2);
});
updateControls();
window.addEventListener('pagehide', () => {
  deck.dispose(); for (const meter of meters) meter.disconnect(); void runtime.dispose();
});
// Exports are only for a future native Audius test UI in this test harness.
export { prepare, deck, runtime, contexts, result, action };
