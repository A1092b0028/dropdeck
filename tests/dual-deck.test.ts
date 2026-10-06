import assert from 'node:assert/strict';
import test from 'node:test';
import { createDualDeck } from '../src/audio/DualDeck.ts';
import { WebAudioRuntime } from '../src/audio/WebAudioSession.ts';
import { DeckEngine } from '../src/audio/DeckEngine.ts';
import { audioBoundary } from './helpers/audio-context.ts';
import type { Track } from '../src/types/track.ts';
import type { AudioSource } from '../src/types/audio.ts';

const track=(id:string):Track=>({provider:'audius',id,title:id,channel:'Artist',duration:120,thumbnail:'',sourceUrl:`https://audius.co/artist/${id}`});
const source:AudioSource={url:'https://val001.open-audio-validator.com/tracks/cidstream/test',mimeType:'audio/mpeg',expiresAt:null};
function setup(resolve:(track:Track)=>Promise<AudioSource>=async()=>source) {
  const b=audioBoundary(), runtime=new WebAudioRuntime(b.contextFactory,b.mediaFactory);
  return {b,runtime,dj:createDualDeck(resolve,runtime)};
}

test('two reusable decks play with independent gains through the same mixer/context',async()=>{
  const {b,dj}=setup(); assert.ok(dj.deckA instanceof DeckEngine && dj.deckB instanceof DeckEngine);
  await Promise.all([dj.deckA.load(track('one')),dj.deckB.load(track('two'))]);
  await Promise.all([dj.deckA.play(),dj.deckB.play()]);
  assert.equal(dj.deckA.getSnapshot().status,'playing'); assert.equal(dj.deckB.getSnapshot().status,'playing');
  assert.equal(b.counts().contexts,1);
  const [crossA,crossB,master,deckA,deckB]=b.gains;
  assert.deepEqual(b.sources[0].node.connections,[b.biquads[0],b.analysers[0]]); assert.deepEqual(b.sources[1].node.connections,[b.biquads[5],b.analysers[1]]);
  for(const [start,gain] of [[0,deckA],[5,deckB]] as const) {
    for(let i=0;i<4;i++) assert.deepEqual(b.biquads[start+i].connections,[b.biquads[start+i+1]]);
    assert.deepEqual(b.biquads[start+4].connections,[gain]);
  }
  assert.deepEqual(deckA.connections,[crossA]); assert.deepEqual(deckB.connections,[crossB]);
  assert.deepEqual(crossA.connections,[master]); assert.deepEqual(crossB.connections,[master]);
  assert.deepEqual(master.connections,[b.destination]);
  dj.deckA.setVolume(0.2); dj.deckB.setVolume(0.6);
  assert.equal(deckA.gain.value,0.2); assert.equal(deckB.gain.value,0.6);
  dj.mixer.setCrossfader(-1); dj.mixer.setMasterVolume(0.5);
  assert.equal(deckA.gain.value,0.2); assert.equal(deckB.gain.value,0.6);
  assert.equal(crossA.gain.value,1); assert.equal(crossB.gain.value,0); assert.equal(master.gain.value,0.5);
  const beforeB=dj.deckB.getSnapshot(); dj.deckA.pause(); dj.deckA.seek(40);
  assert.equal(dj.deckA.getSnapshot().currentTime,40); assert.equal(dj.deckB.getSnapshot(),beforeB);
  assert.equal(b.media[1].paused,false);
  await dj.dispose(); assert.equal(b.counts().closes,1);
});

test('replacement/unload and stale events stay isolated; disposal of one deck preserves the other',async()=>{
  const {b,dj}=setup();
  await dj.deckA.load(track('one')); await dj.deckB.load(track('two')); await dj.deckB.play(); await dj.deckA.play();
  const beforeB=dj.deckB.getSnapshot(), old=b.media[0];
  await dj.deckA.load(track('three'));
  assert.equal(old.paused,true); assert.equal(old.src,''); assert.equal(dj.deckB.getSnapshot(),beforeB);
  const newA=dj.deckA.getSnapshot(); old.currentTime=90; old.dispatchEvent(new Event('timeupdate')); old.dispatchEvent(new Event('ended'));
  assert.equal(dj.deckA.getSnapshot(),newA); assert.equal(dj.deckB.getSnapshot(),beforeB);
  dj.deckA.unload(); assert.equal(dj.deckA.getSnapshot().status,'idle'); assert.equal(b.media[2].src,'');
  assert.equal(dj.deckB.getSnapshot(),beforeB); assert.equal(b.media[1].paused,false);
  dj.deckA.dispose(); assert.equal(b.counts().closes,0); dj.deckB.seek(12);
  assert.equal(dj.deckB.getSnapshot().currentTime,12);
  await dj.dispose(); await dj.dispose();
  assert.equal(b.counts().closes,1); assert.ok(b.media.every(m=>m.paused && !m.src));
  assert.ok(b.gains.every(node=>node.disconnects===1)); assert.ok(b.sources.every(({node})=>node.disconnects===1));
});

