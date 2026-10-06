import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBpm,analyzeTrack,isTrackAnalysis} from '../src/services/analysis.ts';
import {beatPosition,beatGrid} from '../src/audio/beat-grid.ts';
import {tempoRate,sourceToElapsed,elapsedToSource} from '../src/audio/tempo.ts';
import {createDualDeck} from '../src/audio/DualDeck.ts';
import {WebAudioRuntime} from '../src/audio/WebAudioSession.ts';
import {audioBoundary} from './helpers/audio-context.ts';
import {createAudiusProvider} from '../src/services/audius.ts';
import {DeckEngine} from '../src/audio/DeckEngine.ts';
import type {TrackAnalysis} from '../src/services/analysis';
import type {Track} from '../src/types/track.ts';
const track=(id:string,bpm?:number):Track=>({provider:'audius',id,title:id,channel:'Artist',duration:120,thumbnail:'',sourceUrl:'https://audius.co/a/'+id,...(bpm?{timing:{bpm,kind:'providerEstimated' as const}}:{})});
function setup(){const b=audioBoundary();return {b,dj:createDualDeck(async()=>({url:'https://cdn.example/a.mp3',mimeType:'audio/mpeg',expiresAt:null}),new WebAudioRuntime(b.contextFactory,b.mediaFactory))};}
test('BPM and analysis validate finite realistic provider values without invented confidence',()=>{
 assert.equal(normalizeBpm(100.5),100.5);
 for(const value of [null,undefined,'120',0,-1,NaN,Infinity,19,401])assert.equal(normalizeBpm(value),null);
 const a=analyzeTrack(track('one',120));assert.ok(a);assert.equal(a.beatInterval,.5);assert.equal(a.confidence,null);assert.equal(a.origin,'assumed');assert.equal(a.firstBeatTime,0);
 assert.equal(analyzeTrack(track('unknown')),null);assert.equal(isTrackAnalysis({...a,bpm:NaN}),false);assert.equal(isTrackAnalysis({...a,beatInterval:5}),false);assert.equal(isTrackAnalysis({...a,firstBeatTime:-1}),false);
});
test('beat grid uses source time and first beat offset, no invented bars and bounded generation',()=>{
 const a={...analyzeTrack(track('one',120))!,firstBeatTime:.25,origin:'manual' as const};
 assert.deepEqual(beatGrid(a,2),[.25,.75,1.25,1.75]);assert.equal(beatPosition(a,.1),null);assert.equal(beatPosition(a,1.5),2.5);
 assert.equal(beatGrid(a,10000,100).length,100);assert.deepEqual(beatGrid({...a,bpm:0},2),[]);assert.equal(beatPosition(a,NaN),null);
});
test('tempo bounds are ±20% and constant-rate source/elapsed mapping is explicit',()=>{
 assert.equal(tempoRate(-20),.8);assert.equal(tempoRate(20),1.2);assert.equal(tempoRate(30),1.2);assert.equal(tempoRate(-30),.8);assert.equal(tempoRate(0),1);
 for(const v of [NaN,Infinity])assert.throws(()=>tempoRate(v),RangeError);
 assert.equal(sourceToElapsed(108,1.08),100);assert.equal(elapsedToSource(100,1.08),108);assert.throws(()=>sourceToElapsed(1,0),RangeError);assert.throws(()=>elapsedToSource(-1,1),RangeError);
});
test('Audius carries only normalized timing metadata and keeps missing BPM playable',async()=>{
 const t={id:'valid',title:'Title',duration:120,user:{name:'Artist'},permalink:'/a/title',is_streamable:true,is_stream_gated:false};
 const p=createAudiusProvider(async()=>new Response(JSON.stringify({data:[{...t,bpm:123,is_custom_bpm:false},{...t,id:'owner',bpm:110,is_custom_bpm:true},{...t,id:'missing',bpm:0}]})));
 const tracks=await p.search('music');assert.deepEqual(tracks[0].timing,{bpm:123,kind:'providerEstimated'});assert.deepEqual(tracks[1].timing,{bpm:110,kind:'provider'});assert.equal(tracks[2].timing,undefined);
});
test('A/B tempo/analysis stay independent; source beat/cue positions survive tempo and seek',async()=>{
 const {b,dj}=setup();await dj.deckA.load(track('one',120));await dj.deckB.load(track('two',100));await dj.deckA.play();await dj.deckB.play();
 const before=dj.deckB.getSnapshot();dj.deckA.seek(1.25);dj.deckA.setCue();dj.deckA.setTempo(20);
 assert.equal(b.media[0].playbackRate,1.2);assert.equal(b.media[0].preservesPitch,false);assert.equal(b.media[1].playbackRate,1);assert.equal(dj.deckB.getSnapshot(),before);
 assert.equal(beatPosition(dj.deckA.getSnapshot().analysis!,dj.deckA.getCurrentTime()),2.5);assert.equal(dj.deckA.getSnapshot().cue,1.25);
 dj.deckA.setBeatOrigin();assert.equal(dj.deckA.getSnapshot().analysis!.firstBeatTime,1.25);assert.equal(dj.deckA.getSnapshot().analysis!.origin,'manual');dj.deckA.seek(2.25);assert.equal(beatPosition(dj.deckA.getSnapshot().analysis!,dj.deckA.getCurrentTime()),2);
 dj.deckB.setTempo(-30);assert.equal(b.media[1].playbackRate,.8);assert.equal(b.media[0].playbackRate,1.2);dj.deckA.pause();assert.equal(dj.deckA.getSnapshot().tempoPercent,20);
 await dj.deckA.load(track('replacement',90));assert.equal(dj.deckA.getSnapshot().analysis!.bpm,90);assert.equal(dj.deckA.getSnapshot().analysis!.firstBeatTime,0);assert.equal(dj.deckA.getSnapshot().tempoPercent,20);assert.equal(b.media[2].playbackRate,1.2);
 await dj.deckA.load(track('noBpm'));assert.equal(dj.deckA.getSnapshot().analysis,null);assert.equal(dj.deckA.setBeatOrigin(),false);dj.deckA.unload();assert.equal(dj.deckA.getSnapshot().tempoPercent,20);await dj.dispose();
});
test('tempo edits during pending resolution apply to latest session and disposal ignores further edits',async()=>{
 const b=audioBoundary();const runtime=new WebAudioRuntime(b.contextFactory,b.mediaFactory);
 let finish!:(s:{url:string;mimeType:'audio/mpeg';expiresAt:null})=>void;
 const dj=createDualDeck(()=>new Promise(resolve=>{finish=resolve}),runtime);
 const loading=dj.deckA.load(track('pending',120));dj.deckA.setTempo(-20);finish({url:'https://cdn.example/track.mp3',mimeType:'audio/mpeg',expiresAt:null});await loading;
 assert.equal(b.media[0].playbackRate,.8);assert.equal(dj.deckA.getSnapshot().analysis!.bpm,120);
 assert.throws(()=>dj.deckA.setTempo(NaN),RangeError);assert.equal(dj.deckA.getSnapshot().tempoPercent,-20);
 await dj.dispose();dj.deckA.setTempo(5);assert.equal(dj.deckA.getSnapshot().tempoPercent,-20);
});
test('malformed or throwing analysis is discarded without blocking a playable track',async()=>{
 for(const analyze of [()=>({...analyzeTrack(track('test',120))!,beatInterval:10}),()=>{throw new Error('bad metadata')}]){
  const b=audioBoundary(),runtime=new WebAudioRuntime(b.contextFactory,b.mediaFactory);
  const deck=new DeckEngine(async()=>({url:'https://cdn.example/test.mp3',mimeType:'audio/mpeg',expiresAt:null}),event=>runtime.createDeckSession('A',event),analyze as (t:Track)=>TrackAnalysis|null);
  await deck.load(track('test',120));assert.equal(deck.getSnapshot().status,'ready');assert.equal(deck.getSnapshot().analysis,null);await deck.play();assert.equal(deck.getSnapshot().status,'playing');deck.dispose();await runtime.dispose();
 }
});
