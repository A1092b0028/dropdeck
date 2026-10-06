/** Relative vertical movement; size changes never alter sensitivity. */
export function knobDragValue(value: number, upwardPixels: number, min: number, max: number, fine = false): number {
  return Math.max(min, Math.min(max, value + upwardPixels * (max - min) / (fine ? 1600 : 400)));
}
