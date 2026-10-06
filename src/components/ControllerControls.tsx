import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { DeckEngine } from '../audio/DeckEngine';
import { startWaveformLoop } from '../services/waveform-loop';
import { sourceLevel } from '../services/source-meter';
import { knobDragValue } from '../services/knob-drag';

interface RangeProps {
 label: string; value: number; min: number; max: number; step?: number;
 disabled?: boolean; display: string; onChange: (value: number) => void;
}

/** Native range semantics retain keyboard, touch and screen reader support. */
export function Knob({label,value,min,max,step=.01,disabled,display,onChange}:RangeProps) {
 const drag=useRef<{pointerId:number;y:number;value:number}|null>(null);
 const angle=-135+(value-min)/(max-min)*270;
 return <label className={`knob-control${disabled?' unavailable':''}`}>
  <span className="control-label">{label.replace(/ deck [AB]$/, '').replace(' EQ', '').toUpperCase()}</span>
  <span className="knob-face" style={{'--angle':`${angle}deg`} as CSSProperties} aria-hidden="true"><i/></span>
  <input type="range" aria-label={label} aria-valuetext={display} min={min} max={max} step={step}
   value={value} disabled={disabled} title="上下拖曳調整；按住 Shift 可精細調整；方向鍵微調"
   onPointerDown={e=>{
    if(disabled||e.button!==0)return;
    e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
    drag.current={pointerId:e.pointerId,y:e.clientY,value:e.currentTarget.valueAsNumber};
   }}
   onPointerMove={e=>{
    const active=drag.current;if(!active||active.pointerId!==e.pointerId||disabled)return;
    active.value=knobDragValue(active.value,active.y-e.clientY,min,max,e.shiftKey);active.y=e.clientY;
    const snapped=min+Math.round((active.value-min)/step)*step;
    onChange(Math.max(min,Math.min(max,Number(snapped.toFixed(8)))));
   }}
   onPointerUp={e=>{if(drag.current?.pointerId!==e.pointerId)return;drag.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
   onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
   onChange={e=>{if(!drag.current)onChange(e.currentTarget.valueAsNumber);}}/>
  <output>{display}</output>
 </label>;
}
export function Fader({label,value,min,max,step=.01,disabled,display,onChange,vertical=false}:RangeProps&{vertical?:boolean}) {
 return <label className={`fader-control ${vertical?'vertical':'horizontal'}`}>
  <span className="control-label">{label.replace(/ deck [AB]$/, '').toUpperCase()}</span>
  <input type="range" aria-label={label} aria-valuetext={display} min={min} max={max} step={step}
   value={value} disabled={disabled} onChange={e=>onChange(e.currentTarget.valueAsNumber)}/>
  <output>{display}</output>
 </label>;
}
export function JogWheel({id,engine,duration,position,canSeek,playing}:{
 id:string;engine?:DeckEngine|null;duration:number|null;position:number;canSeek:boolean;playing:boolean;
}) {
 return <label className={`jog-wheel${playing?' playing':''}`}>
  <span className="jog-grooves" aria-hidden="true"/>
  <span className="jog-center" aria-hidden="true"><b>{id}</b><small>{playing?'PLAYING':'STANDBY'}</small></span>
  <input type="range" min={0} max={duration??1} step={.1} value={Math.min(position,duration??0)}
   aria-label={`Jog seek deck ${id}`} aria-valuetext={`${position.toFixed(1)} 秒`}
   disabled={!canSeek||!duration} onChange={e=>engine?.seek(e.currentTarget.valueAsNumber)}/>
  <span className="jog-caption">JOG / SEEK · 拖曳定位</span>
 </label>;
}
export function PerformancePad({id,index,time,disabled,onSet,onJump,onClear}:{
 id:string;index:number;time:number|null;disabled:boolean;onSet:()=>void;onJump:()=>void;onClear:()=>void;
}) {
 return <div className="performance-pad">
  <button className="pad" disabled={disabled} aria-pressed={time!==null}
   title={time===null?'設定目前位置；Shift + 點擊重新設定':'跳至 Hot Cue；Shift + 點擊重新設定'}
   aria-label={`Hot cue ${index+1}${time===null?' set':' jump'} deck ${id}`}
   onClick={e=>e.shiftKey||time===null?onSet():onJump()}>
   <b>{String(index+1).padStart(2,'0')}</b><span>{time===null?'SET CUE':`${time.toFixed(1)}s`}</span>
  </button>
  <button className="pad-clear" disabled={time===null} onClick={onClear} aria-label={`Clear hot cue ${index+1} deck ${id}`}>清除</button>
 </div>;
}
/** No audio samples enter React state; draws through the existing bounded loop. */
export function LevelMeter({engine,readSamples,id}:{engine?:DeckEngine|null;readSamples:()=>Float32Array|null;id:string}) {
 const ref=useRef<HTMLCanvasElement>(null);
 const reader=useRef(readSamples);reader.current=readSamples;
 useEffect(()=>{
  const canvas=ref.current;if(!canvas)return;
  return startWaveformLoop(()=>{
   const context=canvas.getContext('2d');if(!context)return;
   const level=sourceLevel(engine?.getSnapshot().status==='playing'?reader.current():null);
   context.clearRect(0,0,18,112);
   const lit=level.rms===0?0:Math.max(0,(20*Math.log10(level.rms)+48)/48);
   for(let i=0;i<16;i++){context.fillStyle=i/16<lit?i>13?'#f66c70':i>10?'#f4b45e':'#5ed4ad':'#263039';context.fillRect(2,106-i*7,14,4);}
   if(level.peak>0){const peak=Math.max(0,Math.min(1,(20*Math.log10(level.peak)+48)/48));context.fillStyle='#e6eef5';context.fillRect(1,108-peak*108,16,2);}
  });
 },[engine]);
 return <canvas ref={ref} width={18} height={112} className="level-meter" role="img"
  aria-label={`Deck ${id} 來源電平，EQ 與音量之前`} title="來源 RMS / Peak；EQ、推桿與 Crossfader 之前"/>;
}
