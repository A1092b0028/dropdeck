export interface FrameScheduler {request:(callback:FrameRequestCallback)=>number;cancel:(id:number)=>void;}
/** One cancellable loop, bounded to 20 Hz. Late callbacks cannot restart it. */
export function startWaveformLoop(draw:FrameRequestCallback,scheduler:FrameScheduler={request:callback=>window.requestAnimationFrame(callback),cancel:id=>window.cancelAnimationFrame(id)}):()=>void {
  let active=true,frame=0,last=-Infinity;
  const tick:FrameRequestCallback=now=>{
    if(!active)return;
    if(now-last>=50){last=now;draw(now);}
    if(active)frame=scheduler.request(tick);
  };
  frame=scheduler.request(tick);
  return()=>{if(!active)return;active=false;scheduler.cancel(frame);};
}
