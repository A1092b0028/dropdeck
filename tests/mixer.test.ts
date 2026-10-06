import assert from 'node:assert/strict';
import test from 'node:test';
import { equalPowerCrossfade, MixerEngine } from '../src/audio/MixerEngine.ts';
import { audioBoundary } from './helpers/audio-context.ts';

test('equal-power left/center/right are correct and power stays constant',()=>{
  assert.deepEqual(equalPowerCrossfade(-1),{A:1,B:0});
  const center=equalPowerCrossfade(0);
  assert.ok(Math.abs(center.A-0.7071067811865476)<1e-12);
  assert.ok(Math.abs(center.B-0.7071067811865476)<1e-12);
  assert.deepEqual(equalPowerCrossfade(1),{A:0,B:1});
  for(const value of [-0.8,-0.3,0.2,0.6]) {
    const gains=equalPowerCrossfade(value); assert.ok(Math.abs(gains.A**2+gains.B**2-1)<1e-12);
  }
  assert.deepEqual(equalPowerCrossfade(-3),{A:1,B:0});
  assert.deepEqual(equalPowerCrossfade(3),{A:0,B:1});
  assert.throws(()=>equalPowerCrossfade(NaN),RangeError);
});

test('Mixer owns crossfade/master stages and clamps state without mixing their controls',()=>{
  const b=audioBoundary(), mixer=new MixerEngine(b.contextFactory());
  const [a,deckB,master]=b.gains;
  assert.equal(mixer.getCrossfader(),0); assert.equal(mixer.getMasterVolume(),0.8);
  assert.deepEqual(a.connections,[master]); assert.deepEqual(deckB.connections,[master]);
  assert.deepEqual(master.connections,[b.destination]);
  assert.equal(mixer.getInput('A'),a); assert.equal(mixer.getInput('B'),deckB);
  mixer.setCrossfader(-1); assert.equal(a.gain.value,1); assert.equal(deckB.gain.value,0);
  mixer.setMasterVolume(0.3); assert.equal(master.gain.value,0.3); assert.equal(a.gain.value,1);
  mixer.setCrossfader(1); assert.equal(a.gain.value,0); assert.equal(deckB.gain.value,1);
  assert.equal(master.gain.value,0.3);
  mixer.setMasterVolume(2); assert.equal(mixer.getMasterVolume(),1);
  mixer.setMasterVolume(-2); assert.equal(master.gain.value,0);
  assert.throws(()=>mixer.setMasterVolume(Infinity),RangeError);
  assert.throws(()=>mixer.setCrossfader(NaN),RangeError);
  const states:number[]=[]; const unsubscribe=mixer.subscribe(()=>states.push(mixer.getCrossfader()));
  mixer.setCrossfader(-0.5); assert.deepEqual(states,[-0.5]); unsubscribe();
  mixer.dispose(); mixer.dispose();
  assert.ok(b.gains.every(node=>node.disconnects===1 && node.connections.length===0));
  assert.equal(b.counts().closes,0); // mixer never owns context shutdown
});
