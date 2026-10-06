import test from 'node:test';
import assert from 'node:assert/strict';
import {WebAudioRuntime} from '../src/audio/WebAudioSession.ts';
import {createDualDeck} from '../src/audio/DualDeck.ts';
import {audioBoundary} from './helpers/audio-context.ts';
import type {Track} from '../src/types/track.ts';
import {startWaveformLoop} from '../src/services/waveform-loop.ts';
import {WaveformService} from '../src/services/waveform.ts';
import {MixerEngine} from '../src/audio/MixerEngine.ts';
const source={url:'https://cdn.example/a.mp3',mimeType:'audio/mpeg' as const,expiresAt:null};
const track=(id:string):Track=>({provider:'audius',id,title:id,channel:'Test',duration:120,thumbnail:'',sourceUrl:'https://audius.co/a/'+id,timing:{bpm:120,kind:'provider'}});
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
test('late native Play cannot restart paused or disposed media',async()=>{
 for(const dispose of [false,true]){
  const b=audioBoundary(),runtime=new WebAudioRuntime(b.contextFactory,b.mediaFactory),session=runtime.createDeckSession('A',()=>{});
  await session.load(source,new AbortController().signal);const pending=deferred<void>();
  b.media[0].play=async()=>{await pending.promise;b.media[0].paused=false;};
  const playing=session.play();if(dispose)session.dispose();else session.pause();pending.resolve();await playing;
  assert.equal(b.media[0].paused,true);await runtime.dispose();
 }
});
test('resume failure pauses a late media play and a stale failure does not pause a newer play',async()=>{
 const b=audioBoundary(),runtime=new WebAudioRuntime(b.contextFactory,b.mediaFactory),session=runtime.createDeckSession('A',()=>{});
 await session.load(source,new AbortController().signal);const pending=deferred<void>();
 b.media[0].play=async()=>{await pending.promise;b.media[0].paused=false;};b.context.resume=async()=>{throw Error('resume failed');};
 await assert.rejects(session.play());pending.resolve();await Promise.resolve();await Promise.resolve();assert.equal(b.media[0].paused,true);
 const old=deferred<void>();b.context.resume=async()=>{};b.media[0].play=()=>old.promise;const first=session.play();const rejected=assert.rejects(first);
 session.pause();b.media[0].play=async()=>{b.media[0].paused=false;};await session.play();old.reject(Error('old failure'));await rejected;
 assert.equal(b.media[0].paused,false);await runtime.dispose();
});
test('disposing a deck rejects reentrant loads from cleanup subscribers',async()=>{
 const b=audioBoundary(),runtime=new WebAudioRuntime(b.contextFactory,b.mediaFactory),dj=createDualDeck(async()=>source,runtime);
 await dj.deckA.load(track('one'));const reloads:Promise<void>[]=[];
 dj.deckA.subscribe(()=>{if(dj.deckA.getSnapshot().status==='idle')reloads.push(dj.deckA.load(track('reentrant')));});
 dj.deckA.dispose();await Promise.all(reloads);assert.equal(dj.deckA.getSnapshot().status,'idle');assert.equal(b.media.length,1);assert.equal(b.media[0].src,'');await dj.dispose();
});
test('invalid or out-of-duration seek ranges cannot produce out-of-track seeks',async()=>{
 const b=audioBoundary(),dj=createDualDeck(async()=>source,new WebAudioRuntime(b.contextFactory,b.mediaFactory));await dj.deckA.load(track('one'));
 b.media[0].seekable={length:1,start:()=>200,end:()=>220};b.media[0].dispatchEvent(new Event('progress'));
 assert.equal(dj.deckA.getSnapshot().canSeek,false);dj.deckA.seek(30);assert.equal(b.media[0].currentTime,0);
 b.media[0].seekable={length:1,start:()=>10,end:()=>220};b.media[0].dispatchEvent(new Event('progress'));dj.deckA.seek(150);assert.equal(b.media[0].currentTime,120);
 b.media[0].duration=NaN;b.media[0].dispatchEvent(new Event('durationchange'));assert.equal(dj.deckA.getSnapshot().duration,null);assert.equal(dj.deckA.getSnapshot().canSeek,false);await dj.dispose();
});
test('partial session construction failure releases its graph and allows deck recovery',async()=>{
 const b=audioBoundary(),dj=createDualDeck(async()=>source,new WebAudioRuntime(b.contextFactory,b.mediaFactory));await dj.deckB.load(track('other'));await dj.deckB.play();
 const make=b.context.createAnalyser;b.context.createAnalyser=()=>{throw Error('analyser failed');};await dj.deckA.load(track('bad'));
 assert.equal(dj.deckA.getSnapshot().status,'error');assert.equal(b.sources[1].node.disconnects,1);assert.ok(b.biquads.slice(5).every(n=>n.disconnects===1));
 assert.equal(dj.deckB.getSnapshot().status,'playing');b.context.createAnalyser=make;await dj.deckA.load(track('recovered'));await dj.deckA.play();assert.equal(dj.deckA.getSnapshot().status,'playing');assert.equal(b.counts().contexts,1);await dj.dispose();
});
test('partial DSP and mixer allocation failures release every allocated node',async()=>{
 const b=audioBoundary(),runtime=new WebAudioRuntime(b.contextFactory,b.mediaFactory);runtime.getMixer();
 const create=b.context.createBiquadFilter;b.context.createBiquadFilter=()=>{if(b.biquads.length===2)throw Error('filter allocation failed');return create();};
 assert.throws(()=>runtime.createDeckSession('A',()=>{}));assert.ok(b.biquads.every(n=>n.disconnects===1));assert.equal(b.sources[0].node.disconnects,1);
 b.context.createBiquadFilter=create;const session=runtime.createDeckSession('A',()=>{});session.dispose();await runtime.dispose();
 const other=audioBoundary(),gain=other.context.createGain;other.context.createGain=()=>{if(other.gains.length===2)throw Error('master allocation failed');return gain();};
 assert.throws(()=>new MixerEngine(other.contextFactory()));assert.ok(other.gains.every(n=>n.disconnects===1));
});
test('every concurrent runtime disposer waits for the shared context close',async()=>{
 const b=audioBoundary(),runtime=new WebAudioRuntime(b.contextFactory,b.mediaFactory);runtime.getMixer();const closed=deferred<void>();let closes=0,completed=0;
 b.context.close=async()=>{closes++;await closed.promise;};
 const first=runtime.dispose().then(()=>completed++),second=runtime.dispose().then(()=>completed++);
 await Promise.resolve();await Promise.resolve();assert.equal(completed,0);assert.equal(closes,1);closed.resolve();await Promise.all([first,second]);assert.equal(completed,2);
});
test('100 load/control/unload cycles preserve the other deck, mixer and one context',async()=>{
 const b=audioBoundary(),dj=createDualDeck(async()=>source,new WebAudioRuntime(b.contextFactory,b.mediaFactory));await dj.deckB.load(track('steady'));await dj.deckB.play();
 dj.mixer.setCrossfader(.2);dj.mixer.setMasterVolume(.4);const mixer=dj.mixer.getSnapshot(),steady=dj.deckB.getSnapshot();
 for(let i=0;i<100;i++){
  await dj.deckA.load(track('cycle'+i));await dj.deckA.play();dj.deckA.pause();await dj.deckA.play();
  for(let n=0;n<5;n++){dj.deckA.seek(n*4);dj.deckA.setCue();dj.deckA.setHotCue(n%4);dj.deckA.jumpCue();dj.deckA.jumpHotCue(n%4);dj.deckA.setTempo(n*3);dj.deckA.setLow(n/5);dj.deckA.setFilter(-n/5);}
  const media=b.media.at(-1)!;dj.deckA.unload();assert.equal(media.src,'');assert.equal(media.paused,true);assert.equal(media.listenerCount(),0);
  media.dispatchEvent(new Event('ended'));media.error={code:4};media.dispatchEvent(new Event('error'));
  assert.equal(dj.deckA.getSnapshot().status,'idle');assert.equal(dj.deckA.getSnapshot().analysis,null);assert.equal(dj.deckB.getSnapshot(),steady);assert.equal(dj.mixer.getSnapshot(),mixer);
 }
 assert.equal(b.counts().contexts,1);assert.equal(b.counts().closes,0);
 assert.ok(b.sources.slice(1).every(s=>s.node.disconnects===1));assert.ok(b.biquads.slice(5).every(n=>n.disconnects===1));
 await Promise.all([dj.dispose(),dj.dispose()]);assert.equal(b.counts().closes,1);assert.ok([...b.gains,...b.analysers,...b.biquads,...b.sources.map(s=>s.node)].every(n=>n.disconnects===1));
});
test('out-of-order resolver success and failure never replace the latest track or analysis',async()=>{
 const b=audioBoundary(),pending:Array<ReturnType<typeof deferred<typeof source>>>=[],dj=createDualDeck(()=>{const p=deferred<typeof source>();pending.push(p);return p.promise;},new WebAudioRuntime(b.contextFactory,b.mediaFactory));
 const loads=Array.from({length:30},(_,i)=>dj.deckA.load(track('rapid'+i)));
 pending.at(-1)!.resolve(source);await loads.at(-1);await dj.deckA.play();const latest=dj.deckA.getSnapshot();
 for(let i=28;i>=0;i--){if(i%2)pending[i].reject(Error('stale failure'));else pending[i].resolve(source);}
 await Promise.all(loads);assert.equal(dj.deckA.getSnapshot(),latest);assert.equal(b.media.length,1);
 b.media[0].error={code:2};b.media[0].dispatchEvent(new Event('error'));assert.equal(dj.deckA.getSnapshot().status,'error');
 const recovery=dj.deckA.load(track('recovery'));pending.at(-1)!.resolve(source);await recovery;await dj.deckA.play();assert.equal(dj.deckA.getSnapshot().status,'playing');assert.equal(b.counts().contexts,1);await dj.dispose();
});
test('waveform loop is bounded, cancels on replacement and ignores late callbacks after cleanup',()=>{
 let next=0;const frames=new Map<number,FrameRequestCallback>(),scheduler={request:(cb:FrameRequestCallback)=>{frames.set(++next,cb);return next;},cancel:(id:number)=>{frames.delete(id);}};
 const wave=new WaveformService();wave.reset(track('one'));let draws=0;
 const stop=startWaveformLoop(()=>{draws++;wave.observe(1,120,new Float32Array([.5]));},scheduler);
 const fire=(now:number)=>{const [id,cb]=frames.entries().next().value!;frames.delete(id);cb(now);};
 fire(0);fire(10);fire(49);fire(50);assert.equal(draws,2);const late=frames.values().next().value!;stop();stop();wave.dispose();late(100);
 assert.equal(frames.size,0);assert.equal(draws,2);assert.equal(wave.getData().trackKey,null);assert.ok(wave.getData().peaks.every(p=>p===null));
 const another=startWaveformLoop(()=>draws++,scheduler);fire(200);another();assert.equal(frames.size,0);assert.equal(draws,3);
});
test('rapid gain controls retarget short ramps without reconnecting the mixer or deck graph',async()=>{
 const b=audioBoundary(),dj=createDualDeck(async()=>source,new WebAudioRuntime(b.contextFactory,b.mediaFactory));await dj.deckA.load(track('one'));await dj.deckA.play();
 const inputs=b.gains.slice(0,3).map(n=>[...n.connections]);
 for(let i=0;i<30;i++){dj.mixer.setCrossfader(i%2?-1:1);dj.mixer.setMasterVolume(i%2?.1:.9);dj.deckA.setVolume(i%2?.2:.8);}
 for(const gain of b.gains){assert.ok(gain.gain.ramps.length>0);assert.ok(gain.gain.ramps.every(r=>Math.abs(r.time-b.context.currentTime-.02)<1e-10));assert.ok(gain.gain.holds.length>0);}
 assert.deepEqual(b.gains.slice(0,3).map(n=>n.connections),inputs);await dj.dispose();assert.ok(b.gains.every(n=>n.gain.cancellations.length>0));
});
test('default waveform scheduler preserves the Window receiver required by native browser functions',()=>{
 const globals=globalThis as unknown as {window?:Window;requestAnimationFrame?:typeof requestAnimationFrame;cancelAnimationFrame?:typeof cancelAnimationFrame};
 const previous={window:globals.window,requestAnimationFrame:globals.requestAnimationFrame,cancelAnimationFrame:globals.cancelAnimationFrame};
 let callback:FrameRequestCallback|undefined,cancelled=0;
 const browser={requestAnimationFrame:function(this:unknown,cb:FrameRequestCallback){assert.equal(this,browser);callback=cb;return 7;},
  cancelAnimationFrame:function(this:unknown,id:number){assert.equal(this,browser);cancelled=id;}};
 globals.window=browser as unknown as Window;globals.requestAnimationFrame=browser.requestAnimationFrame;globals.cancelAnimationFrame=browser.cancelAnimationFrame;
 try {let draws=0;const stop=startWaveformLoop(()=>draws++);callback!(0);assert.equal(draws,1);stop();assert.equal(cancelled,7);}
 finally {for(const key of ['window','requestAnimationFrame','cancelAnimationFrame'] as const){if(previous[key]===undefined)delete globals[key];else Object.defineProperty(globals,key,{value:previous[key],writable:true,configurable:true});}}
});
