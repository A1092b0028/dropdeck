import { isAudioSource } from '../types/audio.ts';
import type { AudioSource } from '../types/audio';
import type { Track } from '../types/track';
import { defaultDspState, normalizedControl } from './DeckDsp.ts';
import type { DspState } from './DeckDsp';
import {tempoRate,TEMPO_MIN_PERCENT,TEMPO_MAX_PERCENT} from './tempo.ts';
import {isTrackAnalysis} from '../services/analysis.ts';
import type {TrackAnalysis} from '../services/analysis';
import {snapBeat} from './performance-timing.ts';

export type AudioErrorCode = 'resolutionFailed' | 'expiredSource' | 'loadFailed' | 'unsupportedSource' | 'playFailed';
export class AudioPlaybackError extends Error {
  readonly code: AudioErrorCode;
  constructor(code: AudioErrorCode, message: string) {
    super(message); this.name = 'AudioPlaybackError'; this.code = code;
  }
}
export type PlaybackEvent =
  | { type: 'position'; currentTime: number; duration: number | null; seekable: Array<[number, number]> }
  | { type: 'ended' }
  | { type: 'error'; error: AudioPlaybackError };
export interface PlaybackSession {
  load(source: AudioSource, signal: AbortSignal): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setDsp?(state: DspState): void;
  getCurrentTime?():number;
  setPlaybackRate?(rate:number):void;
  setKeyLock?(enabled:boolean):boolean;
  isSeeking?():boolean;
  dispose(): void;
}
export type SessionFactory = (onEvent: (event: PlaybackEvent) => void) => PlaybackSession;
export interface DeckSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';
  readonly track: Track | null;
  readonly currentTime: number;
  readonly duration: number | null;
  readonly volume: number;
  readonly dsp: DspState;
  readonly cue: number | null;
  readonly hotCues: ReadonlyArray<number | null>;
  readonly tempoPercent:number;
  readonly analysis:TrackAnalysis|null;
  readonly quantize:boolean;
  readonly keyLock:boolean;
  readonly keyLockAvailable:boolean|null;
  readonly canSeek: boolean;
  readonly starting: boolean;
  readonly error: { code: AudioErrorCode; message: string } | null;
}
export const emptyDeckSnapshot: DeckSnapshot = {
  status: 'idle', track: null, currentTime: 0, duration: null, volume: 0.75, dsp:defaultDspState, cue:null, hotCues:Object.freeze([null,null,null,null]), tempoPercent:0,analysis:null,quantize:false,keyLock:false,keyLockAvailable:null,canSeek: false, starting: false, error: null,
};

function playbackError(error: unknown, fallback: AudioErrorCode): AudioPlaybackError {
  if (error instanceof AudioPlaybackError) return error;
  if (error instanceof Error) {
    const code = 'code' in error && error.code === 'unsupportedSource' ? 'unsupportedSource' : fallback;
    return new AudioPlaybackError(code, error.message);
  }
  return new AudioPlaybackError(fallback, '音訊操作失敗，請重新載入曲目。');
}

/** One instance per deck. All media and state changes live outside React. */
export class DeckEngine {
  private snapshot: DeckSnapshot = { ...emptyDeckSnapshot, dsp:Object.freeze({...defaultDspState}) };
  private listeners = new Set<() => void>();
  private session: PlaybackSession | null = null;
  private abort: AbortController | null = null;
  private generation = 0;
  private playIntent = 0;
  private pendingPlay = false;
  private disposed = false;
  private tempoRevision=0;
  private navigationRevision=0;
  private performanceActive=false;
  isPerformanceActive=():boolean=>this.performanceActive;
  setPerformanceActive(active:boolean):void {this.performanceActive=active;}
  setQuantize(enabled:boolean):void {if(!this.disposed)this.update({quantize:enabled});}
  private markTime():number {const s=this.snapshot,t=this.getCurrentTime();return s.quantize&&s.analysis&&s.duration?(snapBeat(t,s.analysis,s.duration)??t):t;}
  private ranges: Array<[number, number]> = [];
  private source: AudioSource | null = null;
  private readonly resolveSource: (track: Track) => Promise<AudioSource>;
  private readonly createSession: SessionFactory;
  private readonly analyze:(track:Track)=>TrackAnalysis|null;

