import type {Track} from '../types/track';

export function timeToPosition(time:number,duration:number):number {
  if(!Number.isFinite(time)||!Number.isFinite(duration)||duration<=0) throw new RangeError('Invalid waveform time');
  return Math.max(0,Math.min(1,time/duration));
}
export function positionToTime(position:number,duration:number):number {
  if(!Number.isFinite(position)||!Number.isFinite(duration)||duration<=0) throw new RangeError('Invalid waveform position');
  return Math.max(0,Math.min(1,position))*duration;
}
export function seekWaveform(deck:{seek:(seconds:number)=>void},position:number,duration:number):void {
  deck.seek(positionToTime(position,duration));
}
export interface WaveformData {
  readonly kind:'observed';
  readonly trackKey:string|null;
  readonly peaks:ReadonlyArray<number|null>;
}
/** Bounded, observed raw-source peaks. Null means unobserved, never silence. */
export class WaveformService {
  private data:WaveformData={kind:'observed',trackKey:null,peaks:Array(320).fill(null)};
  private disposed=false;
  private duration:number|null=null;
  reset(track:Track|null):void {
    if(this.disposed)return;
    this.duration=null;
    this.data={kind:'observed',trackKey:track?`${track.provider}:${track.id}`:null,peaks:Array(320).fill(null)};
  }
  getData():WaveformData{return this.data;}
  observe(time:number,duration:number,samples:Float32Array):void {
    if(this.disposed||!this.data.trackKey||!Number.isFinite(time)||time<0||!Number.isFinite(duration)||duration<=0||time>duration||!samples.length)return;
    if(!samples.every(Number.isFinite))return;
    if(this.duration!==null&&this.duration!==duration)this.data={...this.data,peaks:Array(320).fill(null)};
    this.duration=duration;
    const index=Math.min(319,Math.floor(timeToPosition(time,duration)*320));
    let peak=0;for(const sample of samples)peak=Math.max(peak,Math.min(1,Math.abs(sample)));
    const peaks=[...this.data.peaks];peaks[index]=Math.max(peaks[index]??0,peak);
    this.data={...this.data,peaks};
  }
  dispose():void {this.data={kind:'observed',trackKey:null,peaks:Array(320).fill(null)};this.disposed=true;}
}