test('pending old resolution and deck errors do not overwrite the other deck',async()=>{
  let finish!:(source:AudioSource)=>void;
  const pending=new Promise<AudioSource>(resolve=>{finish=resolve;});
  const {b,dj}=setup(async t=>{if(t.id==='pending')return pending; if(t.id==='failure')throw new Error('provider failed'); return source;});
  const old=dj.deckA.load(track('pending')); await dj.deckB.load(track('two')); await dj.deckB.play();
  await dj.deckA.load(track('new')); const a=dj.deckA.getSnapshot(), deckB=dj.deckB.getSnapshot();
  finish(source); await old; assert.equal(dj.deckA.getSnapshot(),a); assert.equal(dj.deckB.getSnapshot(),deckB);
  await dj.deckA.load(track('failure')); assert.equal(dj.deckA.getSnapshot().error?.code,'resolutionFailed');
  assert.equal(dj.deckB.getSnapshot(),deckB); assert.equal(b.media[0].paused,false);
  await dj.dispose();
});

test('runtime disposal releases live sessions exactly once',async()=>{
  const {b,runtime,dj}=setup(); await dj.deckA.load(track('one')); await dj.deckA.play();
  await runtime.dispose(); await runtime.dispose();
  assert.equal(b.media[0].paused,true); assert.equal(b.media[0].src,''); assert.equal(b.counts().closes,1);
  assert.ok(b.gains.every(node=>node.disconnects===1));
  assert.throws(()=>runtime.createDeckSession('B',()=>{}),/關閉/);
  await dj.dispose(); assert.equal(b.counts().closes,1);
});

test('Deck B pause/seek/replacement/unload leave Deck A playing and its gain untouched',async()=>{
  const {b,dj}=setup(); await dj.deckA.load(track('one')); await dj.deckB.load(track('two'));
  await dj.deckA.play(); await dj.deckB.play(); dj.deckA.setVolume(0.35);
  const a=dj.deckA.getSnapshot(), oldB=b.media[1], gainA=b.gains[3];
  dj.deckB.pause(); dj.deckB.seek(25); dj.deckB.setVolume(0.1);
  assert.equal(dj.deckA.getSnapshot(),a); assert.equal(b.media[0].paused,false); assert.equal(gainA.gain.value,0.35);
  await dj.deckB.play(); await dj.deckB.load(track('three'));
  const newB=dj.deckB.getSnapshot(); oldB.dispatchEvent(new Event('ended')); oldB.dispatchEvent(new Event('timeupdate'));
  assert.equal(dj.deckB.getSnapshot(),newB); assert.equal(dj.deckA.getSnapshot(),a);
  dj.deckB.unload(); assert.equal(dj.deckA.getSnapshot(),a); assert.equal(b.media[0].paused,false);
  assert.equal(gainA.gain.value,0.35); assert.equal(b.counts().closes,0);
  await dj.dispose();
});

test('runtime cleanup cancels a loading session and removes its event listeners',async()=>{
  const b=audioBoundary();
  const runtime=new WebAudioRuntime(b.contextFactory,()=>{
    const media=b.mediaFactory(); media.load=()=>{}; return media;
  });
  const events:unknown[]=[]; const session=runtime.createDeckSession('A',event=>events.push(event));
  const loading=session.load(source,new AbortController().signal);
  const cancelled=assert.rejects(loading,{code:'loadFailed'});
  await runtime.dispose(); await cancelled;
  const count=events.length; b.media[0].dispatchEvent(new Event('canplay')); b.media[0].dispatchEvent(new Event('timeupdate'));
  assert.equal(events.length,count); assert.equal(b.media[0].src,''); assert.equal(b.counts().closes,1);
  assert.ok(b.gains.every(node=>node.disconnects===1));
});
