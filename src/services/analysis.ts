import type {Track} from '../types/track';

export interface TrackAnalysis {
  readonly bpm:number;
  readonly confidence:number|null;
  readonly firstBeatTime:number;
  readonly beatInterval:number;
  readonly kind:'provider'|'providerEstimated';
  readonly origin:'assumed'|'manual';
}
export function normalizeBpm(value:unknown):number|null {
  return typeof value==='number'&&Number.isFinite(value)&&value>=20&&value<=400?value:null;
}
export function isTrackAnalysis(value:unknown):value is TrackAnalysis {
  if(!value||typeof value!=='object')return false;
  const a=value as TrackAnalysis;
  return normalizeBpm(a.bpm)!==null&&Number.isFinite(a.firstBeatTime)&&a.firstBeatTime>=0
    &&Number.isFinite(a.beatInterval)&&Math.abs(a.beatInterval-60/a.bpm)<1e-9
    &&(a.confidence===null||(Number.isFinite(a.confidence)&&a.confidence>=0&&a.confidence<=1))
    &&['provider','providerEstimated'].includes(a.kind)&&['assumed','manual'].includes(a.origin);
}
/** Metadata interpretation only. No full-track download or local BPM detector. */
export function analyzeTrack(track:Track):TrackAnalysis|null {
  const bpm=normalizeBpm(track.timing?.bpm),kind=track.timing?.kind;
  if(bpm===null||(kind!=='provider'&&kind!=='providerEstimated'))return null;
  return Object.freeze({bpm,kind,confidence:null,firstBeatTime:0,beatInterval:60/bpm,origin:'assumed'});
}
