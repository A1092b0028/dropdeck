import type { DeckId } from '../types/deck';
import {smoothGain,cancelGain} from './gain.ts';

export function equalPowerCrossfade(value: number): {A:number; B:number} {
  if (!Number.isFinite(value)) throw new RangeError('Crossfader must be finite');
  const x = Math.max(-1, Math.min(1, value));
  if (x === -1) return {A:1,B:0};
  if (x === 1) return {A:0,B:1};
  const angle = (x + 1) * Math.PI / 4;
  return {A:Math.cos(angle),B:Math.sin(angle)};
}

export interface MixerSnapshot {
  readonly crossfader:number;
  readonly masterVolume:number;
  readonly gainA:number;
  readonly gainB:number;
}
export const emptyMixerSnapshot: MixerSnapshot = {crossfader:0,masterVolume:0.8,
  gainA:Math.SQRT1_2,gainB:Math.SQRT1_2};

/** Owns only mixer nodes; context lifetime belongs to WebAudioRuntime. */
export class MixerEngine {
  private readonly inputs: Record<DeckId,GainNode>;
  private readonly master: GainNode;
  private snapshot: MixerSnapshot = {...emptyMixerSnapshot};
  private listeners = new Set<()=>void>();
  private disposed = false;
  private readonly context:AudioContext;
  constructor(context: AudioContext) {
    this.context=context;
    const nodes:GainNode[]=[];
    try {
    const a=context.createGain();nodes.push(a);const b=context.createGain();nodes.push(b);this.inputs={A:a,B:b};
    this.master = context.createGain();nodes.push(this.master);
    this.inputs.A.connect(this.master); this.inputs.B.connect(this.master);
    this.master.connect(context.destination);
    this.inputs.A.gain.value = this.snapshot.gainA; this.inputs.B.gain.value = this.snapshot.gainB;
    this.master.gain.value = this.snapshot.masterVolume;
    }catch(error){for(const node of nodes)node.disconnect();throw error;}
  }
  getInput(deck: DeckId): AudioNode { return this.inputs[deck]; }
  getCrossfader(): number { return this.snapshot.crossfader; }
  getMasterVolume(): number { return this.snapshot.masterVolume; }
  getSnapshot = (): MixerSnapshot => this.snapshot;
  subscribe = (listener:()=>void): (()=>void) => {
    this.listeners.add(listener); return ()=>{this.listeners.delete(listener);};
  };
  private update(change: Partial<MixerSnapshot>) {
    this.snapshot = {...this.snapshot,...change};
    for (const listener of this.listeners) listener();
  }
  setCrossfader(value:number): void {
    const gains = equalPowerCrossfade(value);
    if (this.disposed) return;
    const next=Math.max(-1,Math.min(1,value));if(next===this.snapshot.crossfader)return;
    smoothGain(this.inputs.A.gain,gains.A,this.context.currentTime);smoothGain(this.inputs.B.gain,gains.B,this.context.currentTime);
    this.update({crossfader:Math.max(-1,Math.min(1,value)),gainA:gains.A,gainB:gains.B});
  }
  setMasterVolume(value:number): void {
    if (!Number.isFinite(value)) throw new RangeError('Master volume must be finite');
    if (this.disposed) return;
    const volume = Math.max(0,Math.min(1,value));
    if(volume===this.snapshot.masterVolume)return;
    smoothGain(this.master.gain,volume,this.context.currentTime);this.update({masterVolume:volume});
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for(const node of [this.inputs.A,this.inputs.B,this.master])cancelGain(node.gain,this.context.currentTime);
    this.inputs.A.disconnect(); this.inputs.B.disconnect(); this.master.disconnect();
    this.listeners.clear();
  }
}
