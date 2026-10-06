import type {DeckId} from '../types/deck';
import type {DeckEngine,DeckSnapshot} from '../audio/DeckEngine';
import {formatDuration} from '../types/track';
import {tempoRate,TEMPO_MIN_PERCENT,TEMPO_MAX_PERCENT} from '../audio/tempo';
import type {BeatSyncEngine,BeatSyncSnapshot} from '../audio/BeatSyncEngine';
import type {PerformanceEngine} from '../audio/PerformanceEngine';
import {PerformanceControls} from './PerformanceControls';
import {analyzeKey,compatibleKeys} from '../services/harmonic';
import {Fader,JogWheel,PerformancePad} from './ControllerControls';
interface DeckProps {
 id:DeckId;engine?:DeckEngine|null;snapshot?:DeckSnapshot;
 sync?:BeatSyncEngine|null;syncSnapshot?:BeatSyncSnapshot;performance?:PerformanceEngine|null;
}
export function DeckDisplay({id,snapshot}:{id:DeckId;snapshot?:DeckSnapshot}) {
 const key=snapshot?.track?analyzeKey(snapshot.track):null,bpm=snapshot?.analysis,tempo=snapshot?.tempoPercent??0;
 return <div className="deck-display">
  <div className="track-heading"><p className="title" title={snapshot?.track?.title}>{snapshot?.track?.title??'尚未載入曲目'}</p>
   <p className="artist">{snapshot?.track?.channel??`將曲庫中的曲目載入 Deck ${id}`}</p></div>
  <div className="deck-metrics">
   <div><span>BPM</span><b title={bpm?`來源 ${bpm.bpm.toFixed(1)} BPM`:'無可用資料'}>{bpm?`${bpm.kind==='providerEstimated'?'≈':''}${(bpm.bpm*tempoRate(tempo)).toFixed(1)}`:'—'}</b></div>
   <div title={key?`${key.key.name} · 建議 ${compatibleKeys(key.key).join(' / ')}；來源音高，Tempo 可能改變實際音高`:'沒有調性資料'}><span>KEY / CAMELOT</span><b>{key?`${key.kind==='providerEstimated'?'≈':''}${key.key.camelot}`:'—'}</b><small>{key?.key.name??'UNKNOWN'}</small></div>
   <div><span>TEMPO</span><b>{tempo>=0?'+':''}{tempo.toFixed(1)}<small>%</small></b></div>
  </div>
  <div className="deck-clock"><span><small>ELAPSED</small>{formatDuration(snapshot?.currentTime??0)}</span>
   <span><small>REMAINING</small>{snapshot?.duration==null?'—:—':`−${formatDuration(Math.max(0,snapshot.duration-snapshot.currentTime))}`}</span></div>
 </div>;
}
/** Both decks share this implementation; the right deck is mirrored in CSS. */
export function Deck({id,engine,snapshot:live,sync,syncSnapshot,performance}:DeckProps) {
 const loaded=Boolean(engine&&live&&['ready','playing','paused','ended'].includes(live.status));
 const canSeek=loaded&&!!live?.canSeek,playing=live?.status==='playing'||!!live?.starting;
 const synced=!!syncSnapshot?.enabled&&syncSnapshot.follower===id;
 const statuses={idle:'等待曲目',loading:'載入音訊中…',ready:'READY',playing:'PLAYING',paused:'PAUSED',ended:'ENDED',error:'載入失敗'};
 return <section className="deck" data-d={id.toLowerCase()} aria-labelledby={`deck-${id}-title`}>
  <div className="deck-top"><h2 id={`deck-${id}-title`}><span className="deck-badge">{id}</span> DECK {id}</h2>
   <div className="cue-controls"><button className="btn" disabled={!sync} aria-pressed={syncSnapshot?.master===id} onClick={()=>sync?.setMaster(id)}>MASTER</button>
    <button className="btn" disabled={!loaded||!live?.keyLockAvailable} aria-pressed={live?.keyLock} title="瀏覽器原生音高保持；品質待聽感驗收" onClick={()=>engine?.setKeyLock(!live?.keyLock)}>KEY LOCK</button></div></div>
  <DeckDisplay id={id} snapshot={live}/>
  <div className="deck-mechanics"><JogWheel id={id} engine={engine} duration={live?.duration??null} position={live?.currentTime??0} canSeek={canSeek} playing={!!playing}/>
   <div className="pitch"><Fader vertical label={`Tempo deck ${id}`} min={TEMPO_MIN_PERCENT} max={TEMPO_MAX_PERCENT} step={.1} value={live?.tempoPercent??0} display={`${(live?.tempoPercent??0).toFixed(1)}%`} disabled={!engine} onChange={value=>engine?.setTempo(value)}/>
    <button className="btn" disabled={!engine} onClick={()=>engine?.setTempo(0)}>RESET</button></div></div>
  <div className="transport" role="group" aria-label={`Deck ${id} playback`}>
   <button className="btn cue-button" disabled={!canSeek||live?.cue==null} onClick={()=>performance?performance.jumpCue():engine?.jumpCue()}>CUE</button>
   <button className="btn play-button" aria-label={`${playing?'Pause':'Play'} deck ${id}`} aria-pressed={!!playing} disabled={!loaded}
    onClick={()=>playing?engine?.pause():void engine?.play()}>{playing?'Ⅱ':'▶'}</button>
   <button className="btn sync-button" disabled={!loaded||!sync||syncSnapshot?.master===id||(!synced&&!live?.analysis)} aria-pressed={synced}
    onClick={()=>synced?sync?.disable():sync?.sync(id)}>SYNC</button>
  </div>
  <div className="cue-toolbar"><span>CUE {live?.cue==null?'—':`${live.cue.toFixed(1)}s`}</span>
   <button className="btn" disabled={!canSeek} onClick={()=>engine?.setCue()}>SET</button>
   <button className="btn" disabled={live?.cue==null} onClick={()=>engine?.clearCue()}>CLEAR</button>
   <button className="btn" disabled={!canSeek||!live?.analysis} onClick={()=>engine?.setBeatOrigin()}>GRID 起點</button>
   <button className="btn" disabled={!engine||!live||live.status==='idle'} onClick={()=>engine?.unload()}>卸載</button></div>
  <PerformanceControls id={id} engine={performance} deck={engine} snapshot={live}/>
  <div className="pad-heading"><span>HOT CUES</span><small>點擊設定／跳轉 · Shift 重新設定</small></div>
  <div className="hot-cues" role="group" aria-label={`Deck ${id} hot cues`}>{[0,1,2,3].map(index=><PerformancePad key={index} id={id} index={index} time={live?.hotCues[index]??null} disabled={!canSeek}
   onSet={()=>engine?.setHotCue(index)} onJump={()=>performance?performance.jumpHotCue(index):engine?.jumpHotCue(index)} onClear={()=>engine?.clearHotCue(index)}/>)}</div>
  <p className="deck-status" role="status"><span className={`status-dot${playing?' active':''}`}/>{live?.starting?'正在開始播放…':statuses[live?.status??'idle']}
   <span>{syncSnapshot?.master===id?'MASTER':synced?'SYNC ON':'SYNC OFF'}</span></p>
  {syncSnapshot?.follower===id&&syncSnapshot.message&&<p className="sync-info" role="status">{syncSnapshot.message}{syncSnapshot.driftMs!=null?` · ${syncSnapshot.driftMs} ms`:''}</p>}
  {live?.error&&<p className="deck-error" role="alert">{live.error.message}</p>}
 </section>;
}
