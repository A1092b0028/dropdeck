import type { Track } from './track';
import type { YouTubeErrorCode } from '../services/youtube';

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'success'; query: string; tracks: Track[] }
  | { status: 'error'; query: string; message: string; code: YouTubeErrorCode };
