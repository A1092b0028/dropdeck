export interface DspState {
  readonly low:number;
  readonly mid:number;
  readonly high:number;
  readonly filter:number;
}
export const defaultDspState: DspState = Object.freeze({low:0,mid:0,high:0,filter:0});
export const DSP_RAMP_SECONDS = 0.03;

export function normalizedControl(value:number): number {
  if (!Number.isFinite(value)) throw new RangeError('DSP control must be finite');
  return Math.max(-1,Math.min(1,value));
}
export function eqGainDb(value:number): number {
  const x=normalizedControl(value);
  return x < 0 ? x*24 : x*6;
}
export function filterCutoffs(value:number,sampleRate:number): {lowpass:number;highpass:number} {
  const x=normalizedControl(value);
  if (!Number.isFinite(sampleRate) || sampleRate<=0) throw new RangeError('Sample rate must be positive');
  const nyquist=sampleRate/2;
  const lowEnd=Math.min(60,nyquist*0.1), highEnd=Math.min(12000,nyquist*0.95);
  return {lowpass:x<0 ? nyquist*Math.pow(lowEnd/nyquist,-x) : nyquist,
    highpass:x>0 ? 20*(Math.pow(1+highEnd/20,x)-1) : 0};
}

/** Session-owned serial DSP stage; never owns the context or downstream gain. */
export class DeckDsp {
  readonly input: BiquadFilterNode;
  private readonly nodes: BiquadFilterNode[];
  private readonly context: AudioContext;
  private readonly parameters: AudioParam[];
  private targets:number[];
  private disposed=false;
  constructor(context:AudioContext,output:AudioNode) {
    this.context=context;
    const types: BiquadFilterType[]=['lowshelf','peaking','highshelf','lowpass','highpass'];
    const nyquist=context.sampleRate/2;
    const frequencies=[250,1000,4000].map(hz=>Math.min(hz,nyquist*0.9));
    frequencies.push(nyquist,0);
    this.nodes=[];
    try {types.forEach((type,index)=>{
      const node=context.createBiquadFilter();this.nodes.push(node);node.type=type;
      node.frequency.value=frequencies[index]; node.gain.value=0;
      // Web Audio LP/HP Q uses dB; peaking Q uses a linear bandwidth factor.
      node.Q.value=index>=3 ? 20*Math.log10(Math.SQRT1_2) : index===1 ? Math.SQRT1_2 : 1;
    });
    this.nodes.forEach((node,index)=>node.connect(this.nodes[index+1] ?? output));
    }catch(error){for(const node of this.nodes)node.disconnect();throw error;}
    this.input=this.nodes[0];
    this.parameters=[...this.nodes.slice(0,3).map(node=>node.gain),this.nodes[3].frequency,this.nodes[4].frequency];
    this.targets=[0,0,0,nyquist,0];
  }
  apply(state:DspState,immediate=false): void {
    if (this.disposed) return;
    const filter=filterCutoffs(state.filter,this.context.sampleRate);
    const values=[eqGainDb(state.low),eqGainDb(state.mid),eqGainDb(state.high),filter.lowpass,filter.highpass];
    const now=this.context.currentTime;
    this.parameters.forEach((param,index)=>{
      if (values[index]===this.targets[index]) return;
      if (immediate) { param.cancelScheduledValues(now); param.value=values[index]; }
      else {
        if (typeof param.cancelAndHoldAtTime==='function') param.cancelAndHoldAtTime(now);
        else { const current=param.value; param.cancelScheduledValues(now); param.setValueAtTime(current,now); }
        param.linearRampToValueAtTime(values[index],now+DSP_RAMP_SECONDS);
      }
    });
    this.targets=values;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed=true;
    for(const node of this.nodes) {
      for(const param of [node.gain,node.frequency,node.Q]) param.cancelScheduledValues(this.context.currentTime);
      node.disconnect();
    }
  }
}
