import type { Track } from '../types/track';
import type { AudioSource } from '../types/audio';

export interface MusicProvider {
  search(query: string): Promise<Track[]>;
  resolve(track: Track): Promise<AudioSource>;
}
