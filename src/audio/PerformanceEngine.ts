import type {DeckEngine,DeckSnapshot} from './DeckEngine';
import {loopRegion,jumpBeats,slipPosition} from './performance-timing.ts';
import type {LoopRegion} from './performance-timing';
import {tempoRate} from './tempo.ts';
export interface PerformanceSnapshot {readonly loop:LoopRegion|null;readonly slip:boolean;readonly slipping:boolean;readonly loopBeats:number;readonly message:string;}
export const emptyPerformanceSnapshot:PerformanceSnapshot={loop:null,slip:false,slipping:false,loopBeats:4,message:''};
export interface PerformanceClock {now:()=>number;start:(callback:()=>void)=>()=>void;}
const clock:PerformanceClock={now:()=>performance.now(),start:callback=>{
 let active=true,id=0;const frame=()=>{if(!active)return;callback();if(active)id=requestAnimationFrame(frame);};id=requestAnimationFrame(frame);
 return()=>{active=false;cancelAnimationFrame(id);};
}};
/** Source-time navigation only. RAF observes media position; it never supplies a beat clock. */
export class PerformanceEngine {
 private state={...emptyPerformanceSnapshot};private listeners=new Set<()=>void>();private disposed=false;private busy=false;
 private previous:DeckSnapshot;private navRevision:number;private remove:()=>void;private stop:(()=>void)|null=null;
 private logical=0;private stamp=0;
 private deck:DeckEngine;private onAction:()=>void;private clock:PerformanceClock;
 constructor(deck:DeckEngine,onAction:()=>void=()=>{},scheduler:PerformanceClock=clock){
  this.deck=deck;this.onAction=onAction;this.clock=scheduler;this.previous=deck.getSnapshot();this.navRevision=deck.getNavigationRevision();this.remove=deck.subscribe(()=>this.observe());
 }
 getSnapshot=():PerformanceSnapshot=>this.state;
 subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private update(change:Partial<PerformanceSnapshot>){this.state={...this.state,...change};for(const listener of this.listeners)listener();}
 private advance(){const now=this.clock.now();if(this.state.slipping&&this.previous.duration&&this.previous.status==='playing')this.logical=slipPosition(this.logical,Math.max(0,now-this.stamp)/1000,tempoRate(this.previous.tempoPercent),this.previous.duration);this.stamp=now;}
 private observe(){
  if(this.disposed)return;this.advance();const next=this.deck.getSnapshot();
  if(next.status==='ended'&&this.state.loop&&this.deck.isRangeSeekable(this.state.loop.start,this.state.loop.end)&&this.previous.status==='playing'){
   const start=this.state.loop.start;this.previous=next;this.seek(start);if(this.state.loop&&!this.disposed&&this.deck.getSnapshot().status==='paused')void this.deck.play();return;
  }
  const changed=next.track!==this.previous.track||['idle','loading','error','ended'].includes(next.status)||next.analysis!==this.previous.analysis;
  const navigation=this.deck.getNavigationRevision()!==this.navRevision;this.previous=next;this.navRevision=this.deck.getNavigationRevision();
  if(changed||(!this.busy&&navigation&&(this.state.loop||this.state.slipping)))this.reset();
 }
 private reset(){this.stop?.();this.stop=null;this.deck.setPerformanceActive(false);if(this.state.loop||this.state.slipping)this.update({loop:null,slipping:false});}
 private ready(){const s=this.deck.getSnapshot();return !this.disposed&&s.canSeek&&s.duration!==null&&['ready','paused','playing','ended'].includes(s.status)?s:null;}
 private begin():boolean {
  const track=this.deck.getSnapshot().track;this.onAction();if(this.disposed||!this.ready()||this.deck.getSnapshot().track!==track)return false;
  this.deck.setPerformanceActive(true);if(this.state.slip&&!this.state.slipping){this.logical=this.deck.getCurrentTime();this.stamp=this.clock.now();this.update({slipping:true});}
  if(this.disposed||!this.ready()||this.deck.getSnapshot().track!==track){this.reset();return false;}
  if(!this.stop)this.stop=this.clock.start(()=>this.tick());return true;
 }
 private seek(time:number){this.busy=true;try{this.deck.seek(time,'sync');}finally{this.busy=false;}}
 private tick(){if(this.disposed)return;this.advance();const s=this.ready(),loop=this.state.loop;if(!s){this.reset();return;}if(loop&&!this.deck.isRangeSeekable(loop.start,loop.end)){this.reset();this.update({message:'Loop 範圍已無法 seek；已停止 Loop'});return;}if(loop&&s.status==='playing'&&!this.deck.isSeeking()){
   const t=this.deck.getCurrentTime();if(t>=loop.end)this.seek(loop.start+(t-loop.end)%(loop.end-loop.start));
  }}
 setSlip(enabled:boolean){if(this.disposed)return;if(!enabled)this.returnSlip();this.update({slip:enabled});}
 enableLoop(beats=this.state.loopBeats):boolean {
  const s=this.ready();const region=s?.analysis?loopRegion(this.state.loop?.start??this.deck.getCurrentTime(),beats,s.analysis,s.duration!):null;
  if(!region||!this.deck.isRangeSeekable(region.start,region.end)){if(!this.disposed)this.update({message:'需要 BPM／Beat Grid，且完整 Loop 必須在可 seek 的曲目範圍內'});return false;}
  if(!this.begin())return false;this.update({loop:region,loopBeats:beats,message:'串流 seek Loop；非無縫。已解除 Sync'});
  if(this.disposed||this.deck.getSnapshot().track!==s!.track||!this.state.loop)return false;
  if(this.deck.getCurrentTime()<region.start||this.deck.getCurrentTime()>=region.end)this.seek(region.start);return true;
 }
 disableLoop(){if(this.disposed)return;this.advance();const returnTo=this.state.slipping?this.logical:null;this.reset();if(returnTo!==null)this.seek(returnTo);}
 beatJump(beats:number):boolean {
  const s=this.ready();const target=s?.analysis?jumpBeats(this.deck.getCurrentTime(),beats,s.analysis,s.duration!,s.quantize):null;if(target===null)return false;
  this.disableLoop();this.onAction();this.seek(target);return true;
 }
 private jump(time:number|null){if(time===null||!this.ready())return;if(this.state.loop)this.disableLoop();if(this.state.slip){if(!this.begin())return;}else this.onAction();if(!this.disposed)this.seek(time);}
 jumpCue(){this.jump(this.deck.getSnapshot().cue);}
 jumpHotCue(index:number){if(!Number.isInteger(index)||index<0||index>3)throw new RangeError('Hot cue index');this.jump(this.deck.getSnapshot().hotCues[index]);}
 returnSlip(){if(this.disposed)return;this.disableLoop();}
 dispose(){if(this.disposed)return;this.disposed=true;this.reset();this.remove();this.listeners.clear();}
}
