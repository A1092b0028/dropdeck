import type { MusicProvider } from './music';
import type { Track } from '../types/track';

export const localControlTrack: Track = {
  provider: 'local', id: 'local-poc-tone', title: '本機控制音 · 440/660 Hz · 12 秒',
  channel: 'Drop Deck 自行合成測試資產', duration: 12, thumbnail: '', sourceUrl: '/audio/poc-tone.wav',
};

export function createLocalProvider(origin: string): MusicProvider {
  const url = new URL('/audio/poc-tone.wav', origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid app origin');
  return {
    async search() { return [{ ...localControlTrack }]; },
    async resolve(track) {
      if (track.provider !== 'local' || track.id !== localControlTrack.id) throw new Error('本機 provider 只提供內建控制音。');
      return { url: url.href, mimeType: 'audio/wav', expiresAt: null };
    },
  };
}
