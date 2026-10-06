import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKey,compatibleKeys,harmonicCompatibility,analyzeKey} from '../src/services/harmonic.ts';
import {createAudiusProvider} from '../src/services/audius.ts';
import {createDualDeck} from '../src/audio/DualDeck.ts';
import {WebAudioRuntime} from '../src/audio/WebAudioSession.ts';
import {audioBoundary} from './helpers/audio-context.ts';
test('key normalization accepts unambiguous major/minor and enharmonic keys only',()=>{
 assert.deepEqual(normalizeKey('C major'),{name:'C major',camelot:'8B',number:8,mode:'major'});assert.equal(normalizeKey('A minor')!.camelot,'8A');
 assert.equal(normalizeKey('Dbm')!.camelot,normalizeKey('C# minor')!.camelot);assert.equal(normalizeKey('F♯ major')!.camelot,'2B');
 for(const value of ['C','unknown','C dorian','H minor',42,null])assert.equal(normalizeKey(value),null);
});
test('Camelot advisory includes same, adjacent and relative keys, wraps 1/12',()=>{
 assert.deepEqual(compatibleKeys(normalizeKey('C major')!),['8B','7B','9B','8A']);
 assert.deepEqual(compatibleKeys(normalizeKey('B major')!),['1B','12B','2B','1A']);
 assert.equal(harmonicCompatibility(normalizeKey('C major'),normalizeKey('A minor')),'compatible');assert.equal(harmonicCompatibility(null,normalizeKey('C major')),'unknown');assert.equal(harmonicCompatibility(normalizeKey('C major'),normalizeKey('D major')),'other');
});
test('Audius key metadata is normalized and uncertainty retained without blocking invalid/missing key',async()=>{
 const record={id:'abc',title:'song',duration:120,user:{name:'a'},permalink:'/a/song',is_streamable:true,is_stream_gated:false,musical_key:'A minor',is_custom_musical_key:false};
 const tracks=await createAudiusProvider(async()=>Response.json({data:[record,{...record,id:'def',musical_key:'bad'}]})).search('song');
 assert.equal(analyzeKey(tracks[0])!.key.camelot,'8A');assert.equal(analyzeKey(tracks[0])!.kind,'providerEstimated');assert.equal(analyzeKey(tracks[0])!.confidence,null);assert.equal(analyzeKey(tracks[1]),null);
});
test('native pitch preservation is independent, survives replacement and is not overwritten by tempo/sync',async()=>{
 const b=audioBoundary(),dj=createDualDeck(async()=>({url:'https://cdn.example/a.mp3',mimeType:'audio/mpeg',expiresAt:null}),new WebAudioRuntime(b.contextFactory,b.mediaFactory));
 const t={provider:'audius' as const,id:'abc',title:'a',channel:'a',duration:120,thumbnail:'',sourceUrl:'https://audius.co/a/a',timing:{bpm:120,kind:'provider' as const}};
 await dj.deckA.load(t);await dj.deckB.load({...t,id:'def'});assert.equal(dj.deckA.setKeyLock(true),true);dj.deckA.setTempo(20);assert.equal(b.media[0].preservesPitch,true);assert.equal(b.media[1].preservesPitch,false);dj.sync.sync('B');assert.equal(b.media[0].preservesPitch,true);
 await dj.deckA.load(t);assert.equal(b.media[2].preservesPitch,true);dj.deckA.setKeyLock(false);assert.equal(b.media[2].preservesPitch,false);await dj.dispose();
});
test('unsupported pitch-preservation capability leaves tempo usable with an explicit unavailable state',async()=>{
 const b=audioBoundary();const runtime=new WebAudioRuntime(b.contextFactory,()=>{const media=b.mediaFactory();Reflect.deleteProperty(media,'preservesPitch');return media;});const dj=createDualDeck(async()=>({url:'https://cdn.example/a.mp3',mimeType:'audio/mpeg',expiresAt:null}),runtime);
 await dj.deckA.load({provider:'audius',id:'abc',title:'a',channel:'a',duration:120,thumbnail:'',sourceUrl:'https://audius.co/a/a'});assert.equal(dj.deckA.setKeyLock(true),false);assert.equal(dj.deckA.getSnapshot().keyLockAvailable,false);assert.equal(dj.deckA.getSnapshot().keyLock,false);dj.deckA.setTempo(20);assert.equal(b.media[0].playbackRate,1.2);assert.equal(dj.deckA.getSnapshot().status,'ready');await dj.dispose();
});
