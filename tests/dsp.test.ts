import assert from 'node:assert/strict';
import test from 'node:test';
import { DeckDsp, defaultDspState, eqGainDb, filterCutoffs, normalizedControl } from '../src/audio/DeckDsp.ts';
import { audioBoundary } from './helpers/audio-context.ts';

test('DSP normalization clamps finite inputs and maps three neutral-centered EQ bands',()=>{
  assert.equal(normalizedControl(-2),-1); assert.equal(normalizedControl(2),1);
  assert.equal(eqGainDb(-1),-24); assert.equal(eqGainDb(-0.5),-12);
  assert.equal(eqGainDb(0),0); assert.equal(eqGainDb(0.5),3); assert.equal(eqGainDb(1),6);
  for(const value of [NaN,Infinity,-Infinity]) {
    assert.throws(()=>normalizedControl(value),RangeError);
    assert.throws(()=>eqGainDb(value),RangeError);
    assert.throws(()=>filterCutoffs(value,48000),RangeError);
  }
});

test('filter center is neutral, left progressively lowers LP and right raises HP',()=>{
  assert.deepEqual(filterCutoffs(0,48000),{lowpass:24000,highpass:0});
  assert.equal(filterCutoffs(-1,48000).lowpass,60);
  assert.equal(filterCutoffs(-1,48000).highpass,0);
  assert.ok(Math.abs(filterCutoffs(1,48000).highpass-12000)<1e-8);
  assert.equal(filterCutoffs(1,48000).lowpass,24000);
  assert.ok(filterCutoffs(-0.75,48000).lowpass<filterCutoffs(-0.25,48000).lowpass);
  assert.ok(filterCutoffs(0.75,48000).highpass>filterCutoffs(0.25,48000).highpass);
  assert.deepEqual(filterCutoffs(-2,48000),filterCutoffs(-1,48000));
  assert.deepEqual(filterCutoffs(2,48000),filterCutoffs(1,48000));
  assert.ok(filterCutoffs(1,16000).highpass<8000);
  for(const rate of [0,-1,NaN,Infinity]) assert.throws(()=>filterCutoffs(0,rate),RangeError);
});

test('DSP owns low/mid/high plus fixed LP/HP nodes with correct serial routing and defaults',()=>{
  const b=audioBoundary(); const dsp=new DeckDsp(b.contextFactory(),b.destination as unknown as AudioNode);
  const [low,mid,high,lp,hp]=b.biquads;
  assert.equal(dsp.input,low);
  assert.deepEqual(b.biquads.map(n=>n.type),['lowshelf','peaking','highshelf','lowpass','highpass']);
  assert.deepEqual(b.biquads.map(n=>n.frequency.value),[250,1000,4000,24000,0]);
  assert.equal(mid.Q.value,Math.SQRT1_2);
  assert.ok(Math.abs(lp.Q.value-20*Math.log10(Math.SQRT1_2))<1e-8);
  assert.equal(hp.Q.value,lp.Q.value);
  assert.deepEqual(low.connections,[mid]); assert.deepEqual(mid.connections,[high]);
  assert.deepEqual(high.connections,[lp]); assert.deepEqual(lp.connections,[hp]);
  assert.deepEqual(hp.connections,[b.destination]);
  assert.ok(b.biquads.slice(0,3).every(n=>n.gain.value===0));
  dsp.dispose();
});

test('low/mid/high updates and filter/reset ramp existing parameters without graph rewiring',()=>{
  const b=audioBoundary(); const dsp=new DeckDsp(b.contextFactory(),b.destination as unknown as AudioNode);
  dsp.apply({...defaultDspState,low:-1,mid:0.5,high:1,filter:-0.5});
  assert.deepEqual(b.biquads.slice(0,3).map(n=>n.gain.value),[-24,3,6]);
  assert.ok(b.biquads[3].frequency.value<24000);
  assert.equal(b.biquads[4].frequency.value,0);
  for(const node of b.biquads.slice(0,3)) {
    assert.deepEqual(node.gain.holds,[1]);
    assert.equal(node.gain.ramps[0].time,1.03);
  }
  b.context.currentTime=2;
  dsp.apply({...defaultDspState,filter:1}); dsp.apply(defaultDspState);
  assert.ok(b.biquads.every(n=>n.connections.length===1 && n.disconnects===0));
  assert.deepEqual(b.biquads.map(n=>n.type),['lowshelf','peaking','highshelf','lowpass','highpass']);
  assert.deepEqual(b.biquads.slice(0,3).map(n=>n.gain.value),[0,0,0]);
  assert.equal(b.biquads[3].frequency.value,24000); assert.equal(b.biquads[4].frequency.value,0);
  assert.equal(b.biquads[3].frequency.ramps.at(-1)?.time,2.03);
  dsp.dispose();
});

test('DSP initial state is applied without a ramp and cleanup cancels automation exactly once',()=>{
  const b=audioBoundary(); const dsp=new DeckDsp(b.contextFactory(),b.destination as unknown as AudioNode);
  dsp.apply({...defaultDspState,low:-0.5,filter:0.5},true);
  assert.equal(b.biquads[0].gain.value,-12); assert.equal(b.biquads[0].gain.ramps.length,0);
  dsp.apply({...defaultDspState,low:1});
  const cancellations=b.biquads.map(n=>[n.gain.cancellations.length,n.frequency.cancellations.length]);
  dsp.dispose(); dsp.dispose(); const count=b.biquads[0].gain.ramps.length;
  dsp.apply(defaultDspState);
  assert.ok(b.biquads.every(n=>n.disconnects===1));
  assert.equal(b.biquads[0].gain.ramps.length,count);
  assert.ok(b.biquads.every((n,i)=>n.gain.cancellations.length===cancellations[i][0]+1 && n.frequency.cancellations.length===cancellations[i][1]+1));
});

