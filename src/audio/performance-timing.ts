import {isTrackAnalysis} from '../services/analysis.ts';
import type {TrackAnalysis} from '../services/analysis';
export const LOOP_SIZES=Object.freeze([.5,1,2,4,8,16]);
export interface LoopRegion {readonly start:number;readonly end:number;readonly beats:number;}
function valid(time:number,a:TrackAnalysis,duration:number):boolean{return Number.isFinite(time)&&isTrackAnalysis(a)&&Number.isFinite(duration)&&duration>0;}
export function snapBeat(time:number,a:TrackAnalysis,duration:number):number|null {
 if(!valid(time,a,duration))return null;
 return Math.max(0,Math.min(duration,a.firstBeatTime+Math.max(0,Math.round((time-a.firstBeatTime)/a.beatInterval))*a.beatInterval));
}
export function loopRegion(time:number,beats:number,a:TrackAnalysis,duration:number):LoopRegion|null {
 if(!valid(time,a,duration)||!LOOP_SIZES.includes(beats))return null;
 const start=a.firstBeatTime+Math.max(0,Math.floor((time-a.firstBeatTime)/a.beatInterval))*a.beatInterval;
 const end=start+beats*a.beatInterval;
 return end<=duration?Object.freeze({start,end,beats}):null;
}
export function jumpBeats(time:number,beats:number,a:TrackAnalysis,duration:number,quantize:boolean):number|null {
 if(!valid(time,a,duration)||!Number.isFinite(beats))return null;
 const target=time+beats*a.beatInterval;
 return quantize?snapBeat(target,a,duration):Math.max(0,Math.min(duration,target));
}
export function slipPosition(time:number,elapsed:number,rate:number,duration:number):number {
 if(![time,elapsed,rate,duration].every(Number.isFinite)||elapsed<0||rate<=0||duration<=0)throw new RangeError('Invalid slip timeline');
 return Math.max(0,Math.min(duration,time+elapsed*rate));
}
