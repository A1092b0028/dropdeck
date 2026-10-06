// Test-only Web Audio boundary. Production engines and routing run unchanged.
export class TestNode {
  connections: unknown[] = [];
  disconnects = 0;
  connect(node: unknown) { this.connections.push(node); }
  disconnect() { this.connections = []; this.disconnects++; }
}
export class TestGain extends TestNode { gain = new TestParam(1); }
export class TestAnalyser extends TestNode {
  fftSize=2048;
  getFloatTimeDomainData(samples:Float32Array){samples.fill(.25);}
}
export class TestParam {
  holds: number[] = [];
  ramps: Array<{value:number;time:number}> = [];
  cancellations: number[] = [];
  value:number;
  constructor(value=0) { this.value=value; }
  cancelAndHoldAtTime(time:number) { this.holds.push(time); return this; }
  cancelScheduledValues(time:number) { this.cancellations.push(time); return this; }
  setValueAtTime(value:number,_time:number) { this.value=value; return this; }
  linearRampToValueAtTime(value:number,time:number) { this.value=value; this.ramps.push({value,time}); return this; }
}
export class TestBiquad extends TestNode {
  type: BiquadFilterType='lowpass';
  frequency=new TestParam(350); Q=new TestParam(1); gain=new TestParam();
}
export class TestMedia extends EventTarget {
  readonly listeners=new Map<string,Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type:string,callback:EventListenerOrEventListenerObject|null,options?:AddEventListenerOptions|boolean):void {
    if(callback){const listeners=this.listeners.get(type)??new Set();listeners.add(callback);this.listeners.set(type,listeners);}
    super.addEventListener(type,callback,options);
  }
  override removeEventListener(type:string,callback:EventListenerOrEventListenerObject|null,options?:EventListenerOptions|boolean):void {
    if(callback)this.listeners.get(type)?.delete(callback);super.removeEventListener(type,callback,options);
  }
  listenerCount():number{return [...this.listeners.values()].reduce((sum,listeners)=>sum+listeners.size,0);}
  crossOrigin=''; src=''; preload=''; currentTime=0; duration=120; volume=1; paused=true;
  playbackRate=1;defaultPlaybackRate=1;preservesPitch=true;
  seeking=false;
  error: {code:number} | null = null;
  seekable={length:1,start:()=>0,end:()=>120};
  canPlayType() { return 'probably'; }
  load() { if(this.src) queueMicrotask(()=>this.dispatchEvent(new Event('canplay'))); }
  async play() { this.paused=false; }
  pause() { this.paused=true; }
  removeAttribute(name:string) { if(name==='src') this.src=''; }
}
export function audioBoundary() {
  const gains: TestGain[] = [], biquads:TestBiquad[]=[], sources: Array<{node:TestNode;media:TestMedia}> = [], media:TestMedia[]=[];
  const analysers:TestAnalyser[]=[];
  const destination = new TestNode(); let closes=0, resumes=0, contexts=0;
  const context = {
    destination, currentTime:1, sampleRate:48000,
    createAnalyser(){const node=new TestAnalyser();analysers.push(node);return node;},
    createBiquadFilter() { const node=new TestBiquad(); biquads.push(node); return node; },
    createGain() { const node=new TestGain(); gains.push(node); return node; },
    createMediaElementSource(element:TestMedia) { const node=new TestNode(); sources.push({node,media:element}); return node; },
    async resume() { resumes++; }, async close() { closes++; },
  };
  return {gains,biquads,analysers,sources,media,destination,context,
    contextFactory:()=>{ contexts++; return context as unknown as AudioContext; },
    mediaFactory:()=>{ const element=new TestMedia(); media.push(element); return element as unknown as HTMLAudioElement; },
    counts:()=>({closes,resumes,contexts}),
  };
}
