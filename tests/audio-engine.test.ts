import assert from 'node:assert/strict';
import test from 'node:test';
import { DeckEngine, AudioPlaybackError } from '../src/audio/DeckEngine.ts';
import type { PlaybackEvent, PlaybackSession, SessionFactory } from '../src/audio/DeckEngine.ts';
import type { AudioSource } from '../src/types/audio.ts';
import type { Track } from '../src/types/track.ts';

const track = { id: 'abcdefghijk', title: 'Music', channel: 'Channel', duration: 100,
  thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk' };
const source: AudioSource = { url: 'https://rr1.googlevideo.com/audio', mimeType: 'audio/mp4', expiresAt: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class FakeSession implements PlaybackSession {
  paused = true;
  disposed = false;
  position = 0;
  volume = 0;
  playCalls = 0;
  playResult: Promise<void> = Promise.resolve();
  loadResult: Promise<void> = Promise.resolve();
  onEvent: (event: PlaybackEvent) => void;
  constructor(onEvent: (event: PlaybackEvent) => void) { this.onEvent = onEvent; }
  async load(_source: AudioSource, _signal: AbortSignal) {
    await this.loadResult;
    this.onEvent({ type: 'position', currentTime: 0, duration: 100, seekable: [[0, 100]] });
  }
  async play() { this.playCalls++; this.paused = false; await this.playResult; }
  pause() { this.paused = true; }
  seek(value: number) { this.position = value; }
  setVolume(value: number) { this.volume = value; }
  dispose() { this.paused = true; this.disposed = true; }
}
function setup(resolve: (input: Track) => Promise<AudioSource> = async () => source) {
  const sessions: FakeSession[] = [];
  const factory: SessionFactory = (onEvent) => {
    const session = new FakeSession(onEvent); sessions.push(session); return session;
  };
  return { engine: new DeckEngine(resolve, factory), sessions };
}

test('load publishes loading and ready without autoplay; play/pause update state', async () => {
  const pending = deferred<AudioSource>();
  const { engine, sessions } = setup(() => pending.promise);
  const transitions: string[] = [];
  const unsubscribe = engine.subscribe(() => transitions.push(engine.getSnapshot().status));
  assert.equal(engine.getSnapshot().status, 'idle');
  const loaded = engine.load(track);
  assert.equal(engine.getSnapshot().status, 'loading');
  pending.resolve(source); await loaded;
  assert.equal(engine.getSnapshot().track?.title, 'Music');
  assert.equal(engine.getSnapshot().duration, 100);
  assert.equal(engine.getSnapshot().status, 'ready');
  assert.equal(sessions[0].paused, true);
  await engine.play(); assert.equal(engine.getSnapshot().status, 'playing');
  engine.pause(); assert.equal(engine.getSnapshot().status, 'paused');
  assert.equal(sessions[0].paused, true);
  assert.ok(transitions.includes('loading') && transitions.includes('ready'));
  unsubscribe(); engine.dispose();
});

test('seek clamps finite positions to available ranges and volume persists on unload', async () => {
  const { engine, sessions } = setup();
  engine.setVolume(0.4); await engine.load(track);
  assert.equal(sessions[0].volume, 0.4);
  engine.seek(150); assert.equal(engine.getSnapshot().currentTime, 100);
  assert.equal(sessions[0].position, 100);
  engine.seek(-1); assert.equal(engine.getSnapshot().currentTime, 0);
  engine.setVolume(2); assert.equal(engine.getSnapshot().volume, 1);
  engine.setVolume(-1); assert.equal(engine.getSnapshot().volume, 0);
  for (const value of [NaN, Infinity]) {
    assert.throws(() => engine.seek(value), RangeError);
    assert.throws(() => engine.setVolume(value), RangeError);
  }
  engine.unload(); assert.equal(engine.getSnapshot().status, 'idle');
  assert.equal(engine.getSnapshot().track, null);
  assert.equal(engine.getSnapshot().currentTime, 0);
  assert.equal(engine.getSnapshot().volume, 0);
  assert.equal(sessions[0].disposed, true);
  engine.dispose();
});

test('unknown duration and missing ranges prevent seek; ended allows replay', async () => {
  const { engine, sessions } = setup(); await engine.load(track);
  sessions[0].onEvent({ type: 'position', currentTime: 10, duration: null, seekable: [] });
  assert.equal(engine.getSnapshot().canSeek, false);
  engine.seek(50); assert.equal(sessions[0].position, 0);
  sessions[0].onEvent({ type: 'position', currentTime: 100, duration: 100, seekable: [[0, 100]] });
  sessions[0].onEvent({ type: 'ended' });
  assert.equal(engine.getSnapshot().status, 'ended');
  await engine.play(); assert.equal(engine.getSnapshot().status, 'playing');
  assert.equal(sessions[0].position, 0);
  engine.dispose();
});

test('resolution, expiry, load and runtime playback failures become error state', async () => {
  const { engine } = setup(async () => { throw new Error('resolve failed'); });
  await engine.load(track); assert.equal(engine.getSnapshot().status, 'error');
  assert.equal(engine.getSnapshot().error?.code, 'resolutionFailed');
  const expired = setup(async () => ({ ...source, expiresAt: 1 }));
  await expired.engine.load(track);
  assert.equal(expired.engine.getSnapshot().error?.code, 'expiredSource');
  const failedLoad = new DeckEngine(async () => source, (onEvent) => {
    const s = new FakeSession(onEvent); s.loadResult = Promise.reject(new AudioPlaybackError('unsupportedSource', 'format')); return s;
  });
  await failedLoad.load(track); assert.equal(failedLoad.getSnapshot().error?.code, 'unsupportedSource');
  const playing = setup(); await playing.engine.load(track);
  playing.sessions[0].onEvent({ type: 'error', error: new AudioPlaybackError('loadFailed', 'network') });
  assert.equal(playing.engine.getSnapshot().status, 'error');
  assert.equal(playing.sessions[0].disposed, true);
  engine.dispose(); expired.engine.dispose(); failedLoad.dispose(); playing.engine.dispose();
});

test('play rejection is recoverable and duplicate play does not issue another command', async () => {
  const { engine, sessions } = setup(); await engine.load(track);
  sessions[0].playResult = Promise.reject(new AudioPlaybackError('playFailed', 'gesture'));
  await engine.play(); assert.equal(engine.getSnapshot().status, 'ready');
  assert.equal(engine.getSnapshot().error?.code, 'playFailed');
  sessions[0].playResult = Promise.resolve(); await engine.play();
  assert.equal(engine.getSnapshot().status, 'playing');
  assert.equal(engine.getSnapshot().error, null);
  await engine.play(); assert.equal(sessions[0].playCalls, 2);
  engine.pause();
  const pending = deferred<void>(); sessions[0].playResult = pending.promise;
  const playing = engine.play(); await engine.play(); assert.equal(sessions[0].playCalls, 3);
  pending.resolve(); await playing;
  engine.dispose();
});

test('seek after ending preserves the selected position when Play is pressed', async () => {
  const { engine, sessions } = setup(); await engine.load(track);
  sessions[0].onEvent({ type: 'ended' }); engine.seek(20);
  await engine.play(); assert.equal(sessions[0].position, 20);
  assert.equal(engine.getSnapshot().currentTime, 20);
  engine.dispose();
});

test('unsupported playback is terminal while a generic load rejection is loadFailed', async () => {
  const { engine, sessions } = setup(); await engine.load(track);
  sessions[0].playResult = Promise.reject(new AudioPlaybackError('unsupportedSource', 'unsupported'));
  await engine.play(); assert.equal(engine.getSnapshot().status, 'error');
  assert.equal(sessions[0].disposed, true);
  const failed = new DeckEngine(async () => source, onEvent => {
    const session = new FakeSession(onEvent); session.loadResult = Promise.reject(new Error('network')); return session;
  });
  await failed.load(track); assert.equal(failed.getSnapshot().error?.code, 'loadFailed');
  engine.dispose(); failed.dispose();
});

test('replacement stops old track and stale resolve cannot overwrite new track', async () => {
  const first = deferred<AudioSource>(); let calls = 0;
  const { engine, sessions } = setup(() => ++calls === 1 ? first.promise : Promise.resolve(source));
  const pending = engine.load(track);
  await engine.load({ ...track, title: 'Replacement' }); await engine.play();
  first.resolve(source); await pending;
  assert.equal(engine.getSnapshot().track?.title, 'Replacement');
  assert.equal(engine.getSnapshot().status, 'playing');
  const active = sessions.at(-1)!;
  await engine.load({ ...track, title: 'Third' });
  assert.equal(active.disposed, true);
  active.onEvent({ type: 'ended' });
  assert.equal(engine.getSnapshot().status, 'ready');
  engine.dispose();
});

test('pause/unload while play is pending never restores playing state', async () => {
  const { engine, sessions } = setup(); await engine.load(track);
  const pending = deferred<void>(); sessions[0].playResult = pending.promise;
  const played = engine.play(); engine.pause(); pending.resolve(); await played;
  assert.equal(engine.getSnapshot().status, 'paused');
  assert.equal(sessions[0].paused, true);
  const pending2 = deferred<void>(); sessions[0].playResult = pending2.promise;
  const played2 = engine.play(); engine.unload(); pending2.reject(new Error('aborted')); await played2;
  assert.equal(engine.getSnapshot().status, 'idle');
  engine.dispose();
});

test('starting playback from paused exposes a cancellable state until completion', async () => {
  const { engine, sessions } = setup(); await engine.load(track); engine.pause();
  const pending = deferred<void>(); sessions[0].playResult = pending.promise;
  const played = engine.play();
  assert.equal(engine.getSnapshot().starting, true);
  assert.equal(engine.getSnapshot().status, 'paused');
  engine.pause(); assert.equal(engine.getSnapshot().starting, false);
  pending.resolve(); await played;
  assert.equal(engine.getSnapshot().status, 'paused');
  assert.equal(engine.getSnapshot().starting, false);
  engine.dispose();
});

test('unload/dispose invalidates pending resolution and ignores late failures', async () => {
  const pending = deferred<AudioSource>(); const { engine } = setup(() => pending.promise);
  const loaded = engine.load(track); engine.unload(); pending.reject(new Error('network')); await loaded;
  assert.equal(engine.getSnapshot().status, 'idle');
  engine.dispose(); engine.dispose();
  await engine.load(track); assert.equal(engine.getSnapshot().status, 'idle');
});
