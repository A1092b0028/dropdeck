import assert from 'node:assert/strict';
import test from 'node:test';
import { isAudioSource } from '../src/types/audio.ts';
import { createLocalProvider, localControlTrack } from '../src/services/local.ts';
import { createYouTubeService, YouTubeSearchError } from '../src/services/youtube.ts';

test('compatible AudioSource supports WAV/MP3 and same-origin local assets', () => {
  for (const mimeType of ['audio/wav', 'audio/mpeg']) {
    assert.equal(isAudioSource({url:'https://audio.example/test',mimeType,expiresAt:null}), true);
  }
  assert.equal(isAudioSource({url:'http://127.0.0.1:1420/audio/poc-tone.wav',mimeType:'audio/wav',expiresAt:null}, 'http://127.0.0.1:1420'), true);
  assert.equal(isAudioSource({url:'http://elsewhere.example/audio',mimeType:'audio/wav',expiresAt:null}, 'http://127.0.0.1:1420'), false);
  assert.equal(isAudioSource({url:'file:///C:/secret.wav',mimeType:'audio/wav',expiresAt:null}), false);
});

test('local provider resolves only its fixed legal control asset', async () => {
  const provider = createLocalProvider('http://127.0.0.1:1420');
  assert.deepEqual(await provider.search(''), [localControlTrack]);
  assert.deepEqual(await provider.resolve(localControlTrack), {
    url:'http://127.0.0.1:1420/audio/poc-tone.wav',mimeType:'audio/wav',expiresAt:null,
  });
  await assert.rejects(provider.resolve({...localControlTrack,id:'arbitrary-file'}));
  assert.equal((await createLocalProvider('http://tauri.localhost').resolve(localControlTrack)).url,
    'http://tauri.localhost/audio/poc-tone.wav');
});

test('YouTube resolve retains googlevideo and original MIME restrictions', async () => {
  const track = {id:'abcdefghijk',title:'Music',channel:'Channel',duration:100,
    thumbnail:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',sourceUrl:'https://www.youtube.com/watch?v=abcdefghijk'};
  for (const payload of [
    {url:'https://audio.example/test',mimeType:'audio/mp4',expiresAt:null},
    {url:'https://rr1.googlevideo.com/audio',mimeType:'audio/wav',expiresAt:null},
  ]) {
    await assert.rejects(createYouTubeService(async()=>payload).resolve(track),
      (e:unknown)=>e instanceof YouTubeSearchError && e.code==='invalidOutput');
  }
});
