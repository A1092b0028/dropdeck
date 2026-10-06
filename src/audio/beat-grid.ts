import {isTrackAnalysis} from '../services/analysis.ts';
import type {TrackAnalysis} from '../services/analysis';

/** Zero-based fractional beat position in source seconds; null before the origin. */
export function beatPosition(analysis:TrackAnalysis,time:number):number|null {
  if(!isTrackAnalysis(analysis)||!Number.isFinite(time)||time<analysis.firstBeatTime)return null;
  return (time-analysis.firstBeatTime)/analysis.beatInterval;
}
/** Bounded rendering positions; dense grids retain every Nth original beat. */
export function beatGrid(analysis:TrackAnalysis,duration:number,maxMarkers=2048):number[] {
  if(!isTrackAnalysis(analysis)||!Number.isFinite(duration)||duration<analysis.firstBeatTime
    ||!Number.isInteger(maxMarkers)||maxMarkers<1||maxMarkers>20000)return [];
  const count=Math.floor((duration-analysis.firstBeatTime)/analysis.beatInterval)+1;
  if(!Number.isFinite(count))return [];
  const stride=Math.max(1,Math.ceil(count/maxMarkers));
  return Array.from({length:Math.ceil(count/stride)},(_,i)=>analysis.firstBeatTime+i*stride*analysis.beatInterval);
}
