import type {DeckEngine,DeckSnapshot} from './DeckEngine';
import type {DeckId} from '../types/deck';
import {isTrackAnalysis} from '../services/analysis.ts';
import {tempoRate,TEMPO_MIN_PERCENT,TEMPO_MAX_PERCENT,TEMPO_MIN_RATE,TEMPO_MAX_RATE} from './tempo.ts';
import {matchBpm,beatPhase,nearestPhaseTime,phaseErrorSeconds} from './beat-sync-math.ts';
import type {BpmMatch} from './beat-sync-math';

export interface BeatSyncSnapshot {
  readonly master:DeckId;readonly follower:DeckId;readonly enabled:boolean;
  readonly status:'off'|'waiting'|'locked'|'correcting'|'limited'|'error';
  readonly message:string;readonly match:BpmMatch|null;readonly driftMs:number|null;
}
export const emptyBeatSyncSnapshot:BeatSyncSnapshot={master:'A',follower:'B',enabled:false,status:'off',message:'Sync 未啟用',match:null,driftMs:null};
export interface SyncScheduler {now:()=>number;start:(callback:()=>void)=>()=>void;}
const scheduler:SyncScheduler={now:()=>performance.now(),start:callback=>{const timer=setInterval(callback,250);return()=>clearInterval(timer);}};

