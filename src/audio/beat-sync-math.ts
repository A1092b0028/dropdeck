import {normalizeBpm,isTrackAnalysis} from '../services/analysis.ts';
import type {TrackAnalysis} from '../services/analysis';
import {TEMPO_MIN_RATE,TEMPO_MAX_RATE,TEMPO_MIN_PERCENT,TEMPO_MAX_PERCENT} from './tempo.ts';

export interface BpmMatch {readonly rate:number;readonly tempoPercent:number;readonly targetBpm:number;readonly factor:number;}
export function matchBpm(masterBpm:number,masterRate:number,followerBpm:number):BpmMatch|null {
  if(normalizeBpm(masterBpm)===null||normalizeBpm(followerBpm)===null||!Number.isFinite(masterRate)||masterRate<TEMPO_MIN_RATE||masterRate>TEMPO_MAX_RATE)return null;
  const targetBpm=masterBpm*masterRate;
  for(const factor of [1,2,.5]){
    const rate=targetBpm/(followerBpm*factor);
    if(rate>=TEMPO_MIN_RATE-1e-12&&rate<=TEMPO_MAX_RATE+1e-12){
      const bounded=Math.max(TEMPO_MIN_RATE,Math.min(TEMPO_MAX_RATE,rate));
      return Object.freeze({rate:bounded,tempoPercent:Math.max(TEMPO_MIN_PERCENT,Math.min(TEMPO_MAX_PERCENT,(bounded-1)*100)),targetBpm,factor});
    }
  }
  return null;
}
export function beatPhase(analysis:TrackAnalysis,time:number,factor=1):number|null {
  if(!isTrackAnalysis(analysis)||!Number.isFinite(time)||time<analysis.firstBeatTime||![1,2,.5].includes(factor))return null;
  const cycles=(time-analysis.firstBeatTime)/(analysis.beatInterval/factor);
  if(!Number.isFinite(cycles))return null;
  return cycles-Math.floor(cycles);
}
/** Nearest in-track occurrence of the desired phase, never a clamped off-grid time. */
export function nearestPhaseTime(analysis:TrackAnalysis,time:number,phase:number,duration:number,factor=1):number|null {
  if(beatPhase(analysis,time,factor)===null||!Number.isFinite(phase)||phase<0||phase>=1||!Number.isFinite(duration)||duration<=0||time>duration)return null;
  const interval=analysis.beatInterval/factor;
  const center=Math.round((time-analysis.firstBeatTime)/interval-phase);
  const candidates=[center,center-1,center+1].filter(index=>index>=0)
    .map(index=>analysis.firstBeatTime+(index+phase)*interval).filter(position=>position<=duration);
  return candidates.length?candidates.reduce((best,p)=>Math.abs(p-time)<Math.abs(best-time)?p:best):null;
}
/** Positive means follower ahead; shortest circular error in real seconds. */
export function phaseErrorSeconds(followerPhase:number,masterPhase:number,beatSeconds:number):number {
  if(![followerPhase,masterPhase,beatSeconds].every(Number.isFinite)||beatSeconds<=0)throw new RangeError('Invalid beat phase');
  const delta=followerPhase-masterPhase;
  return (delta-Math.floor(delta+.5))*beatSeconds;
}
