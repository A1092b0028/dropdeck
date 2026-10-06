import { AudioPlaybackError } from './DeckEngine.ts';
import type { PlaybackEvent, PlaybackSession, SessionFactory } from './DeckEngine';
import type { AudioSource } from '../types/audio';
import type { DeckId } from '../types/deck';
import { MixerEngine } from './MixerEngine.ts';
import { DeckDsp } from './DeckDsp.ts';
import type { DspState } from './DeckDsp';
import {smoothGain,cancelGain} from './gain.ts';

/** Owns one lazily created context; future decks can share this runtime. */
export class WebAudioRuntime {
  private context: AudioContext | null = null;
  private disposed = false;
  private disposal:Promise<void>|null=null;
  private mixer: MixerEngine | null = null;
  private sessions = new Set<WebAudioSession>();
  private readonly contextFactory: () => AudioContext;
  private readonly mediaFactory: () => HTMLAudioElement;
  private readonly loadTimeoutMs: number;
  constructor(contextFactory = () => new AudioContext(), mediaFactory = () => new Audio(), loadTimeoutMs = 20_000) {
    this.contextFactory = contextFactory; this.mediaFactory = mediaFactory; this.loadTimeoutMs = loadTimeoutMs;
  }
  createSession: SessionFactory = onEvent => {
    const context = this.getContext();
    return this.session(context,context.destination,onEvent);
  };
  private getContext(): AudioContext {
    if (this.disposed) throw new AudioPlaybackError('loadFailed', '音訊引擎已關閉。');
    return this.context ??= this.contextFactory();
  }
  getMixer(): MixerEngine {
    const context = this.getContext();
    return this.mixer ??= new MixerEngine(context);
  }
  readDeckWaveform(deck:DeckId):Float32Array|null {
    for(const session of this.sessions)if(session.deckId===deck)return session.readWaveform();
    return null;
  }
  createDeckSession = (deck: DeckId, onEvent: (event: PlaybackEvent)=>void): PlaybackSession => {
    const mixer = this.getMixer();
    return this.session(this.getContext(),mixer.getInput(deck),onEvent,true,deck);
  };
  private session(context: AudioContext, output: AudioNode, onEvent: (event: PlaybackEvent)=>void, withDsp=false,deck?:DeckId): PlaybackSession {
    const session = new WebAudioSession(context,this.mediaFactory(),onEvent,this.loadTimeoutMs,output,
      () => { this.sessions.delete(session); },withDsp,deck);
    this.sessions.add(session); return session;
  }
  dispose(): Promise<void> {return this.disposal??=this.close();}
  private async close():Promise<void> {
    this.disposed = true;
    for (const session of this.sessions) session.dispose();
    this.sessions.clear(); this.mixer?.dispose(); this.mixer = null;
    const context = this.context; this.context = null;
    if (context) await context.close();
  }
}

class WebAudioSession implements PlaybackSession {
  private readonly context: AudioContext;
  private readonly media: HTMLAudioElement;
  private readonly source: MediaElementAudioSourceNode;
  private readonly gain: GainNode;
  private readonly dsp: DeckDsp | null;
  readonly deckId:DeckId|undefined;
  private readonly analyser:AnalyserNode|null;
  private readonly samples:Float32Array<ArrayBuffer>;
  private readonly onEvent: (event: PlaybackEvent) => void;
  private readonly loadTimeoutMs: number;
  private disposed = false;
  private ready = false;
  private playIntent=0;
  private wantsPlay=false;
  private cancelLoad: ((error: AudioPlaybackError) => void) | null = null;
  private removers: Array<() => void> = [];
  private readonly onDispose: () => void;

