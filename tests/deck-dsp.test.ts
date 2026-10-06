import assert from 'node:assert/strict';
import test from 'node:test';
import { createDualDeck } from '../src/audio/DualDeck.ts';
import { WebAudioRuntime } from '../src/audio/WebAudioSession.ts';
import { defaultDspState } from '../src/audio/DeckDsp.ts';
import { audioBoundary } from './helpers/audio-context.ts';
import type { AudioSource } from '../src/types/audio.ts';
import type { Track } from '../src/types/track.ts';

const source:AudioSource={url:'https://cdn.example/song.mp3',mimeType:'audio/mpeg',expiresAt:null};
const track=(id:string):Track=>({provider:'audius',id,title:id,channel:'Artist',duration:120,thumbnail:'',sourceUrl:`https://audius.co/artist/${id}`});
function setup(resolve:(track:Track)=>Promise<AudioSource>=async()=>source) {
  const b=audioBoundary(); return {b,dj:createDualDeck(resolve,new WebAudioRuntime(b.contextFactory,b.mediaFactory))};
}

test('independent deck DSP state clamps input, starts neutral and resets only DSP',async()=>{
  const {b,dj}=setup();
  assert.deepEqual(dj.deckA.getSnapshot().dsp,defaultDspState);
  assert.notEqual(dj.deckA.getSnapshot().dsp,dj.deckB.getSnapshot().dsp);
  const beforeB=dj.deckB.getSnapshot();
  dj.deckA.setVolume(0.3); dj.mixer.setCrossfader(-0.4); dj.mixer.setMasterVolume(0.5);
  const mixer=dj.mixer.getSnapshot();
  dj.deckA.setLow(-2); dj.deckA.setMid(2); dj.deckA.setHigh(0.5); dj.deckA.setFilter(2);
  assert.deepEqual(dj.deckA.getSnapshot().dsp,{low:-1,mid:1,high:0.5,filter:1});
  assert.equal(dj.deckB.getSnapshot(),beforeB);
  assert.equal(b.biquads.length,0);
  for(const value of [NaN,Infinity,-Infinity]) {
    for(const setter of ['setLow','setMid','setHigh','setFilter'] as const) assert.throws(()=>dj.deckA[setter](value),RangeError);
  }
  dj.deckA.resetDsp();
  assert.deepEqual(dj.deckA.getSnapshot().dsp,defaultDspState);
  assert.equal(dj.deckA.getSnapshot().volume,0.3); assert.equal(dj.mixer.getSnapshot(),mixer);
  assert.equal(dj.deckB.getSnapshot(),beforeB); await dj.dispose();
});

test('both decks process EQ/filter independently while playing and retain settings on pause',async()=>{
  const {b,dj}=setup();
  await dj.deckA.load(track('one')); await dj.deckB.load(track('two'));
  await dj.deckA.play(); await dj.deckB.play();
  const beforeB=dj.deckB.getSnapshot();
  dj.deckA.setLow(-1); dj.deckA.setMid(0.5); dj.deckA.setHigh(1); dj.deckA.setFilter(-1);
  assert.deepEqual(b.biquads.slice(0,3).map(n=>n.gain.value),[-24,3,6]);
  assert.equal(b.biquads[3].frequency.value,60);
  assert.equal(dj.deckA.getSnapshot().status,'playing'); assert.equal(dj.deckB.getSnapshot(),beforeB);
  assert.ok(b.biquads.slice(5,8).every(n=>n.gain.value===0));
  const a=dj.deckA.getSnapshot(); dj.deckB.setHigh(-0.5); dj.deckB.setFilter(1);
  assert.equal(b.biquads[7].gain.value,-12);
  assert.ok(Math.abs(b.biquads[9].frequency.value-12000)<1e-8);
  assert.equal(dj.deckA.getSnapshot(),a);
  dj.deckA.pause(); await dj.deckA.play();
  assert.equal(dj.deckA.getSnapshot().dsp,a.dsp);
  assert.equal(b.media[1].paused,false);
  await dj.dispose();
});

