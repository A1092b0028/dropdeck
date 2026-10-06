import test from 'node:test';
import assert from 'node:assert/strict';
import {snapBeat,loopRegion,jumpBeats,slipPosition,LOOP_SIZES} from '../src/audio/performance-timing.ts';
import {PerformanceEngine} from '../src/audio/PerformanceEngine.ts';
import {createDualDeck} from '../src/audio/DualDeck.ts';
import {WebAudioRuntime} from '../src/audio/WebAudioSession.ts';
import {audioBoundary} from './helpers/audio-context.ts';
import {analyzeTrack} from '../src/services/analysis.ts';
import type {Track} from '../src/types/track';
const track:Track={provider:'audius',id:'abc',title:'test',channel:'test',duration:120,thumbnail:'',sourceUrl:'https://audius.co/a/test',timing:{bpm:120,kind:'provider'}};
const grid={...analyzeTrack(track)!,firstBeatTime:1};
test('performance math uses source grid, all loop sizes, offsets and safe boundaries',()=>{
 assert.equal(snapBeat(1.3,grid,120),1.5);assert.equal(snapBeat(0,grid,120),1);
 for(const size of LOOP_SIZES){const region=loopRegion(3.3,size,grid,120)!;assert.equal(region.start,3);assert.equal(region.end-region.start,size*.5);}
 assert.equal(loopRegion(119.9,16,grid,120),null);assert.equal(loopRegion(3,3,grid,120),null);
 assert.equal(jumpBeats(3.3,4,grid,120,false),5.3);assert.equal(jumpBeats(3.3,4,grid,120,true),5.5);
 assert.equal(jumpBeats(2,-16,grid,120,false),0);assert.equal(jumpBeats(119,16,grid,120,true),120);
 assert.equal(slipPosition(10,2,1.2,120),12.4);assert.equal(slipPosition(119,2,1,120),120);
 assert.equal(snapBeat(NaN,grid,120),null);
});
async function setup(){const b=audioBoundary();const dj=createDualDeck(async()=>({url:'https://cdn.example/a.mp3',mimeType:'audio/mpeg',expiresAt:null}),new WebAudioRuntime(b.contextFactory,b.mediaFactory));await dj.deckA.load(track);await dj.deckB.load({...track,id:'def'});let now=0,callback:(()=>void)|null=null;const p=new PerformanceEngine(dj.deckA,()=>dj.sync.disable('表演動作解除 Sync'),{now:()=>now,start:cb=>{callback=cb;return()=>{callback=null;};}});return {b,dj,p,tick:(ms:number)=>{now+=ms;callback?.();},hasTimer:()=>callback!==null,dispose:async()=>{p.dispose();await dj.dispose();}};}
test('loop wraps, length changes, slip follows rate/pause, replacement resets and disposes scheduler',async()=>{
 const {b,dj,p,tick,hasTimer,dispose}=await setup();dj.deckA.seek(10);await dj.deckA.play();p.setSlip(true);assert.equal(p.enableLoop(4),true);
 b.media[0].currentTime=12.1;tick(1000);assert.equal(dj.deckA.getCurrentTime(),10.1);assert.equal(dj.deckB.getCurrentTime(),0);
 dj.deckA.setTempo(20);tick(1000);dj.deckA.pause();tick(1000);p.disableLoop();assert.ok(Math.abs(dj.deckA.getCurrentTime()-12.2)<1e-9);assert.equal(hasTimer(),false);
 assert.equal(p.enableLoop(.5),true);assert.equal(p.getSnapshot().loop!.end-p.getSnapshot().loop!.start,.25);
 await dj.deckA.load({...track,id:'new'});assert.equal(p.getSnapshot().loop,null);assert.equal(hasTimer(),false);await dispose();assert.equal(p.enableLoop(4),false);
});
test('quantize cues/jumps and performance sync isolation',async()=>{
 const {dj,p,dispose}=await setup();dj.deckA.setQuantize(true);dj.deckA.seek(3.3);dj.deckA.setCue();dj.deckA.setHotCue(0);assert.equal(dj.deckA.getSnapshot().cue,3.5);assert.equal(dj.deckA.getSnapshot().hotCues[0],3.5);assert.equal(dj.deckB.getSnapshot().quantize,false);
 assert.equal(dj.sync.sync('B'),true);p.beatJump(4);assert.equal(dj.sync.getSnapshot().enabled,false);assert.equal(dj.deckA.getCurrentTime(),5.5);
 assert.equal(p.enableLoop(4),true);assert.equal(dj.sync.sync('B'),false);p.disableLoop();assert.equal(dj.sync.sync('B'),true);await dispose();
});
test('slip cue excursion returns to logical timeline without leaking another track',async()=>{
 const {dj,p,tick,dispose}=await setup();dj.deckA.seek(2);dj.deckA.setCue();dj.deckA.seek(10);await dj.deckA.play();p.setSlip(true);p.jumpCue();assert.equal(dj.deckA.getCurrentTime(),2);tick(2000);p.returnSlip();assert.equal(dj.deckA.getCurrentTime(),12);
 p.jumpCue();await dj.deckA.load({...track,id:'next'});p.returnSlip();assert.equal(dj.deckA.getCurrentTime(),0);await dispose();
});
test('cue/hot cue recover ended playback using the existing deck seek path',async()=>{
 const {b,dj,p,dispose}=await setup();dj.deckA.seek(25);dj.deckA.setCue();dj.deckA.setHotCue(0);b.media[0].currentTime=120;b.media[0].dispatchEvent(new Event('ended'));p.jumpCue();assert.equal(dj.deckA.getCurrentTime(),25);assert.equal(dj.deckA.getSnapshot().status,'paused');b.media[0].currentTime=120;b.media[0].dispatchEvent(new Event('ended'));p.jumpHotCue(0);assert.equal(dj.deckA.getCurrentTime(),25);await dispose();
});
test('loop ending at track duration survives native ended and resumes at its start',{timeout:2000},async()=>{
 const {b,dj,p,dispose}=await setup();dj.deckA.seek(118);await dj.deckA.play();assert.equal(p.enableLoop(4),true);const resumed=new Promise<void>(resolve=>{const remove=dj.deckA.subscribe(()=>{if(dj.deckA.getSnapshot().status==='playing'){remove();resolve();}});});b.media[0].paused=true;b.media[0].currentTime=120;b.media[0].dispatchEvent(new Event('ended'));await resumed;assert.equal(p.getSnapshot().loop!.start,118);assert.equal(dj.deckA.getCurrentTime(),118);assert.equal(dj.deckA.getSnapshot().status,'playing');await dispose();
});
test('disposing from slip notification cannot leave a scheduler or stale loop behind',async()=>{
 const {dj,p,hasTimer,dispose}=await setup();p.setSlip(true);p.subscribe(()=>{if(p.getSnapshot().slipping)p.dispose();});assert.equal(p.enableLoop(4),false);assert.equal(hasTimer(),false);assert.equal(dj.deckA.isPerformanceActive(),false);await dispose();
});
test('loop rejects partial seekable regions and stops if transport ranges withdraw',async()=>{
 const {b,dj,p,tick,hasTimer,dispose}=await setup();b.media[0].seekable={length:1,start:()=>10.25,end:()=>120};b.media[0].currentTime=10.3;b.media[0].dispatchEvent(new Event('progress'));assert.equal(p.enableLoop(.5),false);assert.equal(hasTimer(),false);
 dj.deckA.seek(11);assert.equal(p.enableLoop(4),true);await dj.deckA.play();b.media[0].seekable={length:1,start:()=>14,end:()=>120};b.media[0].dispatchEvent(new Event('progress'));tick(50);assert.equal(p.getSnapshot().loop,null);assert.equal(hasTimer(),false);await dispose();
});