/** Pair-level timing controller. Never owns audio nodes or alters the master deck. */
export class BeatSyncEngine {
  private state:BeatSyncSnapshot={...emptyBeatSyncSnapshot};
  private readonly decks:Record<DeckId,DeckEngine>;
  private readonly clock:SyncScheduler;
  private readonly removers:Array<()=>void>;
  private listeners=new Set<()=>void>();
  private stopTimer:(()=>void)|null=null;
  private disposed=false;private busy=false;
  private captured:Array<DeckSnapshot>=[];
  private tempoRevisions:number[]=[];private navRevisions:number[]=[];
  private pendingAlignment=false;private lastNavigation=0;private graceUntil=0;private bothPlaying=false;
  constructor(a:DeckEngine,b:DeckEngine,clock:SyncScheduler=scheduler){
    this.decks={A:a,B:b};this.clock=clock;
    this.removers=[a.subscribe(()=>this.observe()),b.subscribe(()=>this.observe())];
  }
  getSnapshot=():BeatSyncSnapshot=>this.state;
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(change:Partial<BeatSyncSnapshot>):void {
    if(Object.entries(change).every(([key,value])=>this.state[key as keyof BeatSyncSnapshot]===value))return;
    this.state={...this.state,...change};for(const listener of this.listeners)listener();
  }
  private pair():[DeckEngine,DeckEngine]{return [this.decks[this.state.master],this.decks[this.state.follower]];}
  private valid(s:DeckSnapshot):boolean {
    return ['ready','playing','paused'].includes(s.status)&&s.canSeek&&s.duration!==null&&s.duration>0&&isTrackAnalysis(s.analysis);
  }
  private warning():string {
    return this.pair().some(deck=>deck.getSnapshot().analysis?.origin==='assumed')?'；拍點起始暫定，尚未確認音樂對齊':'';
  }
  private setRate(rate:number):boolean {
    const follower=this.pair()[1];const percent=Math.max(TEMPO_MIN_PERCENT,Math.min(TEMPO_MAX_PERCENT,(rate-1)*100));
    if(Math.abs(follower.getSnapshot().tempoPercent-percent)<1e-9)return follower.getSnapshot().status!=='error';
    this.busy=true;try{follower.setTempo(percent,'sync');}finally{this.busy=false;}
    return follower.getSnapshot().status!=='error';
  }
  private rateOrStop(rate:number):boolean {
    if(this.setRate(rate))return true;
    this.disable('Follower 速度設定失敗；Sync 已停止',false,'error');return false;
  }
  disable(message='Sync 已解除',restore=true,status:BeatSyncSnapshot['status']='off'):void {
    const wasEnabled=this.state.enabled,match=this.state.match;
    this.stopTimer?.();this.stopTimer=null;this.pendingAlignment=false;
    if(wasEnabled&&restore&&match)this.setRate(match.rate);
    this.captured=[];this.tempoRevisions=[];this.navRevisions=[];this.bothPlaying=false;
    this.update({enabled:false,status,message,driftMs:null,match:null});
  }
  setMaster(deck:DeckId):void {
    if(deck!=='A'&&deck!=='B')throw new RangeError('Invalid master deck');
    if(this.disposed||deck===this.state.master)return;
    this.disable('Master 已變更，請重新 Sync');
    this.update({master:deck,follower:deck==='A'?'B':'A',match:null});
  }
  sync(follower:DeckId):boolean {
    if(this.disposed)return false;
    this.disable('準備同步');
    if(this.disposed)return false;
    if(follower!==this.state.follower){this.update({status:'error',message:'只能同步 Follower Deck'});return false;}
    const [master,follow]=this.pair(),m=master.getSnapshot(),f=follow.getSnapshot();
    if(master.isPerformanceActive()||follow.isPerformanceActive()){this.update({status:'error',message:'請先結束 Loop／Slip，再重新 Sync'});return false;}
    if(!this.valid(m)||!this.valid(f)||master.isSeeking()||follow.isSeeking()){
      this.update({status:'error',match:null,message:'需要兩個已載入、可 seek 且有 BPM／Beat Grid 的 Deck；請等待載入或 seek 完成'});return false;
    }
    const match=matchBpm(m.analysis!.bpm,tempoRate(m.tempoPercent),f.analysis!.bpm);
    if(!match){this.update({status:'error',match:null,message:`BPM 無法在 ±${TEMPO_MAX_PERCENT}% Tempo 內配對（已嘗試半倍／雙倍）`});return false;}
    const phase=beatPhase(m.analysis!,master.getCurrentTime());
    const target=phase===null?null:nearestPhaseTime(f.analysis!,follow.getCurrentTime(),phase,f.duration!,match.factor);
    if(target===null){this.update({status:'error',match:null,message:'目前位置沒有可用拍相位；請進入拍點起始之後'});return false;}
    this.update({match});if(this.disposed)return false;
    if(!this.rateOrStop(match.rate)||this.disposed)return false;
    if(!this.align(target)){this.setRate(tempoRate(f.tempoPercent));this.disable('無法在可 seek 範圍內對齊拍點',true,'error');return false;}
    if(this.disposed)return false;
    this.captured=[m,follow.getSnapshot()];
    this.tempoRevisions=[master.getTempoRevision(),follow.getTempoRevision()];
    this.navRevisions=[master.getNavigationRevision(),follow.getNavigationRevision()];
    this.bothPlaying=m.status==='playing'&&follow.getSnapshot().status==='playing';
    this.pendingAlignment=!this.bothPlaying;this.lastNavigation=this.clock.now();this.graceUntil=this.clock.now()+1000;
    this.stopTimer=this.clock.start(()=>this.tick());
    this.update({enabled:true,status:this.bothPlaying?'locked':'waiting',driftMs:0,message:(this.bothPlaying?'已配對 BPM 與拍相位':'BPM／相位已配對；等待雙方播放')+this.warning()});
    return this.state.enabled&&!this.disposed;
  }
  private align(target?:number):boolean {
    const [master,follow]=this.pair(),m=master.getSnapshot(),f=follow.getSnapshot(),match=this.state.match;
    if(!match||!this.valid(m)||!this.valid(f))return false;
    if(target===undefined){const phase=beatPhase(m.analysis!,master.getCurrentTime());
      const next=phase===null?null:nearestPhaseTime(f.analysis!,follow.getCurrentTime(),phase,f.duration!,match.factor);if(next===null)return false;target=next;}
    if(Math.abs(follow.getCurrentTime()-target)>.002){this.busy=true;try{follow.seek(target,'sync');}finally{this.busy=false;}
      if(follow.getSnapshot().status==='error'||Math.abs(follow.getSnapshot().currentTime-target)>.025)return false;}
    return true;
  }
  private observe():void {
    if(!this.state.enabled||this.busy||this.disposed)return;
    const match=this.state.match;
    if(!match)return;
    const pair=this.pair(),states=pair.map(deck=>deck.getSnapshot());
    if(states.some((s,i)=>s.track!==this.captured[i].track||!this.valid(s))){this.disable('曲目已變更、卸載、結束或無可用同步資料');return;}
    if(pair.some((deck,i)=>deck.getTempoRevision()!==this.tempoRevisions[i])){
      const manualFollower=pair[1].getTempoRevision()!==this.tempoRevisions[1];
      this.disable('手動 Tempo 變更，請重新 Sync',!manualFollower);return;
    }
    if(states.some((s,i)=>s.analysis!==this.captured[i].analysis)){this.disable('拍點起始已變更，請重新 Sync');return;}
    const revisions=pair.map(deck=>deck.getNavigationRevision());
    if(revisions.some((revision,i)=>revision!==this.navRevisions[i])){
      this.navRevisions=revisions;this.pendingAlignment=true;this.lastNavigation=this.clock.now();
      this.update({status:'waiting',message:'等待手動 seek 結束，再對齊一次'});
      if(!this.state.enabled||this.disposed||this.state.match!==match)return;
    }
    const playing=states.every(s=>s.status==='playing');
    if(playing!==this.bothPlaying){this.bothPlaying=playing;this.pendingAlignment=true;this.lastNavigation=this.clock.now();
      if(!this.rateOrStop(match.rate)||!this.state.enabled||this.disposed||this.state.match!==match)return;
      this.update({status:'waiting',message:playing?'恢復播放後重新對齊':'等待雙方播放；不會自動 Play／Pause'});}
  }
  private tick():void {
    this.observe();if(!this.state.enabled)return;
    const [master,follow]=this.pair(),match=this.state.match!;
    if(!this.bothPlaying||master.isSeeking()||follow.isSeeking())return;
    const now=this.clock.now();
    if(this.pendingAlignment){
      if(now-this.lastNavigation<300)return;
      if(!this.rateOrStop(match.rate))return;
      if(!this.align()){this.disable('無法重新對齊；請檢查拍點起始／seek 範圍',true,'error');return;}
      this.pendingAlignment=false;this.graceUntil=now+1000;
      this.update({status:'locked',driftMs:0,message:'已重新對齊'+this.warning()});return;
    }
    if(now<this.graceUntil)return;
    const m=master.getSnapshot(),f=follow.getSnapshot();
    const mp=beatPhase(m.analysis!,master.getCurrentTime()),fp=beatPhase(f.analysis!,follow.getCurrentTime(),match.factor);
    if(mp===null||fp===null){this.disable('目前位置缺少可用拍相位',true,'error');return;}
    const error=phaseErrorSeconds(fp,mp,60/match.targetBpm),driftMs=Math.round(error*1000);
    if(Math.abs(error)>.18){this.disable('拍相位偏差過大；已停止自動修正，請重新按 Sync',true,'error');return;}
    if(Math.abs(error)<.015){if(!this.rateOrStop(match.rate))return;this.update({status:'locked',driftMs,message:'拍相位偏差在容許範圍'+this.warning()});return;}
    const desired=match.rate*(1+Math.max(-.005,Math.min(.005,-error/2)));
    const bounded=Math.max(TEMPO_MIN_RATE,Math.min(TEMPO_MAX_RATE,desired));if(!this.rateOrStop(bounded))return;
    const limited=Math.abs(bounded-match.rate)<1e-9;
    this.update({status:limited?'limited':'correcting',driftMs,message:(limited?'已達 Tempo 界限，無法向此方向修正':'以最多 ±0.5% 速度微調修正漂移')+this.warning()});
  }
  dispose():void {
    if(this.disposed)return;this.disposed=true;this.disable('Sync 已關閉');
    for(const remove of this.removers)remove();this.listeners.clear();
  }
}
