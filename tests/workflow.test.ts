import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkflowStore,restoreState,trackIdentity} from '../src/stores/WorkflowStore.ts';
import {shortcutAction,routeShortcut} from '../src/services/shortcuts.ts';
import {createDualDeck} from '../src/audio/DualDeck.ts';
import {WebAudioRuntime} from '../src/audio/WebAudioSession.ts';
import {audioBoundary} from './helpers/audio-context.ts';
import type {Track} from '../src/types/track';
const track=(id:string):Track=>({provider:'audius',id,title:id,channel:'a',duration:120,thumbnail:'',sourceUrl:`https://audius.co/a/${id}`,timing:{bpm:120,kind:'provider'},tonality:{key:'A minor',kind:'providerEstimated'}});
class Storage {value:string|null=null;writes=0;getItem(){return this.value;}setItem(_key:string,value:string){this.value=value;this.writes++;}}
function setup(storage=new Storage()){const b=audioBoundary(),dj=createDualDeck(async()=>({url:'https://cdn.example/signed?token=secret',mimeType:'audio/mpeg',expiresAt:null}),new WebAudioRuntime(b.contextFactory,b.mediaFactory));const w=new WorkflowStore(dj,storage);return {b,dj,w,storage,dispose:async()=>{w.dispose();await dj.dispose();}};}
test('queue deduplication, ordering, removal, favorites use stable track identity and persist',async()=>{
 const {w,storage,dispose}=setup();w.addQueue(track('one'));w.addQueue(track('two'));w.addQueue(track('one'));assert.deepEqual(w.getSnapshot().queue.map(t=>t.id),['one','two']);w.moveQueue(1,-1);assert.equal(w.getSnapshot().queue[0].id,'two');w.moveQueue(0,-1);w.removeQueue(trackIdentity(track('two')));assert.equal(w.getSnapshot().queue[0].id,'one');w.toggleFavorite(track('one'));assert.equal(w.getSnapshot().favorites.length,1);w.toggleFavorite(track('one'));assert.equal(w.getSnapshot().favorites.length,0);w.toggleFavorite(track('two'));assert.equal(restoreState(storage.value).favorites[0].id,'two');await dispose();
});
test('load/play history, cues/analysis/settings restore without stream URLs or autoplay',async()=>{
 const first=setup();await first.w.load('A',track('one'));first.dj.deckA.seek(3);first.dj.deckA.setCue();first.dj.deckA.setHotCue(2);first.dj.deckA.setBeatOrigin();first.dj.deckA.setVolume(.4);first.dj.deckA.setQuantize(true);await first.dj.deckA.play();
 assert.deepEqual(first.w.getSnapshot().history.map(h=>h.action),['played','loaded']);
 const writes=first.storage.writes;first.b.media[0].currentTime=4;first.b.media[0].dispatchEvent(new Event('timeupdate'));assert.equal(first.storage.writes,writes);
 assert.ok(!first.storage.value!.includes('token=secret'));const storage=first.storage;await first.dispose();
 const next=setup(storage);assert.equal(next.dj.deckA.getSnapshot().track,null);assert.equal(next.dj.deckA.getSnapshot().volume,.4);assert.equal(next.dj.deckA.getSnapshot().status,'idle');
 await next.w.load('A',track('one'));assert.equal(next.dj.deckA.getSnapshot().cue,3);assert.equal(next.dj.deckA.getSnapshot().hotCues[2],3);assert.equal(next.dj.deckA.getSnapshot().analysis!.firstBeatTime,3);assert.equal(next.dj.deckA.getSnapshot().track!.tonality!.key,'A minor');assert.equal(next.dj.deckA.getSnapshot().status,'ready');
 await next.w.load('A',track('two'));assert.equal(next.dj.deckA.getSnapshot().cue,null);assert.equal(next.dj.deckB.getSnapshot().cue,null);await next.dispose();
});
test('corrupt/versioned persistence is bounded, validated and discards unsafe resources',()=>{
 for(const value of [null,'{','null','{"version":99,"queue":[]}'])assert.equal(restoreState(value).queue.length,0);
 const value=restoreState(JSON.stringify({version:1,queue:[track('one'),{...track('bad'),sourceUrl:'https://cdn.example/signed?token=bad'},null],favorites:[track('one')],marks:{'audius:one':{cue:-1,hotCues:[NaN,3,999,4],analysis:{bpm:NaN}}}}));
 assert.equal(value.queue.length,1);assert.equal(value.marks['audius:one'].cue,null);assert.deepEqual(value.marks['audius:one'].hotCues,[null,3,null,4]);assert.equal(value.marks['audius:one'].analysis,null);
});
test('persistence failure stays recoverable and stale loads/disposal do not leak subscriptions',async()=>{
 const {w,dj,storage,dispose}=setup();storage.setItem=()=>{throw new Error('quota');};w.addQueue(track('one'));assert.match(w.getSnapshot().storageError!,/儲存/);assert.equal(w.getSnapshot().queue.length,1);await w.load('B',track('two'));w.dispose();const snapshot=w.getSnapshot();dj.deckB.seek(10);dj.deckB.setCue();assert.equal(w.getSnapshot(),snapshot);await dispose();
});
test('shortcut routing is centralized, input/modifier/repeat safe, supports both decks and marking',async()=>{
 assert.equal(shortcutAction('KeyZ',false)!.action,'playPause');assert.equal(shortcutAction('Digit8',true)!.index,3);assert.equal(shortcutAction('Digit8',true)!.deck,'B');assert.equal(shortcutAction('Digit8',true)!.action,'setHotCue');assert.equal(shortcutAction('KeyJ',false),null);
 const {dj,dispose}=setup();await dj.deckA.load(track('one'));await dj.deckB.load(track('two'));assert.equal(routeShortcut({code:'KeyZ',shiftKey:false},dj,true),false);assert.equal(routeShortcut({code:'KeyZ',ctrlKey:true},dj),false);assert.equal(routeShortcut({code:'KeyZ',repeat:true},dj),false);
 dj.deckB.seek(5);routeShortcut({code:'Digit5',shiftKey:true},dj);dj.deckB.seek(10);routeShortcut({code:'Digit5'},dj);assert.equal(dj.deckB.getCurrentTime(),5);assert.equal(dj.deckA.getCurrentTime(),0);await dispose();
});
test('YouTube favorites preserve canonical watch identity without persisting arbitrary URLs',async()=>{
 const {w,dispose}=setup();w.toggleFavorite({...track('AbCdEfGh123'),provider:'youtube',sourceUrl:'https://www.youtube.com/watch?v=AbCdEfGh123'});assert.equal(w.getSnapshot().favorites.length,1);await dispose();
});
test('legacy YouTube identity and initial mixer defaults remain compatible',async()=>{
 const {w,dj,dispose}=setup();assert.equal(dj.mixer.getMasterVolume(),.8);const legacy={...track('AbCdEfGh123'),provider:undefined,sourceUrl:'https://www.youtube.com/watch?v=AbCdEfGh123'};w.toggleFavorite(legacy);assert.equal(w.getSnapshot().favorites.length,1);assert.equal(w.getSnapshot().favorites[0].provider,'youtube');await dispose();
});
test('Sync drift trims do not write temporary playback rates into user settings',async()=>{
 const {w,dj,storage,dispose}=setup();await w.load('A',track('one'));await w.load('B',track('two'));dj.deckB.setTempo(2);const writes=storage.writes;dj.deckB.setTempo(.1,'sync');assert.equal(storage.writes,writes);assert.equal(w.getSnapshot().settings.B.tempoPercent,2);await dispose();
});
test('cached navigation waits for seekability instead of losing saved cues at canplay',async()=>{
 const first=setup();await first.w.load('A',track('one'));first.dj.deckA.seek(25);first.dj.deckA.setCue();first.dj.deckA.seek(30);first.dj.deckA.setHotCue(0);const storage=first.storage;await first.dispose();
 const b=audioBoundary(),dj=createDualDeck(async()=>({url:'https://cdn.example/song.mp3',mimeType:'audio/mpeg',expiresAt:null}),new WebAudioRuntime(b.contextFactory,()=>{const media=b.mediaFactory();Object.defineProperty(media,'seekable',{value:{length:0,start:()=>0,end:()=>120},writable:true});return media;}));
 const w=new WorkflowStore(dj,storage);await w.load('A',track('one'));assert.equal(dj.deckA.getSnapshot().canSeek,false);
 b.media[0].seekable={length:1,start:()=>0,end:()=>120};b.media[0].dispatchEvent(new Event('progress'));assert.equal(dj.deckA.getSnapshot().cue,25);assert.equal(dj.deckA.getSnapshot().hotCues[0],30);w.dispose();await dj.dispose();
});
test('rapid control edits batch persistence and flush on disposal without losing final settings',async()=>{
 const {dj,w,storage,dispose}=setup();const writes=storage.writes;for(let i=0;i<20;i++){dj.deckA.setLow(i/20);dj.mixer.setMasterVolume(i/20);}assert.equal(storage.writes,writes);w.flush();assert.equal(storage.writes,writes+1);dj.deckB.setVolume(.3);await dispose();const saved=restoreState(storage.value);assert.equal(saved.settings.A.dsp.low,.95);assert.equal(saved.settings.B.volume,.3);assert.equal(saved.mixer.masterVolume,.95);
});
test('workflow lists keep a stable view snapshot while audio controls/positions change',async()=>{
 const {w,dj,dispose}=setup();const view=w.getViewSnapshot();dj.deckA.setLow(.5);dj.mixer.setCrossfader(.3);assert.equal(w.getViewSnapshot(),view);w.addQueue(track('one'));assert.notEqual(w.getViewSnapshot(),view);await dispose();
});
