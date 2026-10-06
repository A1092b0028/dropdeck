import {useCallback} from 'react';
import type {DualDeck} from '../audio/DualDeck';
import type {MixerEngine,MixerSnapshot} from '../audio/MixerEngine';
import {emptyMixerSnapshot} from '../audio/MixerEngine';
import {useDeckSnapshot} from '../stores/useDualDeck';
import {eqGainDb} from '../audio/DeckDsp';
import {Fader,Knob,LevelMeter} from './ControllerControls';
export function MixerChannel({owner,id}:{owner:DualDeck|null;id:'A'|'B'}) {
 const engine=id==='A'?owner?.deckA:owner?.deckB,state=useDeckSnapshot(engine);
 const readSamples=useCallback(()=>owner?.readWaveform(id)??null,[owner,id]);
 return <div className="mixer-channel" data-d={id.toLowerCase()}>
  <h3>CH {id}</h3>
  <button className="gain-unavailable" disabled title="現有引擎沒有獨立輸入 Gain trim；下方推桿控制通道音量">GAIN · 未支援</button>
  {([{label:'HIGH',key:'high',method:'setHigh'},{label:'MID',key:'mid',method:'setMid'},{label:'LOW',key:'low',method:'setLow'}] as const).map(band=>
   <Knob key={band.key} label={`${band.label} EQ deck ${id}`} min={-1} max={1} value={state.dsp[band.key]} display={`${eqGainDb(state.dsp[band.key]).toFixed(1)} dB`} disabled={!engine} onChange={value=>engine?.[band.method](value)}/>)}
  <Knob label={`Filter deck ${id}`} min={-1} max={1} value={state.dsp.filter} display={state.dsp.filter===0?'NEUTRAL':`${state.dsp.filter<0?'LP':'HP'} ${Math.round(Math.abs(state.dsp.filter)*100)}%`} disabled={!engine} onChange={value=>engine?.setFilter(value)}/>
  <button className="btn mixer-reset" disabled={!engine} onClick={()=>engine?.resetDsp()}>EQ RESET</button>
  <div className="channel-level"><Fader vertical label={`Volume deck ${id}`} min={0} max={1} value={state.volume} display={`${Math.round(state.volume*100)}%`} disabled={!engine} onChange={value=>engine?.setVolume(value)}/>
   <LevelMeter id={id} engine={engine} readSamples={readSamples}/></div>
 </div>;
}
export function Mixer({engine,snapshot=emptyMixerSnapshot,owner=null}:{engine?:MixerEngine|null;snapshot?:MixerSnapshot;owner?:DualDeck|null}) {
 return <section className="mix" aria-label="Mixer"><h2>MIXER</h2>
  <div className="mixer-channels"><MixerChannel id="A" owner={owner}/><MixerChannel id="B" owner={owner}/></div>
  <p className="meter-note">來源電平 · EQ / 推桿之前</p>
  <Fader label="Master volume" min={0} max={1} value={snapshot.masterVolume} display={`${Math.round(snapshot.masterVolume*100)}%`} disabled={!engine} onChange={value=>engine?.setMasterVolume(value)}/>
  <div className="crossfade"><span>A</span><Fader label="Crossfader" min={-1} max={1} value={snapshot.crossfader} display={`A ${Math.round(snapshot.gainA*100)}% / B ${Math.round(snapshot.gainB*100)}%`} disabled={!engine} onChange={value=>engine?.setCrossfader(value)}/><span>B</span></div>
  <small className="mixer-footnote">EQUAL POWER</small>
 </section>;
}
