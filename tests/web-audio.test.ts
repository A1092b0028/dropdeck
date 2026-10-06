import assert from 'node:assert/strict';
import test from 'node:test';
import { WebAudioRuntime } from '../src/audio/WebAudioSession.ts';
import type { PlaybackEvent } from '../src/audio/DeckEngine.ts';
import {TestParam} from './helpers/audio-context.ts';

class FakeMedia extends EventTarget {
  crossOrigin = ''; src = ''; preload = ''; currentTime = 0; duration = 120;
  volume = 1; paused = true; error: { code: number } | null = null;
  seekable = { length: 1, start: () => 0, end: () => 120 };
  canPlayType() { return 'probably'; }
  load() {}
  async play() { this.paused = false; }
  pause() { this.paused = true; }
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
}
function setup(timeout = 100) {
  const media = new FakeMedia();
  const destination = {};
  const connections: unknown[] = [];
  let disconnects = 0;
  let resumes = 0;
  let closes = 0;
  const gain = { gain: new TestParam(1), connect: (node: unknown) => connections.push(node), disconnect: () => { disconnects++; } };
  const ctx = { destination, createGain: () => gain,
    createMediaElementSource: (element: unknown) => {
      assert.equal(element, media);
      return { connect: (node: unknown) => connections.push(node), disconnect: () => { disconnects++; } };
    },
    resume: async () => { resumes++; }, close: async () => { closes++; },
  };
  const runtime = new WebAudioRuntime(() => ctx as unknown as AudioContext,
    () => media as unknown as HTMLAudioElement, timeout);
  const events: PlaybackEvent[] = [];
  const session = runtime.createSession(event => events.push(event));
  return { media, ctx, gain, destination, connections, runtime, session, events,
    counts: () => ({ disconnects, resumes, closes }) };
}
const source = { url: 'https://rr1.googlevideo.com/audio', mimeType: 'audio/mp4' as const, expiresAt: null };

test('Web Audio routes media through gain only and uses anonymous CORS before loading', async () => {
  const s = setup();
  assert.deepEqual(s.connections, [s.gain, s.destination]);
  const loaded = s.session.load(source, new AbortController().signal);
  assert.equal(s.media.crossOrigin, 'anonymous');
  assert.equal(s.media.src, source.url);
  s.media.dispatchEvent(new Event('canplay')); await loaded;
  assert.ok(s.events.some(e => e.type === 'position' && e.duration === 120));
  s.session.setVolume(0); assert.equal(s.gain.gain.value, 0);
  assert.equal(s.media.volume, 1);
  await s.session.play(); assert.equal(s.media.paused, false);
  assert.equal(s.counts().resumes, 1);
  s.session.pause(); assert.equal(s.media.paused, true);
  s.session.seek(12); assert.equal(s.media.currentTime, 12);
  s.session.dispose(); s.session.dispose();
  assert.equal(s.media.src, ''); assert.equal(s.counts().disconnects, 2);
  const count = s.events.length; s.media.dispatchEvent(new Event('timeupdate'));
  assert.equal(s.events.length, count);
  await s.runtime.dispose(); assert.equal(s.counts().closes, 1);
});

test('Web Audio reports unsupported sources, load timeout and cancellation', async () => {
  const unsupported = setup(); unsupported.media.canPlayType = () => '';
  await assert.rejects(unsupported.session.load(source, new AbortController().signal), { code: 'unsupportedSource' });
  unsupported.session.dispose(); await unsupported.runtime.dispose();
  const timed = setup(5);
  await assert.rejects(timed.session.load(source, new AbortController().signal), { code: 'loadFailed' });
  timed.session.dispose(); await timed.runtime.dispose();
  const cancelled = setup(); const abort = new AbortController();
  const loaded = cancelled.session.load(source, abort.signal); abort.abort();
  await assert.rejects(loaded, { code: 'loadFailed' });
  cancelled.session.dispose(); await cancelled.runtime.dispose();
});

test('Web Audio classifies media errors during load and after playback is ready', async () => {
  const s = setup(); const loaded = s.session.load(source, new AbortController().signal);
  s.media.error = { code: 4 }; s.media.dispatchEvent(new Event('error'));
  await assert.rejects(loaded, { code: 'unsupportedSource' });
  s.session.dispose(); await s.runtime.dispose();
  const ready = setup(); const pending = ready.session.load(source, new AbortController().signal);
  ready.media.dispatchEvent(new Event('canplay')); await pending;
  ready.media.error = { code: 2 }; ready.media.dispatchEvent(new Event('error'));
  assert.ok(ready.events.some(e => e.type === 'error' && e.error.code === 'loadFailed'));
  ready.session.dispose(); await ready.runtime.dispose();
});