test('replacement/unload preserve deck DSP and mixer state and release all old DSP nodes',async()=>{
  const {b,dj}=setup();
  dj.deckA.setLow(-0.5); dj.deckA.setFilter(0.5);
  await dj.deckA.load(track('one')); await dj.deckB.load(track('two')); await dj.deckB.play();
  const state=dj.deckA.getSnapshot().dsp, beforeB=dj.deckB.getSnapshot(), mixer=dj.mixer.getSnapshot();
  const oldNodes=b.biquads.slice(0,5), oldMedia=b.media[0];
  await dj.deckA.load(track('replacement'));
  assert.equal(dj.deckA.getSnapshot().dsp,state);
  assert.equal(b.biquads[10].gain.value,-12); assert.equal(b.biquads[10].gain.ramps.length,0);
  assert.ok(b.biquads[14].frequency.value>0);
  assert.ok(oldNodes.every(n=>n.disconnects===1));
  oldMedia.dispatchEvent(new Event('ended')); oldMedia.dispatchEvent(new Event('timeupdate'));
  assert.equal(dj.deckA.getSnapshot().dsp,state); assert.equal(dj.deckA.getSnapshot().status,'ready');
  dj.deckA.unload();
  assert.equal(dj.deckA.getSnapshot().dsp,state);
  assert.ok(b.biquads.slice(10,15).every(n=>n.disconnects===1));
  assert.ok(b.biquads.slice(5,10).every(n=>n.disconnects===0));
  assert.equal(dj.deckB.getSnapshot(),beforeB); assert.equal(dj.mixer.getSnapshot(),mixer);
  assert.equal(b.media[1].paused,false); assert.equal(b.counts().closes,0);
  await dj.dispose(); await dj.dispose();
  assert.ok(b.biquads.every(n=>n.disconnects===1)); assert.equal(b.counts().closes,1);
});

test('latest DSP edits during pending resolution apply to the replacement and ignore stale work',async()=>{
  let finish!:(value:AudioSource)=>void;
  const pending=new Promise<AudioSource>(resolve=>{finish=resolve;});
  const {b,dj}=setup(async t=>t.id==='pending'?pending:source);
  const stale=dj.deckA.load(track('pending')); dj.deckA.setMid(-1);
  await dj.deckA.load(track('new')); dj.deckA.setFilter(-0.5);
  const latest=dj.deckA.getSnapshot(); finish(source); await stale;
  assert.equal(dj.deckA.getSnapshot(),latest); assert.equal(b.media.length,1);
  assert.equal(b.biquads[1].gain.value,-24); assert.ok(b.biquads[3].frequency.value<24000);
  dj.deckA.dispose(); const ramps=b.biquads[1].gain.ramps.length;
  dj.deckA.setMid(1); dj.deckA.resetDsp();
  assert.equal(b.biquads[1].gain.ramps.length,ramps); await dj.dispose();
});

test('playback error releases only that deck DSP and preserves controls for a fresh load',async()=>{
  const {b,dj}=setup();
  await dj.deckA.load(track('one')); await dj.deckB.load(track('two')); await dj.deckB.play();
  dj.deckA.setHigh(0.5); dj.deckA.setFilter(-0.5);
  const state=dj.deckA.getSnapshot().dsp, beforeB=dj.deckB.getSnapshot();
  b.media[0].error={code:3}; b.media[0].dispatchEvent(new Event('error'));
  assert.equal(dj.deckA.getSnapshot().status,'error'); assert.equal(dj.deckA.getSnapshot().dsp,state);
  assert.ok(b.biquads.slice(0,5).every(n=>n.disconnects===1));
  assert.ok(b.biquads.slice(5,10).every(n=>n.disconnects===0));
  assert.equal(dj.deckB.getSnapshot(),beforeB); assert.equal(b.media[1].paused,false);
  await dj.deckA.load(track('retry'));
  assert.equal(b.biquads[12].gain.value,3); assert.ok(b.biquads[13].frequency.value<24000);
  assert.equal(dj.deckB.getSnapshot(),beforeB);
  await dj.dispose(); assert.ok(b.biquads.every(n=>n.disconnects===1));
});
