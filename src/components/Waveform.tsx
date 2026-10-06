import {useEffect,useRef} from 'react';
import type {DeckEngine,DeckSnapshot} from '../audio/DeckEngine';
import {WaveformService,seekWaveform,timeToPosition} from '../services/waveform';
import {beatGrid,beatPosition} from '../audio/beat-grid';
import {startWaveformLoop} from '../services/waveform-loop';
import type {TrackAnalysis} from '../services/analysis';
import type {PerformanceEngine} from '../audio/PerformanceEngine';

interface Props {engine?:DeckEngine|null;snapshot?:DeckSnapshot;readSamples?:()=>Float32Array|null;id:string;performance?:PerformanceEngine|null;}
/** Canvas sampling/redraw is bounded to 20 Hz; React never receives audio-rate samples. */
export function Waveform({engine,snapshot,readSamples,id,performance}:Props){
  const canvas=useRef<HTMLCanvasElement>(null);
  const reader=useRef(readSamples);reader.current=readSamples;
  const dragging=useRef(false);
  const beatOutput=useRef<HTMLOutputElement>(null);
  useEffect(()=>{
    const node=canvas.current;if(!node||!engine)return;
    const service=new WaveformService();service.reset(snapshot?.track??null);
    const writeBeat=(text:string)=>{if(beatOutput.current&&beatOutput.current.textContent!==text)beatOutput.current.textContent=text;};
    let live:Float32Array|null=null,gridAnalysis:TrackAnalysis|null=null,gridDuration=-1,beats:number[]=[];
    const stop=startWaveformLoop(()=>{
      const ctx=node.getContext('2d');if(!ctx)return;
      const state=engine.getSnapshot(),duration=state.duration;
      const currentTime=engine.getCurrentTime();
      if(!duration)writeBeat('拍位置 —');
      const samples=state.status==='playing'?reader.current?.():null;
      if(samples&&duration){service.observe(currentTime,duration,samples);
        if(!live||live.length!==samples.length)live=new Float32Array(samples.length);live.set(samples);}
      const width=node.width,height=node.height;ctx.clearRect(0,0,width,height);
      ctx.fillStyle='#10161c';ctx.fillRect(0,0,width,height);
      ctx.fillStyle='#8393a4';ctx.font='11px sans-serif';
      ctx.fillText('LIVE SOURCE',10,16);
      ctx.fillText('TRACK / OBSERVED',10,92);
      ctx.strokeStyle=id==='A'?'#53c9e8':'#f4b45e';ctx.lineWidth=1;
      if(live){ctx.beginPath();for(let i=0;i<live.length;i++){const x=i/(live.length-1)*width,y=49-live[i]*23;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}
      const peaks=service.getData().peaks;
      for(let i=0;i<peaks.length;i++){const p=peaks[i];if(p===null)continue;ctx.beginPath();ctx.moveTo((i+.5)/peaks.length*width,128-p*25);ctx.lineTo((i+.5)/peaks.length*width,128+p*25);ctx.stroke();}
      if(duration&&duration>0){
        const region=performance?.getSnapshot().loop;
        if(region){const left=timeToPosition(region.start,duration)*width,right=timeToPosition(region.end,duration)*width;ctx.fillStyle='#69e6ae33';ctx.fillRect(left,100,right-left,57);ctx.fillStyle='#69e6ae';ctx.fillRect(left,100,2,57);ctx.fillRect(right,100,2,57);}
        if(state.analysis){
          if(state.analysis!==gridAnalysis||duration!==gridDuration){gridAnalysis=state.analysis;gridDuration=duration;beats=beatGrid(state.analysis,duration,Math.floor(width/4));}
          ctx.strokeStyle='#7880a4';
          for(const beat of beats){
            const x=timeToPosition(beat,duration)*width;ctx.beginPath();ctx.moveTo(x,103);ctx.lineTo(x,154);ctx.stroke();
          }
          const beat=beatPosition(state.analysis,currentTime);
          writeBeat(beat===null?'拍點起始之前':`拍位置 ${(beat+1).toFixed(2)}（${state.analysis.origin==='assumed'?'暫定起點':'手動起點'}）`);
        }else writeBeat('拍位置 —');
        for(const mark of [state.cue,...state.hotCues]){if(mark===null)continue;ctx.fillStyle='#ffd166';ctx.fillRect(timeToPosition(mark,duration)*width-1,102,2,52);}
        ctx.fillStyle='#fff';ctx.fillRect(timeToPosition(currentTime,duration)*width-1,24,2,133);
      }
    });
    return()=>{stop();service.dispose();dragging.current=false;};
  },[engine,snapshot?.track,id,performance]);
  const seek=(clientX:number)=>{
    const node=canvas.current,state=engine?.getSnapshot();
    if(!node||!engine||!state?.canSeek||!state.duration)return;
    const rect=node.getBoundingClientRect();if(rect.width<=0)return;
    seekWaveform(engine,(clientX-rect.left)/rect.width,state.duration);
  };
  return <div className="waveform-area">
    <canvas ref={canvas} width={640} height={160} className="waveform" role="slider"
      aria-label={`Deck ${id} 波形定位（已觀察區段）`} aria-valuemin={0} aria-valuemax={snapshot?.duration??0}
      aria-valuenow={snapshot?.currentTime??0} aria-disabled={!snapshot?.canSeek} tabIndex={snapshot?.canSeek?0:-1}
      onPointerDown={event=>{if(!snapshot?.canSeek)return;dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);seek(event.clientX);}}
      onPointerMove={event=>{if(dragging.current)seek(event.clientX);}}
      onPointerUp={event=>{if(dragging.current)seek(event.clientX);dragging.current=false;}}
      onPointerCancel={()=>{dragging.current=false;}} onLostPointerCapture={()=>{dragging.current=false;}}
      onKeyDown={event=>{if(!engine||!snapshot?.canSeek)return;const state=engine.getSnapshot();
        if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();engine.seek(engine.getCurrentTime()+(event.key==='ArrowLeft'?-5:5));}
        else if(event.key==='Home'||event.key==='End'){event.preventDefault();engine.seek(event.key==='Home'?0:state.duration??0);}}}/>
    <p className="dsp-hint">已觀察區段 · 空白＝未知 · 拖曳定位 / 方向鍵 ±5s</p>
    <output ref={beatOutput} className="dsp-hint" aria-live="off" aria-label={`Deck ${id} 目前拍位置`}>拍位置 —</output>
    <p className="dsp-hint waveform-note">灰線為 BPM 推算拍點；密集時略取拍線，不代表小節或強拍。</p>
  </div>;
}