  constructor(context: AudioContext, media: HTMLAudioElement, onEvent: (event: PlaybackEvent) => void, loadTimeoutMs: number,
    output: AudioNode, onDispose: ()=>void, withDsp:boolean,deck?:DeckId) {
    this.context = context; this.media = media; this.onEvent = onEvent; this.loadTimeoutMs = loadTimeoutMs;
    this.onDispose = onDispose;
    const nodes:AudioNode[]=[];let dsp:DeckDsp|null=null;
    try {
    media.crossOrigin = 'anonymous'; media.preload = 'auto'; media.volume = 1;
    this.source = context.createMediaElementSource(media);nodes.push(this.source);
    this.gain = context.createGain();nodes.push(this.gain);
    this.dsp=dsp=withDsp ? new DeckDsp(context,this.gain) : null;
    this.source.connect(this.dsp?.input ?? this.gain); this.gain.connect(output);
    this.deckId=deck;
    this.analyser=deck ? context.createAnalyser() : null;
    if(this.analyser)nodes.push(this.analyser);
    if(this.analyser){this.analyser.fftSize=2048;this.source.connect(this.analyser);}
    this.samples=new Float32Array(this.analyser?.fftSize??0);
    for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'progress', 'seeked']) {
      this.listen(event, () => this.position());
    }
    this.listen('ended', () => this.onEvent({ type: 'ended' }));
    this.listen('error', () => {
      const error = this.mediaError();
      if (this.cancelLoad) this.cancelLoad(error);
      else if (this.ready) this.onEvent({ type: 'error', error });
    });
    }catch(error){
      for(const remove of this.removers)remove();dsp?.dispose();for(const node of nodes)node.disconnect();
      media.pause();media.removeAttribute('src');media.load();throw error;
    }
  }
  private listen(event: string, handler: () => void) {
    this.media.addEventListener(event, handler);
    this.removers.push(() => this.media.removeEventListener(event, handler));
  }
  private mediaError(): AudioPlaybackError {
    if (this.media.error?.code === 4) return new AudioPlaybackError('unsupportedSource', '來源格式不支援或無法載入；請重新載入曲目，並確認來源允許 CORS。');
    if (this.media.error?.code === 3) return new AudioPlaybackError('unsupportedSource', '無法解碼此音訊來源。');
    return new AudioPlaybackError('loadFailed', '音訊載入失敗；網址可能失效、網路中斷或 CORS 被拒絕，請重新載入曲目。');
  }
  private position() {
    if(this.disposed)return;
    const seekable: Array<[number, number]> = [];
    for (let i = 0; i < this.media.seekable.length; i++) seekable.push([this.media.seekable.start(i), this.media.seekable.end(i)]);
    this.onEvent({ type: 'position', currentTime: this.media.currentTime,
      duration: Number.isFinite(this.media.duration) ? this.media.duration : null, seekable });
  }
  load(source: AudioSource, signal: AbortSignal): Promise<void> {
    if (this.disposed || signal.aborted) return Promise.reject(new AudioPlaybackError('loadFailed', '音訊載入已取消。'));
    if (!this.media.canPlayType(source.mimeType)) return Promise.reject(new AudioPlaybackError('unsupportedSource', '此系統不支援音訊來源的格式。'));
    return new Promise((resolve, reject) => {
      let settled=false;
      const finish = (error?: AudioPlaybackError) => {
        if(settled)return;settled=true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.media.removeEventListener('canplay', playable);
        this.cancelLoad = null;
        if (error) reject(error);
        else { this.ready = true; this.position(); resolve(); }
      };
      const playable = () => finish();
      const abort = () => finish(new AudioPlaybackError('loadFailed', '音訊載入已取消。'));
      const timer = setTimeout(() => finish(new AudioPlaybackError('loadFailed', '音訊載入逾時；請檢查網路與來源 CORS 後重新載入曲目。')), this.loadTimeoutMs);
      this.cancelLoad = error => finish(error);
      signal.addEventListener('abort', abort, { once: true });
      this.media.addEventListener('canplay', playable, { once: true });
      try { this.media.src = source.url; this.media.load(); }
      catch { finish(new AudioPlaybackError('loadFailed', '無法載入音訊來源。')); }
    });
  }
  async play(): Promise<void> {
    if (this.disposed) throw new AudioPlaybackError('playFailed', '音訊已卸載。');
    const intent=++this.playIntent;this.wantsPlay=true;
    try {
      // Both operations begin within the caller's user gesture.
      const resumed=this.context.resume();
      const playing=this.media.play().then(()=>{if(this.disposed||!this.wantsPlay)this.media.pause();});
      await Promise.all([resumed,playing]);
    } catch (error) {
      if(intent===this.playIntent){this.wantsPlay=false;this.media.pause();}
      const unsupported = error instanceof DOMException && error.name === 'NotSupportedError';
      throw new AudioPlaybackError(unsupported ? 'unsupportedSource' : 'playFailed',
        unsupported ? '此系統無法播放來源格式，請重新載入曲目。' : '無法開始播放，請再次按 Play；若仍失敗請重新載入曲目。');
    }
  }
  pause(): void { this.playIntent++;this.wantsPlay=false;this.media.pause(); }
  getCurrentTime():number {return this.media.currentTime;}
  isSeeking():boolean {return Boolean(this.media.seeking);}
  setPlaybackRate(rate:number):void {
    if(this.disposed)return;
    this.media.defaultPlaybackRate=rate;this.media.playbackRate=rate;
  }
  setKeyLock(enabled:boolean):boolean {
    if(this.disposed||typeof this.media.preservesPitch!=='boolean')return false;
    try {this.media.preservesPitch=enabled;return this.media.preservesPitch===enabled;}catch{return false;}
  }
  seek(seconds: number): void { this.media.currentTime = seconds; }
  setVolume(volume: number): void { if(!this.disposed)smoothGain(this.gain.gain,volume,this.context.currentTime,!this.ready); }
  setDsp(state:DspState): void { if (!this.disposed) this.dsp?.apply(state,!this.ready); }
  readWaveform():Float32Array|null {
    if(this.disposed||!this.ready||this.media.paused||this.media.seeking||!this.analyser)return null;
    this.analyser.getFloatTimeDomainData(this.samples);return this.samples;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.playIntent++;this.wantsPlay=false;
    this.cancelLoad?.(new AudioPlaybackError('loadFailed', '音訊載入已取消。'));
    for (const remove of this.removers) remove(); this.removers = [];
    this.media.pause(); this.media.removeAttribute('src'); this.media.load();
    cancelGain(this.gain.gain,this.context.currentTime);
    this.source.disconnect(); this.analyser?.disconnect(); this.dsp?.dispose(); this.gain.disconnect();
    this.onDispose();
  }
}
