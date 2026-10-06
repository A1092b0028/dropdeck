import test from 'node:test';
import assert from 'node:assert/strict';
import {matchBpm,beatPhase,nearestPhaseTime,phaseErrorSeconds} from '../src/audio/beat-sync-math.ts';
import {BeatSyncEngine} from '../src/audio/BeatSyncEngine.ts';
import {createDualDeck} from '../src/audio/DualDeck.ts';
import {WebAudioRuntime} from '../src/audio/WebAudioSession.ts';
import {audioBoundary} from './helpers/audio-context.ts';
import {analyzeTrack} from '../src/services/analysis.ts';
import type {Track} from '../src/types/track.ts';
const track=(id:string,bpm?:number):Track=>({provider:'audius',id,title:id,channel:'Artist',duration:120,thumbnail:'',sourceUrl:'https://audius.co/a/'+id,...(bpm?{timing:{bpm,kind:'providerEstimated' as const}}:{})});
class Clock {time=0;callback:(()=>void)|null=null;stops=0;now=()=>this.time;start=(callback:()=>void)=>{this.callback=callback;return()=>{this.callback=null;this.stops++;};};tick(ms=250){this.time+=ms;this.callback?.();}}
async function setup(a=120,b=125){const boundary=audioBoundary(),clock=new Clock();const dj=createDualDeck(async()=>({url:'https://cdn.example/track.mp3',mimeType:'audio/mpeg',expiresAt:null}),new WebAudioRuntime(boundary.contextFactory,boundary.mediaFactory));const sync=new BeatSyncEngine(dj.deckA,dj.deckB,clock);await dj.deckA.load(track('one',a));await dj.deckB.load(track('two',b));return {b:boundary,clock,dj,sync,dispose:async()=>{sync.dispose();await dj.dispose();}};}
test('BPM matching uses effective master BPM, respects bounds and practical half/double relationships',()=>{
 assert.ok(Math.abs(matchBpm(120,1.04,125)!.rate-124.8/125)<1e-10);assert.equal(matchBpm(140,1,70)!.factor,2);assert.equal(matchBpm(70,1,140)!.factor,.5);assert.equal(matchBpm(150,1,75)!.rate,1);
 assert.ok(Math.abs(matchBpm(100,1,120)!.tempoPercent+100/6)<1e-10);assert.ok(Math.abs(matchBpm(120,1.2,120)!.tempoPercent-20)<1e-10);assert.equal(matchBpm(120,1.201,120),null);assert.equal(matchBpm(100,1,130),null);assert.equal(matchBpm(NaN,1,120),null);
});
test('Sync accepts both expanded ±20% endpoints without changing the master',async()=>{
 for(const [masterBpm,followerBpm,rate] of [[120,100,1.2],[100,125,.8]]){
  const {dj,b,sync,dispose}=await setup(masterBpm,followerBpm);const master=dj.deckA.getSnapshot();
  assert.equal(sync.sync('B'),true);assert.equal(b.media[1].playbackRate,rate);assert.equal(dj.deckA.getSnapshot(),master);
  assert.ok(Math.abs(dj.deckB.getSnapshot().tempoPercent-(rate-1)*100)<1e-10);await dispose();
 }
});
test('phase and nearest alignment respect source origin and normalized half/double beat cycle',()=>{
 const a=analyzeTrack(track('one',120))!;assert.ok(Math.abs(beatPhase(a,.1)!-.2)<1e-10);assert.equal(beatPhase({...a,firstBeatTime:1},.2),null);
 assert.ok(Math.abs(nearestPhaseTime(a,2.34,.2,120)!-2.1)<1e-9);assert.equal(nearestPhaseTime({...a,firstBeatTime:1},1,.9,1.1),null);
 const slow=analyzeTrack(track('slow',60))!;assert.equal(nearestPhaseTime(slow,2.1,.2,120,2),2.1);
 assert.ok(Math.abs(phaseErrorSeconds(.02,.98,.5)-.02)<1e-9);assert.ok(Math.abs(phaseErrorSeconds(.98,.02,.5)+.02)<1e-9);
});
test('A master Sync B matches tempo and nearest phase without changing master or playback state',async()=>{
 const {dj,b,sync,dispose}=await setup();dj.deckA.seek(1.1);dj.deckB.seek(2.34);dj.deckA.setTempo(4);const master=dj.deckA.getSnapshot();
 assert.equal(sync.sync('B'),true);assert.equal(dj.deckA.getSnapshot(),master);assert.ok(Math.abs(b.media[1].playbackRate-124.8/125)<1e-10);assert.equal(sync.getSnapshot().enabled,true);assert.equal(sync.getSnapshot().status,'waiting');assert.equal(b.media[1].paused,true);
 assert.ok(Math.abs(beatPhase(dj.deckA.getSnapshot().analysis!,dj.deckA.getCurrentTime())!-beatPhase(dj.deckB.getSnapshot().analysis!,dj.deckB.getCurrentTime())!)<1e-9);await dispose();
});
test('B master Sync A and half BPM alignment leave B untouched; master selection is exclusive',async()=>{
 const {dj,sync,dispose}=await setup(70,140);sync.setMaster('B');dj.deckB.seek(.1);dj.deckA.seek(3.2);const master=dj.deckB.getSnapshot();assert.equal(sync.sync('A'),true);assert.equal(sync.getSnapshot().master,'B');assert.equal(sync.getSnapshot().match!.factor,2);assert.equal(dj.deckA.getSnapshot().tempoPercent,0);assert.equal(dj.deckB.getSnapshot(),master);
 sync.setMaster('A');assert.equal(sync.getSnapshot().enabled,false);assert.equal(sync.getSnapshot().follower,'B');await dispose();
});
test('missing BPM/grid, unavailable seek and tempo limits fail safely without changing the master',async()=>{
 const {dj,b,sync,dispose}=await setup(100,130);const master=dj.deckA.getSnapshot();assert.equal(sync.sync('B'),false);assert.equal(dj.deckA.getSnapshot(),master);assert.equal(b.media[1].playbackRate,1);
 assert.match(sync.getSnapshot().message,/±20%/);
 await dj.deckB.load(track('missing'));assert.equal(sync.sync('B'),false);await dj.deckB.load(track('valid',100));const media=b.media.at(-1)!;media.seekable={length:0,start:()=>0,end:()=>120};media.dispatchEvent(new Event('timeupdate'));assert.equal(sync.sync('B'),false);await dispose();
});
test('replacement/unload and manual tempo/grid changes disable sync and clean the timer',async()=>{
 const {dj,sync,clock,dispose}=await setup(120,120);assert.equal(sync.sync('B'),true);dj.deckB.setTempo(3);assert.equal(sync.getSnapshot().enabled,false);assert.equal(dj.deckB.getSnapshot().tempoPercent,3);assert.equal(clock.callback,null);
 assert.equal(sync.sync('B'),true);dj.deckA.setTempo(2);assert.equal(sync.getSnapshot().enabled,false);assert.equal(sync.sync('B'),true);dj.deckA.setBeatOrigin();assert.equal(sync.getSnapshot().enabled,false);
 assert.equal(sync.sync('B'),true);await dj.deckB.load(track('replacement',120));assert.equal(sync.getSnapshot().enabled,false);assert.equal(sync.sync('B'),true);dj.deckA.unload();assert.equal(sync.getSnapshot().enabled,false);assert.equal(dj.deckB.getSnapshot().status,'ready');await dispose();
});
test('pause/resume waits, user seek gets one deferred re-alignment and no repeated seeking',async()=>{
 const {dj,b,sync,clock,dispose}=await setup(120,120);await dj.deckA.play();await dj.deckB.play();sync.sync('B');clock.tick(1100);
 dj.deckB.pause();clock.tick();assert.equal(sync.getSnapshot().status,'waiting');b.media[0].currentTime=.15;await dj.deckB.play();clock.tick(350);assert.ok(Math.abs(b.media[1].currentTime-.15)<1e-9);
 dj.deckB.seek(3.4);clock.tick(100);assert.equal(b.media[1].currentTime,3.4);clock.tick(300);const aligned=b.media[1].currentTime;assert.ok(Math.abs(beatPhase(dj.deckB.getSnapshot().analysis!,aligned)!-.3)<1e-9);clock.tick();assert.equal(b.media[1].currentTime,aligned);await dispose();
});
test('meaningful drift gets bounded rate trim, large drift reports failure instead of repeated seeks',async()=>{
 const {dj,b,sync,clock,dispose}=await setup(120,120);await dj.deckA.play();await dj.deckB.play();sync.sync('B');clock.tick(1100);
 b.media[0].currentTime=2;b.media[1].currentTime=2.08;clock.tick();assert.equal(sync.getSnapshot().status,'correcting');assert.ok(b.media[1].playbackRate>=.995&&b.media[1].playbackRate<1);assert.equal(b.media[1].currentTime,2.08);
 b.media[1].currentTime=2.2;clock.tick();assert.equal(sync.getSnapshot().enabled,false);assert.equal(b.media[1].currentTime,2.2);assert.equal(b.media[1].playbackRate,1);assert.equal(clock.callback,null);await dispose();
});
test('rate failures stop active sync immediately and restore attempts never keep a timer alive',async()=>{
 const {dj,b,sync,clock,dispose}=await setup(120,120);await dj.deckA.play();await dj.deckB.play();assert.equal(sync.sync('B'),true);clock.tick(1100);
 Object.defineProperty(b.media[1],'playbackRate',{get:()=>1,set:()=>{throw new Error('media rate failure')},configurable:true});b.media[0].currentTime=2;b.media[1].currentTime=2.08;clock.tick();
 assert.equal(dj.deckB.getSnapshot().status,'error');assert.equal(sync.getSnapshot().enabled,false);assert.equal(clock.callback,null);await dispose();
});
test('drift trim honors the tempo endpoint; unsubscribe/dispose stops observations and corrections',async()=>{
 const {dj,b,sync,clock,dispose}=await setup(120,120);dj.deckA.setTempo(20);await dj.deckA.play();await dj.deckB.play();assert.equal(sync.sync('B'),true);clock.tick(1100);
 b.media[0].currentTime=2;b.media[1].currentTime=1.92;clock.tick();assert.equal(sync.getSnapshot().status,'limited');assert.equal(b.media[1].playbackRate,1.2);assert.equal(b.media[1].currentTime,1.92);
 let notices=0;const remove=sync.subscribe(()=>notices++);remove();sync.disable();assert.equal(notices,0);assert.equal(clock.callback,null);sync.dispose();sync.dispose();const snapshot=sync.getSnapshot();dj.deckA.setTempo(0);assert.equal(sync.getSnapshot(),snapshot);assert.equal(sync.sync('B'),false);await dispose();
});
test('asynchronous media seeks are awaited and gap-clamped alignment is rejected',async()=>{
 const {dj,b,sync,clock,dispose}=await setup(120,120);await dj.deckA.play();await dj.deckB.play();assert.equal(sync.sync('B'),true);clock.tick(1100);
 dj.deckB.seek(4.3);b.media[1].seeking=true;b.media[0].currentTime=.1;clock.tick(500);assert.equal(b.media[1].currentTime,4.3);b.media[1].seeking=false;clock.tick();assert.ok(Math.abs(b.media[1].currentTime-4.1)<1e-9);
 sync.disable();b.media[1].seekable={length:1,start:()=>2,end:()=>2.05};b.media[1].dispatchEvent(new Event('progress'));b.media[1].currentTime=2;const master=dj.deckA.getSnapshot();assert.equal(sync.sync('B'),false);assert.equal(dj.deckA.getSnapshot(),master);assert.equal(sync.getSnapshot().enabled,false);await dispose();
});
test('small drift converges over simulated playback without any automatic seek',async()=>{
 const {dj,b,sync,clock,dispose}=await setup(120,120);await dj.deckA.play();await dj.deckB.play();assert.equal(sync.sync('B'),true);clock.tick(1100);
 let master=2,follower=2.08,seeks=0;Object.defineProperty(b.media[0],'currentTime',{get:()=>master,set:(value:number)=>{master=value;},configurable:true});Object.defineProperty(b.media[1],'currentTime',{get:()=>follower,set:(value:number)=>{follower=value;seeks++;},configurable:true});
 for(let i=0;i<64;i++){master+=.25*b.media[0].playbackRate;follower+=.25*b.media[1].playbackRate;clock.tick();}
 assert.equal(sync.getSnapshot().enabled,true);assert.ok(Math.abs(follower-master)<.016);assert.equal(seeks,0);assert.equal(b.media[0].playbackRate,1);await dispose();
});
test('half-rate relationship aligns grouped follower beats without altering metadata; same-value manual tempo cancels Sync',async()=>{
 const {dj,sync,dispose}=await setup(70,140);dj.deckA.seek(.1);dj.deckB.seek(3.2);assert.equal(sync.sync('B'),true);assert.equal(sync.getSnapshot().match!.factor,.5);
 assert.ok(Math.abs(beatPhase(dj.deckA.getSnapshot().analysis!,dj.deckA.getCurrentTime())!-beatPhase(dj.deckB.getSnapshot().analysis!,dj.deckB.getCurrentTime(),.5)!)<1e-9);assert.equal(dj.deckB.getSnapshot().analysis!.bpm,140);
 dj.deckB.setTempo(0);assert.equal(sync.getSnapshot().enabled,false);await dispose();
});
test('shutdown from a sync-state subscriber cannot leave a newly started timer behind',async()=>{
 const {sync,clock,dispose}=await setup(120,120);sync.subscribe(()=>{if(sync.getSnapshot().enabled)sync.dispose();});assert.equal(sync.sync('B'),false);assert.equal(clock.callback,null);assert.equal(sync.getSnapshot().enabled,false);await dispose();
});
test('phase calculation rejects overflowing source positions instead of emitting NaN',()=>{
 const analysis=analyzeTrack(track('fast',400))!;assert.equal(beatPhase(analysis,Number.MAX_VALUE),null);
});
test('dispose during match notification cancels initialization before tempo/seek/timer changes',async()=>{
 const {dj,sync,clock,dispose}=await setup(120,125);dj.deckB.seek(2.34);const follower=dj.deckB.getSnapshot();sync.subscribe(()=>{if(sync.getSnapshot().match&&!sync.getSnapshot().enabled)sync.dispose();});
 assert.equal(sync.sync('B'),false);assert.equal(clock.callback,null);assert.equal(sync.getSnapshot().enabled,false);assert.equal(dj.deckB.getSnapshot(),follower);await dispose();
});
test('initial phase alignment failure restores the original follower tempo',async()=>{
 const {dj,b,sync,dispose}=await setup(120,125);dj.deckA.seek(.4);dj.deckB.seek(2);dj.deckB.setTempo(2);b.media[1].seekable={length:1,start:()=>2,end:()=>2.01};b.media[1].dispatchEvent(new Event('progress'));
 assert.equal(sync.sync('B'),false);assert.equal(sync.getSnapshot().enabled,false);assert.ok(Math.abs(dj.deckB.getSnapshot().tempoPercent-2)<1e-10);await dispose();
});
test('repeated Sync/master/follower replacement resets matching state and releases timers',async()=>{
 const {dj,sync,clock,dispose}=await setup(120,120);
 for(let i=0;i<30;i++){
  assert.equal(sync.sync('B'),true);sync.disable();assert.equal(clock.callback,null);assert.equal(sync.getSnapshot().match,null);
  assert.equal(sync.sync('B'),true);await dj.deckA.load(track('master'+i,120));assert.equal(sync.getSnapshot().enabled,false);assert.equal(sync.getSnapshot().match,null);assert.equal(clock.callback,null);
  assert.equal(sync.sync('B'),true);await dj.deckB.load(track('follower'+i,120));assert.equal(sync.getSnapshot().enabled,false);assert.equal(clock.callback,null);
  assert.equal(sync.sync('B'),true);dj.deckA.unload();assert.equal(sync.getSnapshot().enabled,false);assert.equal(dj.deckB.getSnapshot().status,'ready');await dj.deckA.load(track('next'+i,120));
 }
 await dj.deckA.load(track('no-bpm'));assert.equal(sync.sync('B'),false);assert.equal(clock.callback,null);
 await dispose();assert.equal(clock.callback,null);const state=sync.getSnapshot();await dj.deckB.load(track('disposed',120));assert.equal(sync.getSnapshot(),state);
});
test('disabling or disposing Sync during a seek notification never fails the follower',async()=>{
 for(const shutdown of [false,true]){
  const {dj,sync,clock,dispose}=await setup(120,120);await dj.deckA.play();await dj.deckB.play();assert.equal(sync.sync('B'),true);
  const remove=sync.subscribe(()=>{if(sync.getSnapshot().enabled&&sync.getSnapshot().status==='waiting'){if(shutdown)sync.dispose();else sync.disable();}});
  dj.deckB.seek(3.2);assert.equal(dj.deckB.getSnapshot().status,'playing');assert.equal(dj.deckB.getSnapshot().currentTime,3.2);
  assert.equal(sync.getSnapshot().enabled,false);assert.equal(clock.callback,null);assert.equal(dj.deckA.getSnapshot().status,'playing');remove();await dispose();
 }
});