  constructor(resolveSource: (track: Track) => Promise<AudioSource>, createSession: SessionFactory,analyze:(track:Track)=>TrackAnalysis|null=()=>null) {
    this.resolveSource = resolveSource; this.createSession = createSession;
    this.analyze=analyze;
  }
  getSnapshot = (): DeckSnapshot => this.snapshot;
  getTempoRevision=():number=>this.tempoRevision;
  getNavigationRevision=():number=>this.navigationRevision;
  isSeeking=():boolean=>this.session?.isSeeking?.()??false;
  isRangeSeekable(start:number,end:number):boolean {
    return !this.disposed&&this.snapshot.canSeek&&Number.isFinite(start)&&Number.isFinite(end)&&end>start&&this.ranges.some(([from,to])=>start>=from&&end<=to);
  }
  getCurrentTime = ():number => {
    const time=this.session?.getCurrentTime?.();
    return time!==undefined&&Number.isFinite(time)?time:this.snapshot.currentTime;
  };
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private update(change: Partial<DeckSnapshot>,force=false) {
    if(!force&&Object.entries(change).every(([key,value])=>this.snapshot[key as keyof DeckSnapshot]===value))return;
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
  private release() {
    this.generation++; this.playIntent++; this.pendingPlay = false;
    this.abort?.abort(); this.abort = null;
    const old = this.session; this.session = null;
    old?.dispose(); this.ranges = []; this.source = null;
  }
  private fail(error: AudioPlaybackError) {
    this.release();
    this.update({ status: 'error', canSeek: false, starting: false, error: { code: error.code, message: error.message } });
  }
  private isExpired(source: AudioSource): boolean {
    return source.expiresAt !== null && source.expiresAt <= Date.now() / 1000;
  }
  async load(track: Track): Promise<void> {
    if (this.disposed) return;
    this.release();
    const generation = this.generation;
    const abort = new AbortController(); this.abort = abort;
    let analysis:TrackAnalysis|null=null;
    try {const result=this.analyze(track);if(isTrackAnalysis(result))analysis=Object.freeze({...result});}catch { /* Timing failure must not block audio loading. */ }
    this.update({ status: 'loading', track: { ...track }, currentTime: 0, duration: null, cue:null, hotCues:Object.freeze([null,null,null,null]), analysis,canSeek: false, starting: false, error: null });
    let stage: AudioErrorCode = 'resolutionFailed';
    try {
      const source = await this.resolveSource(track);
      if (generation !== this.generation) return;
      if (!isAudioSource(source)) throw new AudioPlaybackError('unsupportedSource', '音訊來源無效，請重新載入曲目。');
      if (this.isExpired(source)) throw new AudioPlaybackError('expiredSource', '音訊網址已過期，請重新載入曲目。');
      this.source = source; stage = 'loadFailed';
      const session = this.createSession(event => {
        if (generation !== this.generation) return;
        if (event.type === 'error') this.fail(event.error);
        else if (event.type === 'ended') {
          this.playIntent++; this.pendingPlay = false;
          this.update({ status: 'ended', starting: false });
        } else {
          const duration = event.duration !== null && Number.isFinite(event.duration) && event.duration >= 0 ? event.duration : null;
          this.ranges = event.seekable.filter(([start,end])=>Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start)
            .map(([start,end]):[number,number]=>[start,duration===null?end:Math.min(end,duration)])
            .filter(([start,end])=>end>start);
          this.update({ currentTime: Number.isFinite(event.currentTime) ? Math.max(0, event.currentTime) : 0,
            duration, canSeek: duration !== null && duration > 0 && this.ranges.length > 0 });
        }
      });
      this.session = session;
      session.setVolume(this.snapshot.volume);
      session.setDsp?.(this.snapshot.dsp);
      const keyLockAvailable=session.setKeyLock?.(this.snapshot.keyLock)??false;
      this.update({keyLockAvailable,...(!keyLockAvailable?{keyLock:false}:{})});
      session.setPlaybackRate?.(tempoRate(this.snapshot.tempoPercent));
      await session.load(source, abort.signal);
      if (generation === this.generation) this.update({ status: 'ready' });
    } catch (error) {
      if (generation === this.generation) this.fail(playbackError(error, stage));
    }
  }
  async play(): Promise<void> {
    const session = this.session;
    if (this.disposed || !session || this.pendingPlay || !['ready', 'paused', 'ended'].includes(this.snapshot.status)) return;
    if (this.source && this.isExpired(this.source)) {
      this.fail(new AudioPlaybackError('expiredSource', '音訊網址已過期，請重新載入曲目。')); return;
    }
    const previous = this.snapshot.status;
    const generation = this.generation;
    const intent = ++this.playIntent; this.pendingPlay = true;
    this.update({ starting: true, error: null });
    try {
      if (previous === 'ended') this.seek(0);
      // Called before any await: preserves the user gesture for AudioContext.resume/media.play.
      await session.play();
      if (generation === this.generation && intent === this.playIntent) this.update({ status: 'playing', starting: false, error: null });
    } catch (error) {
      if (generation === this.generation && intent === this.playIntent) {
        session.pause();
        const failure = playbackError(error, 'playFailed');
        if (failure.code === 'unsupportedSource') this.fail(failure);
        else this.update({ status: previous, starting: false, error: { code: failure.code, message: failure.message } });
      }
    } finally {
      if (generation === this.generation && intent === this.playIntent) this.pendingPlay = false;
    }
  }
  pause(): void {
    if (!this.session || this.disposed || this.snapshot.status === 'loading') return;
    this.playIntent++; this.pendingPlay = false; this.session.pause();
    this.update({ status: 'paused', starting: false });
  }
  seek(seconds: number,origin:'user'|'sync'='user'): void {
    if (!Number.isFinite(seconds)) throw new RangeError('Seek position must be finite');
    if (this.disposed || !this.session || !this.snapshot.canSeek || this.snapshot.status === 'loading') return;
    const target = Math.min(Math.max(0, seconds), this.snapshot.duration!);
    const candidates = this.ranges.map(([start, end]) => Math.max(start, Math.min(end, target)));
    const position = candidates.reduce((best, value) => Math.abs(value - target) < Math.abs(best - target) ? value : best);
    try {
      this.session.seek(position);
      if(origin==='user')this.navigationRevision++;
      this.update({ currentTime: position, ...(this.snapshot.status === 'ended' ? { status: 'paused' as const } : {}) },origin==='user');
    }
    catch (error) { this.fail(playbackError(error, 'loadFailed')); }
  }
  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) throw new RangeError('Volume must be finite');
    if (this.disposed) return;
    const normalized = Math.max(0, Math.min(1, volume));
    this.session?.setVolume(normalized); this.update({ volume: normalized });
  }
  private canMark(time:number):boolean {
    const s=this.snapshot;
    return !this.disposed && s.canSeek && ['ready','playing','paused','ended'].includes(s.status)
      && s.duration!==null && Number.isFinite(time) && time>=0 && time<=s.duration;
  }
  setTempo(percent:number,origin:'user'|'sync'='user'):void {
    const rate=tempoRate(percent);if(this.disposed)return;
    const tempoPercent=Math.max(TEMPO_MIN_PERCENT,Math.min(TEMPO_MAX_PERCENT,percent));
    try {this.session?.setPlaybackRate?.(rate);if(origin==='user')this.tempoRevision++;this.update({tempoPercent},origin==='user');}
    catch(error){this.fail(playbackError(error,'playFailed'));}
  }
  setKeyLock(enabled:boolean):boolean {
    if(this.disposed)return false;
    if(!this.session){this.update({keyLock:enabled,keyLockAvailable:null});return false;}
    const available=this.session?.setKeyLock?.(enabled)??false;
    this.update({keyLock:available&&enabled,keyLockAvailable:available});return available;
  }
  setBeatOrigin():boolean {
    const time=this.getCurrentTime(),analysis=this.snapshot.analysis;
    if(!analysis||!this.canMark(time))return false;
    this.update({analysis:Object.freeze({...analysis,firstBeatTime:time,origin:'manual'})});return true;
  }
  private cueIndex(index:number):void {
    if(!Number.isInteger(index)||index<0||index>3)throw new RangeError('Hot cue index must be 0..3');
  }
  setCue():boolean {const time=this.markTime();if(!this.canMark(time))return false;this.update({cue:time});return true;}
  jumpCue():void {if(this.snapshot.cue!==null)this.seek(this.snapshot.cue);}
  clearCue():void {if(!this.disposed)this.update({cue:null});}
  restoreNavigation(saved:{cue:number|null;hotCues:ReadonlyArray<number|null>;analysis:TrackAnalysis|null}):void {
    if(this.disposed||!this.snapshot.canSeek||this.snapshot.duration===null)return;
    const valid=(time:number|null)=>time!==null&&this.canMark(time)?time:null;
    const cached=saved.analysis,current=this.snapshot.analysis;
    const analysis=isTrackAnalysis(cached)&&cached.firstBeatTime<=this.snapshot.duration&&(!current||current.bpm===cached.bpm)?Object.freeze({...cached}):current;
    this.update({cue:valid(saved.cue),hotCues:Object.freeze(Array.from({length:4},(_,i)=>valid(saved.hotCues[i]??null))),analysis});
  }
  setHotCue(index:number):boolean {
    this.cueIndex(index);const time=this.markTime();if(!this.canMark(time))return false;
    const hotCues=[...this.snapshot.hotCues];hotCues[index]=time;
    this.update({hotCues:Object.freeze(hotCues)});return true;
  }
  jumpHotCue(index:number):void {this.cueIndex(index);const time=this.snapshot.hotCues[index];if(time!==null)this.seek(time);}
  clearHotCue(index:number):void {
    this.cueIndex(index);if(this.disposed)return;
    const hotCues=[...this.snapshot.hotCues];hotCues[index]=null;this.update({hotCues:Object.freeze(hotCues)});
  }
  private setDspControl(control:keyof DspState,value:number): void {
    const normalized=normalizedControl(value);
    if (this.disposed) return;
    const dsp=Object.freeze({...this.snapshot.dsp,[control]:normalized});
    this.session?.setDsp?.(dsp); this.update({dsp});
  }
  setLow(value:number): void { this.setDspControl('low',value); }
  setMid(value:number): void { this.setDspControl('mid',value); }
  setHigh(value:number): void { this.setDspControl('high',value); }
  setFilter(value:number): void { this.setDspControl('filter',value); }
  resetDsp(): void {
    if (this.disposed) return;
    const dsp=Object.freeze({...defaultDspState});
    this.session?.setDsp?.(dsp); this.update({dsp});
  }
  unload(): void {
    if (this.disposed) return;
    this.release(); this.update({ ...emptyDeckSnapshot, volume: this.snapshot.volume, dsp:this.snapshot.dsp,tempoPercent:this.snapshot.tempoPercent,quantize:this.snapshot.quantize,keyLock:this.snapshot.keyLock });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.release();
    this.update({...emptyDeckSnapshot,volume:this.snapshot.volume,dsp:this.snapshot.dsp,tempoPercent:this.snapshot.tempoPercent});
    this.listeners.clear();
  }
}
