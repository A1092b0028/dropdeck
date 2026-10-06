export const GAIN_RAMP_SECONDS=.02;
/** Retarget existing gain automation; never reconnect the graph. */
export function smoothGain(param:AudioParam,value:number,now:number,immediate=false):void {
  if(immediate){param.cancelScheduledValues(now);param.value=value;return;}
  if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(now);
  else {const current=param.value;param.cancelScheduledValues(now);param.setValueAtTime(current,now);}
  param.linearRampToValueAtTime(value,now+GAIN_RAMP_SECONDS);
}
export function cancelGain(param:AudioParam,now:number):void {param.cancelScheduledValues(now);}
