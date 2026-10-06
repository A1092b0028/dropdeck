import type {Track} from '../types/track';
import type {DualDeck} from '../audio/DualDeck';
import type {DeckId} from '../types/deck';
import type {DeckSnapshot} from '../audio/DeckEngine';
import {isTrackAnalysis,normalizeBpm} from '../services/analysis.ts';
import type {TrackAnalysis} from '../services/analysis';
import {normalizeKey} from '../services/harmonic.ts';
import {defaultDspState} from '../audio/DeckDsp.ts';
import type {DspState} from '../audio/DeckDsp';
import {emptyMixerSnapshot} from '../audio/MixerEngine.ts';
export const STORAGE_KEY='yt-dj.workflow.v1';
export interface SavedMarks {cue:number|null;hotCues:Array<number|null>;analysis:TrackAnalysis|null;tonality:Track['tonality']|null;duration:number;}
interface Settings {volume:number;dsp:DspState;tempoPercent:number;quantize:boolean;slip:boolean;keyLock:boolean;}
interface History {track:Track;deck:DeckId;action:'loaded'|'played';at:number;}
export interface WorkflowState {version:1;queue:Track[];favorites:Track[];history:History[];marks:Record<string,SavedMarks>;settings:Record<DeckId,Settings>;mixer:{crossfader:number;masterVolume:number;master:DeckId};storageError:string|null;}
type WorkflowView=Pick<WorkflowState,'queue'|'favorites'|'history'|'storageError'>;
export interface WorkflowStorage {getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void;}
const initialSettings=():Settings=>({volume:.75,dsp:{...defaultDspState},tempoPercent:0,quantize:false,slip:false,keyLock:false});
const empty=():WorkflowState=>({version:1,queue:[],favorites:[],history:[],marks:{},settings:{A:initialSettings(),B:initialSettings()},mixer:{crossfader:emptyMixerSnapshot.crossfader,masterVolume:emptyMixerSnapshot.masterVolume,master:'A'},storageError:null});
export function trackIdentity(t:Track):string {return `${t.provider??'youtube'}:${t.id}`;}
function object(v:unknown):Record<string,unknown>|null{return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;}
function finite(v:unknown,min:number,max:number,fallback:number):number{return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fallback;}
function cleanTrack(v:unknown):Track|null {
 const original=object(v),t:Record<string,unknown>|null=original?{...original,provider:original.provider??'youtube'}:null;if(!t||!['audius','youtube'].includes(String(t.provider))||typeof t.id!=='string'||!/^[a-zA-Z0-9_-]{3,64}$/.test(t.id)||typeof t.title!=='string'||!t.title.trim()||typeof t.channel!=='string'||typeof t.sourceUrl!=='string')return null;
 try {const url=new URL(t.sourceUrl);if(url.protocol!=='https:'||url.username||url.password||url.hash)return null;
  if(t.provider==='audius'&&(url.hostname!=='audius.co'||url.search))return null;
  if(t.provider==='youtube'&&(!['www.youtube.com','youtube.com'].includes(url.hostname)||url.pathname!=='/watch'||url.search!==`?v=${t.id}`))return null;
 }catch{return null;}
 const timing=object(t.timing),tonality=object(t.tonality),bpm=normalizeBpm(timing?.bpm),key=normalizeKey(tonality?.key);
 const kind=(v:unknown):v is 'provider'|'providerEstimated'=>v==='provider'||v==='providerEstimated';
 return {provider:t.provider as Track['provider'],id:t.id,title:t.title.slice(0,500),channel:t.channel.slice(0,200),duration:t.duration===null?null:finite(t.duration,0,86400,0)||null,thumbnail:'',sourceUrl:t.sourceUrl,
  ...(bpm&&kind(timing?.kind)?{timing:{bpm,kind:timing.kind}}:{}),...(key&&kind(tonality?.kind)?{tonality:{key:key.name,kind:tonality.kind}}:{})};
}
function tracks(value:unknown,max:number):Track[]{const seen=new Set<string>();return Array.isArray(value)?value.slice(0,max).flatMap(v=>{const t=cleanTrack(v);if(!t||seen.has(trackIdentity(t)))return [];seen.add(trackIdentity(t));return [t];}):[];}
function settings(value:unknown):Settings {const v=object(value),d=object(v?.dsp);return {volume:finite(v?.volume,0,1,.75),tempoPercent:finite(v?.tempoPercent,-20,20,0),quantize:v?.quantize===true,slip:v?.slip===true,keyLock:v?.keyLock===true,dsp:{low:finite(d?.low,-1,1,0),mid:finite(d?.mid,-1,1,0),high:finite(d?.high,-1,1,0),filter:finite(d?.filter,-1,1,0)}};}
/** Versioned whitelist: signed media URLs, waveform samples and runtime handles never enter storage. */
export function restoreState(serialized:string|null):WorkflowState {
 const result=empty();if(!serialized||serialized.length>2_000_000)return result;
 let raw:Record<string,unknown>|null;try{raw=object(JSON.parse(serialized));}catch{return result;}if(raw?.version!==1)return result;
 result.queue=tracks(raw.queue,200);result.favorites=tracks(raw.favorites,500);
 if(Array.isArray(raw.history))result.history=raw.history.slice(0,100).flatMap(v=>{const h=object(v),t=cleanTrack(h?.track);return t&&['A','B'].includes(String(h?.deck))&&['loaded','played'].includes(String(h?.action))&&typeof h?.at==='number'&&Number.isFinite(h.at)&&h.at>=0?[{track:t,deck:h.deck as DeckId,action:h.action as History['action'],at:h.at}]:[];});
 const all=[...result.queue,...result.favorites,...result.history.map(h=>h.track)];
 for(const [identity,value] of Object.entries(object(raw.marks)??{}).slice(-500)){
  if(!/^(audius|youtube):[a-zA-Z0-9_-]{3,64}$/.test(identity))continue;const m=object(value);if(!m)continue;
  const duration=finite(m.duration,1,86400,all.find(t=>trackIdentity(t)===identity)?.duration??0);if(!duration)continue;
  const mark=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=duration?v:null;
  const tonal=object(m.tonality),key=normalizeKey(tonal?.key);
  result.marks[identity]={duration,cue:mark(m.cue),hotCues:Array.from({length:4},(_,i)=>mark(Array.isArray(m.hotCues)?m.hotCues[i]:null)),analysis:isTrackAnalysis(m.analysis)&&m.analysis.firstBeatTime<=duration?{...m.analysis}:null,
   tonality:key&&(tonal?.kind==='provider'||tonal?.kind==='providerEstimated')?{key:key.name,kind:tonal.kind}:null};
 }
 const s=object(raw.settings),m=object(raw.mixer);result.settings={A:settings(s?.A),B:settings(s?.B)};result.mixer={crossfader:finite(m?.crossfader,-1,1,emptyMixerSnapshot.crossfader),masterVolume:finite(m?.masterVolume,0,1,emptyMixerSnapshot.masterVolume),master:m?.master==='B'?'B':'A'};return result;
}
export class WorkflowStore {
 private state:WorkflowState;private listeners=new Set<()=>void>();private removers:Array<()=>void>=[];private disposed=false;private busy=false;
 private decks:Record<DeckId,DeckSnapshot>;private loaded:Partial<Record<DeckId,Track|null>>={};private played:Partial<Record<DeckId,Track|null>>={};
 private restored:Partial<Record<DeckId,Track|null>>={};
 private tempoRevisions:Record<DeckId,number>;
 private dj:DualDeck;private storage:WorkflowStorage|null;
 private dirty=false;private saveTimer:ReturnType<typeof setTimeout>|null=null;
 private view:WorkflowView|null=null;
 constructor(dj:DualDeck,storage:WorkflowStorage|null){
  this.dj=dj;this.storage=storage;let raw:string|null=null;try{raw=storage?.getItem(STORAGE_KEY)??null;}catch{ /* in-memory recovery */ }
  this.state=restoreState(raw);
  if(!storage)this.state={...this.state,storageError:'無法使用本機儲存；目前資料僅保留於此工作階段'};
  for(const id of ['A','B'] as const){const d=this.deck(id),s=this.state.settings[id];d.setVolume(s.volume);d.setTempo(s.tempoPercent);d.setLow(s.dsp.low);d.setMid(s.dsp.mid);d.setHigh(s.dsp.high);d.setFilter(s.dsp.filter);d.setQuantize(s.quantize);d.setKeyLock(s.keyLock);this.performance(id).setSlip(s.slip);}
  dj.mixer.setCrossfader(this.state.mixer.crossfader);dj.mixer.setMasterVolume(this.state.mixer.masterVolume);dj.sync.setMaster(this.state.mixer.master);
  this.decks={A:dj.deckA.getSnapshot(),B:dj.deckB.getSnapshot()};
  this.tempoRevisions={A:dj.deckA.getTempoRevision(),B:dj.deckB.getTempoRevision()};
  for(const id of ['A','B'] as const){this.removers.push(this.deck(id).subscribe(()=>this.observeDeck(id)),this.performance(id).subscribe(()=>this.observeSettings(id)));}
  this.removers.push(dj.mixer.subscribe(()=>this.observeMixer()),dj.sync.subscribe(()=>this.observeMixer()));
 }
 getSnapshot=():WorkflowState=>this.state;
 getViewSnapshot=():WorkflowView=>{const s=this.state,v=this.view;if(!v||v.queue!==s.queue||v.favorites!==s.favorites||v.history!==s.history||v.storageError!==s.storageError)this.view={queue:s.queue,favorites:s.favorites,history:s.history,storageError:s.storageError};return this.view!;};
 subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private deck(id:DeckId){return id==='A'?this.dj.deckA:this.dj.deckB;}
 private performance(id:DeckId){return id==='A'?this.dj.performanceA:this.dj.performanceB;}
 private write(){if(this.saveTimer!==null){clearTimeout(this.saveTimer);this.saveTimer=null;}if(!this.dirty)return;this.dirty=false;
  try{this.storage?.setItem(STORAGE_KEY,JSON.stringify({...this.state,storageError:undefined}));this.state={...this.state,storageError:this.storage?null:'無法使用本機儲存；目前資料僅保留於此工作階段'};}catch{this.state={...this.state,storageError:'本機儲存失敗；目前變更仍可使用，但重啟後可能遺失'};}
 }
 flush=():void=>{if(this.disposed)return;const error=this.state.storageError;this.write();if(error!==this.state.storageError)for(const listener of this.listeners)listener();};
 private publish(change:Partial<WorkflowState>,deferred=false){if(this.disposed)return;this.state={...this.state,...change};this.dirty=true;
  if(deferred){if(this.saveTimer===null)this.saveTimer=setTimeout(()=>{this.saveTimer=null;this.flush();},250);}else this.write();for(const listener of this.listeners)listener();
 }
 private observeSettings(id:DeckId){if(this.busy||this.disposed)return;const d=this.deck(id),s=d.getSnapshot(),old=this.state.settings[id],revision=d.getTempoRevision();
  const next:Settings={volume:s.volume,dsp:s.dsp,tempoPercent:revision!==this.tempoRevisions[id]?s.tempoPercent:old.tempoPercent,quantize:s.quantize,slip:this.performance(id).getSnapshot().slip,keyLock:s.keyLock};this.tempoRevisions[id]=revision;
  if(Object.entries(next).some(([key,v])=>v!==old[key as keyof Settings]))this.publish({settings:{...this.state.settings,[id]:next}},true);
 }
 private observeMixer(){if(this.disposed)return;const s=this.dj.mixer.getSnapshot(),master=this.dj.sync.getSnapshot().master;const next={crossfader:s.crossfader,masterVolume:s.masterVolume,master};if(JSON.stringify(next)!==JSON.stringify(this.state.mixer))this.publish({mixer:next},true);}
 private history(id:DeckId,action:History['action'],track:Track){const t=cleanTrack(track);if(t)this.publish({history:[{track:t,deck:id,action,at:Date.now()},...this.state.history].slice(0,100)});}
 private observeDeck(id:DeckId){
  if(this.disposed||this.busy)return;const d=this.deck(id);let s=d.getSnapshot();const before=this.decks[id];
  if(s.track&&['ready','paused','playing','ended'].includes(s.status)&&s.duration&&this.loaded[id]!==s.track){
   this.loaded[id]=s.track;this.played[id]=null;
   this.history(id,'loaded',s.track!);
  }
  if(s.track&&s.canSeek&&['ready','paused','playing','ended'].includes(s.status)&&this.restored[id]!==s.track){
   this.restored[id]=s.track;const saved=this.state.marks[trackIdentity(s.track)];
   if(saved){this.busy=true;try{d.restoreNavigation(saved);}finally{this.busy=false;}s=d.getSnapshot();}
  }
  if(s.track&&s.status==='playing'&&this.played[id]!==s.track){this.played[id]=s.track;this.history(id,'played',s.track);}
  if(s.track&&s.duration&&s.canSeek&&['ready','paused','playing','ended'].includes(s.status)&&(s.track!==before.track||s.cue!==before.cue||s.hotCues!==before.hotCues||s.analysis!==before.analysis||s.duration!==before.duration)){
   const marks={...this.state.marks,[trackIdentity(s.track)]:{cue:s.cue,hotCues:[...s.hotCues],analysis:s.analysis,tonality:s.track.tonality??null,duration:s.duration}};
   this.publish({marks:Object.fromEntries(Object.entries(marks).slice(-500))});
  }
  this.decks[id]=s;this.observeSettings(id);
 }
 addQueue(track:Track){const t=cleanTrack(track);if(t&&t.provider==='audius'&&!this.state.queue.some(v=>trackIdentity(v)===trackIdentity(t)))this.publish({queue:[...this.state.queue,t].slice(0,200)});}
 removeQueue(identity:string){this.publish({queue:this.state.queue.filter(t=>trackIdentity(t)!==identity)});}
 moveQueue(index:number,delta:number){const target=index+delta;if(!Number.isInteger(index)||!Number.isInteger(delta)||index<0||target<0||index>=this.state.queue.length||target>=this.state.queue.length)return;const queue=[...this.state.queue];const [track]=queue.splice(index,1);queue.splice(target,0,track);this.publish({queue});}
 toggleFavorite(track:Track){const t=cleanTrack(track);if(!t)return;const identity=trackIdentity(t),found=this.state.favorites.some(v=>trackIdentity(v)===identity);this.publish({favorites:found?this.state.favorites.filter(v=>trackIdentity(v)!==identity):[...this.state.favorites,t].slice(0,500)});}
 async load(id:DeckId,track:Track){if(this.disposed||track.provider!=='audius')return;const saved=this.state.marks[trackIdentity(track)];await this.deck(id).load({...track,...(!track.tonality&&saved?.tonality?{tonality:saved.tonality}:{})});}
 dispose(){if(this.disposed)return;this.disposed=true;this.write();for(const remove of this.removers)remove();this.removers=[];this.listeners.clear();}
}
