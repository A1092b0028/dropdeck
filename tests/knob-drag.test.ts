import test from 'node:test';
import assert from 'node:assert/strict';
import { knobDragValue } from '../src/services/knob-drag.ts';

test('knob drag uses 400 pixels for the full range, independent of control width', () => {
  assert.equal(knobDragValue(0, 20, -1, 1), .1);
  assert.equal(knobDragValue(0, -20, -1, 1), -.1);
  assert.equal(knobDragValue(-1, 400, -1, 1), 1);
  assert.equal(knobDragValue(.25, 0, -1, 1), .25);
});

test('fine drag is four times slower and clamps at both limits', () => {
  assert.equal(knobDragValue(0, 20, -1, 1, true), .025);
  assert.equal(knobDragValue(.9, 100, -1, 1), 1);
  assert.equal(knobDragValue(-.9, -100, -1, 1), -1);
  assert.equal(knobDragValue(1, -20, -1, 1), .9);
});
