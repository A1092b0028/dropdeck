export const TEMPO_MIN_PERCENT=-20;
export const TEMPO_MAX_PERCENT=20;
export const TEMPO_MIN_RATE=1+TEMPO_MIN_PERCENT/100;
export const TEMPO_MAX_RATE=1+TEMPO_MAX_PERCENT/100;

export function tempoRate(percent:number):number {
  if(!Number.isFinite(percent))throw new RangeError('Tempo must be finite');
  return 1+Math.max(TEMPO_MIN_PERCENT,Math.min(TEMPO_MAX_PERCENT,percent))/100;
}
function validateTime(time:number,rate:number):void {
  if(!Number.isFinite(time)||time<0||!Number.isFinite(rate)||rate<=0)throw new RangeError('Invalid time mapping');
}
/** Conversion for a constant-rate segment, not lifetime elapsed time after seeks/rate changes. */
export function sourceToElapsed(sourceSeconds:number,rate:number):number {validateTime(sourceSeconds,rate);return sourceSeconds/rate;}
export function elapsedToSource(elapsedSeconds:number,rate:number):number {validateTime(elapsedSeconds,rate);return elapsedSeconds*rate;}
