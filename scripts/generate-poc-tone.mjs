// Original, low-amplitude control tone. No external audio or copyrighted sample.
import { mkdir, writeFile } from 'node:fs/promises';
const rate = 22050, duration = 12, samples = rate * duration;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const t = i / rate;
  const envelope = Math.min(1, t / 0.02, (duration - t) / 0.02);
  const value = envelope * (0.10 * Math.sin(2 * Math.PI * 440 * t) + 0.06 * Math.sin(2 * Math.PI * 660 * t));
  wav.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
}
await mkdir(new URL('../public/audio/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/audio/poc-tone.wav', import.meta.url), wav);
console.log(`Generated original PCM WAV: ${duration}s, ${rate}Hz, mono, ${wav.length} bytes`);
