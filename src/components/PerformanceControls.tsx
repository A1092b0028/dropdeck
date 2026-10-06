import {useSyncExternalStore} from 'react';
import type {PerformanceEngine} from '../audio/PerformanceEngine';
import {emptyPerformanceSnapshot} from '../audio/PerformanceEngine';
import {LOOP_SIZES} from '../audio/performance-timing';
import type {DeckEngine,DeckSnapshot} from '../audio/DeckEngine';
const subscribeEmpty=()=>()=>{};
export function PerformanceControls({engine,deck,snapshot,id}:{engine?:PerformanceEngine|null;deck?:DeckEngine|null;snapshot?:DeckSnapshot;id:string}){
 const state=useSyncExternalStore(engine?.subscribe??subscribeEmpty,engine?.getSnapshot??(()=>emptyPerformanceSnapshot));
 const available=Boolean(engine&&snapshot?.canSeek&&snapshot.analysis);
 return <div className="performance-controls" role="group" aria-label={`Deck ${id} Performance`}>
  <div className="cue-controls performance-row">
   <button className="btn" disabled={!deck} aria-pressed={snapshot?.quantize} onClick={()=>deck?.setQuantize(!snapshot?.quantize)}>Quantize {snapshot?.quantize?'ON':'OFF'}</button>
   <button className="btn" disabled={!engine} aria-pressed={state.slip} onClick={()=>engine?.setSlip(!state.slip)}>Slip {state.slip?'ON':'OFF'}</button>
   <button className="btn" disabled={!state.slipping} onClick={()=>engine?.returnSlip()}>Slip Return</button>
  </div>
  <div className="cue-controls performance-row">
   <label>Auto Loop <select aria-label={`Loop length deck ${id}`} value={state.loopBeats} disabled={!available} onChange={event=>engine?.enableLoop(Number(event.target.value))}>{LOOP_SIZES.map(n=><option key={n} value={n}>{n} beats</option>)}</select></label>
   <button className="btn" disabled={!available} aria-pressed={Boolean(state.loop)} onClick={()=>state.loop?engine?.disableLoop():engine?.enableLoop()}>Loop {state.loop?'OFF':'ON'}</button>
  </div>
  <div className="control-label">BEAT JUMP</div>
  <div className="beat-jump">{[-16,-8,-4,-1,1,4,8,16].map(n=><button className="btn" key={n} aria-label={`Beat jump ${n} deck ${id}`} disabled={!available} onClick={()=>engine?.beatJump(n)}>{n>0?'+':''}{n}</button>)}</div>
  {(state.message||state.slipping)&&<p className="dsp-hint" role="status">{state.message}{state.slipping?' · Slip 跳轉中，Return 返回推進時間線':''}</p>}
 </div>;
}
