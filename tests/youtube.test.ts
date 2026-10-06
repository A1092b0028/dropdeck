import assert from 'node:assert/strict';
import test from 'node:test';
import { createYouTubeService, youtubeService, YouTubeSearchError } from '../src/services/youtube.ts';
import { formatDuration } from '../src/types/track.ts';

const track = {
  id: 'abcdefghijk', title: '測試音樂', channel: '測試頻道', duration: 214,
  thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
  sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
};

test('search trims a query and returns normalized tracks from the native boundary', async () => {
  const service = createYouTubeService(async (command, args) => {
    assert.equal(command, 'search_youtube');
    assert.deepEqual(args, { query: '測試音樂' });
    return [track];
  });
  assert.deepEqual(await service.search('  測試音樂  '), [track]);
});

test('empty results remain empty rather than being replaced by preview data', async () => {
  assert.deepEqual(await createYouTubeService(async () => []).search('music'), []);
});

test('blank and oversized queries never invoke the backend', async () => {
  const service = createYouTubeService(async () => { assert.fail('backend must not run'); });
  for (const query of ['   ', '音'.repeat(201)]) {
    await assert.rejects(service.search(query), (error: unknown) =>
      error instanceof YouTubeSearchError && error.code === 'invalidQuery');
  }
});

test('query limits count Unicode characters rather than UTF-16 code units', async () => {
  const service = createYouTubeService(async () => []);
  assert.deepEqual(await service.search('🎵'.repeat(200)), []);
  await assert.rejects(service.search('🎵'.repeat(201)), (error: unknown) =>
    error instanceof YouTubeSearchError && error.code === 'invalidQuery');
});

test('native error categories survive the service boundary and support retry', async () => {
  for (const code of ['notInstalled', 'executionFailed', 'searchFailed', 'invalidOutput'] as const) {
    let fail = true;
    const service = createYouTubeService(async () => {
      if (fail) throw { code, message: '搜尋失敗' };
      return [track];
    });
    await assert.rejects(service.search('music'), (error: unknown) =>
      error instanceof YouTubeSearchError && error.code === code && error.message === '搜尋失敗');
    fail = false;
    assert.deepEqual(await service.search('music'), [track]);
  }
});

test('unexpected IPC failures have a readable error', async () => {
  const service = createYouTubeService(async () => { throw new Error('IPC unavailable'); });
  await assert.rejects(service.search('music'), (error: unknown) =>
    error instanceof YouTubeSearchError && error.code === 'executionFailed' && error.message.length > 0);
});

test('browser preview rejects native search with a desktop-specific explanation', async () => {
  await assert.rejects(youtubeService.search('music'), (error: unknown) =>
    error instanceof YouTubeSearchError && error.code === 'desktopRequired');
});

test('invalid native payloads are rejected instead of entering UI state', async () => {
  for (const payload of [null, {}, [null], [{ ...track, duration: -1 }], [{ ...track, duration: NaN }],
    [{ ...track, duration: Infinity }], [{ ...track, title: 42 }], [{ ...track, title: ' ' }],
    [{ ...track, sourceUrl: 'https://other.example/stream' }], [{ ...track, thumbnail: 'https://other.example/image' }]]) {
    await assert.rejects(createYouTubeService(async () => payload).search('music'), (error: unknown) =>
      error instanceof YouTubeSearchError && error.code === 'invalidOutput');
  }
});

test('unknown durations and live metadata can cross the service boundary', async () => {
  const liveTrack = { ...track, duration: null };
  assert.deepEqual(await createYouTubeService(async () => [liveTrack]).search('live'), [liveTrack]);
});

test('duration labels handle unknown, zero, fractional seconds and long videos', () => {
  const cases: Array<[number | null, string]> = [
    [null, '時長未知'], [0, '0:00'], [214, '3:34'], [59.9, '0:59'], [3661, '1:01:01'],
  ];
  for (const [duration, expected] of cases) assert.equal(formatDuration(duration), expected);
});

const audioSource = {
  url: 'https://rr1.googlevideo.com/videoplayback?expire=2000000000',
  mimeType: 'audio/mp4', expiresAt: 2000000000,
};

test('resolve sends only the track ID and returns a normalized audio source', async () => {
  const service = createYouTubeService(async (command, args) => {
    assert.equal(command, 'resolve_youtube_audio');
    assert.deepEqual(args, { trackId: 'abcdefghijk' });
    return audioSource;
  });
  assert.deepEqual(await service.resolve(track), audioSource);
});

test('resolve rejects invalid tracks before IPC', async () => {
  const service = createYouTubeService(async () => { assert.fail('no IPC'); });
  await assert.rejects(service.resolve({ ...track, id: '--bad' }),
    (e: unknown) => e instanceof YouTubeSearchError && e.code === 'invalidTrack');
});

test('resolve rejects unsafe URLs, unsupported MIME and invalid expiry', async () => {
  for (const payload of [null, {}, { ...audioSource, url: 'http://rr1.googlevideo.com/audio' },
    { ...audioSource, url: 'https://googlevideo.com.evil.example/audio' },
    { ...audioSource, url: 'https://user:pass@rr1.googlevideo.com/audio' },
    { ...audioSource, mimeType: 'video/mp4' }, { ...audioSource, expiresAt: -1 },
    { ...audioSource, expiresAt: 1.5 }]) {
    await assert.rejects(createYouTubeService(async () => payload).resolve(track),
      (e: unknown) => e instanceof YouTubeSearchError && e.code === 'invalidOutput');
  }
});

test('resolution errors retain their native categories', async () => {
  for (const code of ['resolutionFailed', 'unsupportedSource', 'notInstalled'] as const) {
    await assert.rejects(createYouTubeService(async () => { throw { code, message: '解析失敗' }; }).resolve(track),
      (e: unknown) => e instanceof YouTubeSearchError && e.code === code);
  }
  assert.deepEqual(await createYouTubeService(async () => ({ ...audioSource, expiresAt: null })).resolve(track),
    { ...audioSource, expiresAt: null });
});
