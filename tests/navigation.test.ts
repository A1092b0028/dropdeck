import test from 'node:test';
import assert from 'node:assert/strict';
import {createDualDeck} from '../src/audio/DualDeck.ts';
import {WebAudioRuntime} from '../src/audio/WebAudioSession.ts';
import {audioBoundary} from './helpers/audio-context.ts';
import {WaveformService,positionToTime,timeToPosition,seekWaveform} from '../src/services/waveform.ts';
import type {Track} from '../src/types/track.ts';
const track=(id:string):Track=>({provider:'audius',id,title:id,channel:'artist',duration:120,thumbnail:'',sourceUrl:'https://audius.co/a/'+id});
function setup(){const b=audioBoundary();const runtime=new WebAudioRuntime(b.contextFactory,b.mediaFactory);return {b,runtime,dj:createDualDeck(async()=>({url:'https://cdn.example/song.mp3',mimeType:'audio/mpeg',expiresAt:null}),runtime)};}
test('waveform mapping clamps edges, rejects invalid inputs and seeks through deck',()=>{
 assert.equal(timeToPosition(30,120),.25);assert.equal(positionToTime(.25,120),30);
 assert.equal(positionToTime(2,120),120);assert.equal(timeToPosition(-2,120),0);
 for(const v of [NaN,Infinity])assert.throws(()=>positionToTime(v,120),RangeError);
 assert.throws(()=>timeToPosition(0,0),RangeError);
 let target=-1;seekWaveform({seek:(t:number)=>{target=t}},.4,100);assert.equal(target,40);
});
test('observed waveform uses real samples only, leaves gaps and resets/cleans up',()=>{
 const w=new WaveformService();w.reset(track('one'));w.observe(10,120,new Float32Array([-.5,.2]));
 const data=w.getData();assert.equal(data.kind,'observed');assert.equal(data.peaks.filter(p=>p!==null).length,1);assert.equal(Math.max(...data.peaks.filter((p):p is number=>p!==null)),.5);
 w.observe(NaN,120,new Float32Array([1]));assert.equal(w.getData(),data);
 w.reset(track('two'));assert.ok(w.getData().peaks.every(p=>p===null));w.dispose();w.observe(2,120,new Float32Array([1]));assert.ok(w.getData().peaks.every(p=>p===null));
});
test('cue and all four hot cues set/jump/clear independently, preserve DSP and reset on replacement',async()=>{
 const {dj,b}=setup();assert.equal(dj.deckA.setCue(),false);
 await dj.deckA.load(track('one'));await dj.deckB.load(track('two'));dj.deckA.setLow(-.5);dj.deckA.seek(20);assert.equal(dj.deckA.setCue(),true);
 for(let i=0;i<4;i++){dj.deckA.seek(25+i);assert.equal(dj.deckA.setHotCue(i),true);}
 assert.equal(dj.deckB.getSnapshot().cue,null);assert.deepEqual(dj.deckB.getSnapshot().hotCues,[null,null,null,null]);
 await dj.deckA.play();dj.deckA.jumpCue();assert.equal(b.media[0].currentTime,20);assert.equal(dj.deckA.getSnapshot().status,'playing');
 for(let i=0;i<4;i++){dj.deckA.jumpHotCue(i);assert.equal(b.media[0].currentTime,25+i);dj.deckA.clearHotCue(i);assert.equal(dj.deckA.getSnapshot().hotCues[i],null);}
 dj.deckA.clearCue();assert.equal(dj.deckA.getSnapshot().cue,null);
 dj.deckA.setCue();dj.deckA.setHotCue(0);await dj.deckA.load(track('one'));assert.equal(dj.deckA.getSnapshot().cue,null);assert.ok(dj.deckA.getSnapshot().hotCues.every(p=>p===null));assert.equal(dj.deckA.getSnapshot().dsp.low,-.5);
 assert.throws(()=>dj.deckA.setHotCue(4),RangeError);assert.throws(()=>dj.deckA.jumpHotCue(NaN),RangeError);
 b.media[1].currentTime=NaN;b.media[1].dispatchEvent(new Event('timeupdate'));assert.equal(dj.deckB.getSnapshot().currentTime,0);
 dj.deckA.unload();assert.equal(dj.deckA.setCue(),false);await dj.dispose();dj.deckA.setHotCue(0);assert.equal(dj.deckA.getSnapshot().cue,null);
});
test('waveform analyser observes raw source independently and releases on replacement/unload',async()=>{
 const {dj,b,runtime}=setup();await dj.deckA.load(track('one'));await dj.deckB.load(track('two'));
 assert.equal(runtime.readDeckWaveform('A'),null);await dj.deckA.play();assert.ok(runtime.readDeckWaveform('A') instanceof Float32Array);assert.equal(runtime.readDeckWaveform('B'),null);
 await dj.deckA.load(track('replacement'));assert.equal(b.analysers[0].disconnects,1);assert.equal(b.analysers[1].disconnects,0);dj.deckA.unload();assert.equal(runtime.readDeckWaveform('A'),null);
 await dj.dispose();assert.ok(b.analysers.every(n=>n.disconnects===1));assert.equal(runtime.readDeckWaveform('B'),null);
});
test('cue refuses out-of-duration/nonseekable positions and replacement leaves other deck marks intact',async()=>{
 const {dj,b}=setup();await dj.deckA.load(track('one'));await dj.deckB.load(track('two'));
 dj.deckB.seek(44);dj.deckB.setCue();dj.deckB.setHotCue(3);
 b.media[0].currentTime=121;b.media[0].dispatchEvent(new Event('timeupdate'));
 assert.equal(dj.deckA.setCue(),false);assert.equal(dj.deckA.setHotCue(0),false);
 b.media[0].currentTime=10;b.media[0].seekable={length:0,start:()=>0,end:()=>120};b.media[0].dispatchEvent(new Event('timeupdate'));
 assert.equal(dj.deckA.setCue(),false);dj.deckA.jumpHotCue(0);assert.equal(b.media[0].currentTime,10);
 const before=dj.deckB.getSnapshot();await dj.deckA.load(track('replacement'));dj.deckA.unload();assert.equal(dj.deckB.getSnapshot(),before);
 assert.equal(before.cue,44);assert.equal(before.hotCues[3],44);await dj.dispose();
});
test('waveform clears prior time bins if actual media duration changes',()=>{
 const w=new WaveformService();w.reset(track('one'));w.observe(10,120,new Float32Array([.5]));w.observe(10,240,new Float32Array([.3]));
 assert.equal(w.getData().peaks.filter(p=>p!==null).length,1);assert.equal(Math.max(...w.getData().peaks.filter((p):p is number=>p!==null)),Math.fround(.3));
});
test('cue captures current session position between media events and playhead can read it without subscriptions',async()=>{
 const {dj,b}=setup();await dj.deckA.load(track('one'));await dj.deckA.play();
 b.media[0].currentTime=15;b.media[0].dispatchEvent(new Event('timeupdate'));b.media[0].currentTime=15.24;
 let notifications=0;const remove=dj.deckA.subscribe(()=>notifications++);
 assert.equal(dj.deckA.getCurrentTime(),15.24);assert.equal(notifications,0);
 dj.deckA.setCue();dj.deckA.setHotCue(0);assert.equal(dj.deckA.getSnapshot().cue,15.24);assert.equal(dj.deckA.getSnapshot().hotCues[0],15.24);
 remove();await dj.dispose();assert.equal(dj.deckA.getCurrentTime(),0);
});
