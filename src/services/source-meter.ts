/** Raw source display only: analyser is before EQ and channel volume. */
export function sourceLevel(samples: Float32Array | null): { rms: number; peak: number } {
  let sum = 0, peak = 0, count = 0;
  for (const sample of samples ?? []) {
    if (!Number.isFinite(sample)) continue;
    sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); count++;
  }
  return { rms: count ? Math.min(1, Math.sqrt(sum / count)) : 0, peak: Math.min(1, peak) };
}
