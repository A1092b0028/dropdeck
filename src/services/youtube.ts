import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Track } from '../types/track';
import { isAudioSource } from '../types/audio.ts';
import type { MusicProvider } from './music';

export interface YouTubeService extends MusicProvider {}

export type YouTubeErrorCode =
  | 'invalidQuery' | 'notInstalled' | 'executionFailed'
  | 'searchFailed' | 'invalidOutput' | 'desktopRequired'
  | 'invalidTrack' | 'resolutionFailed' | 'unsupportedSource';

export class YouTubeSearchError extends Error {
  readonly code: YouTubeErrorCode;

  constructor(code: YouTubeErrorCode, message: string) {
    super(message);
    this.name = 'YouTubeSearchError';
    this.code = code;
  }
}

type SearchTransport = (command: string, args: { query: string } | { trackId: string }) => Promise<unknown>;

const nativeTransport: SearchTransport = async (command, args) => {
  if (!isTauri()) {
    throw new YouTubeSearchError('desktopRequired', 'YouTube 服務需在 Drop Deck 桌面版執行；瀏覽器預覽無法呼叫本機服務。');
  }
  return invoke(command, args);
};

const errorCodes = new Set<YouTubeErrorCode>([
  'invalidQuery', 'notInstalled', 'executionFailed', 'searchFailed', 'invalidOutput', 'desktopRequired',
  'invalidTrack', 'resolutionFailed', 'unsupportedSource',
]);

function isTrack(value: unknown): value is Track {
  if (typeof value !== 'object' || value === null) return false;
  const track = value as Record<string, unknown>;
  return (track.provider === undefined || track.provider === 'youtube')
    && typeof track.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(track.id)
    && typeof track.title === 'string' && track.title.trim().length > 0
    && typeof track.channel === 'string' && track.channel.trim().length > 0
    && (track.duration === null || (typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration >= 0))
    && typeof track.thumbnail === 'string' && track.thumbnail.startsWith('https://i.ytimg.com/')
    && track.sourceUrl === `https://www.youtube.com/watch?v=${track.id}`;
}

function searchError(error: unknown): YouTubeSearchError {
  if (error instanceof YouTubeSearchError) return error;
  if (typeof error === 'object' && error !== null) {
    const native = error as Record<string, unknown>;
    if (typeof native.code === 'string' && errorCodes.has(native.code as YouTubeErrorCode)
      && typeof native.message === 'string' && native.message.trim()) {
      return new YouTubeSearchError(native.code as YouTubeErrorCode, native.message);
    }
  }
  return new YouTubeSearchError('executionFailed', '無法完成搜尋，請確認桌面搜尋服務可用後再試一次。');
}

export function createYouTubeService(transport: SearchTransport = nativeTransport): YouTubeService {
  return {
    async search(query) {
      const trimmed = query.trim();
      if (!trimmed || Array.from(trimmed).length > 200) {
        throw new YouTubeSearchError('invalidQuery', '請輸入 1 到 200 個字元的搜尋關鍵字。');
      }
      try {
        const result = await transport('search_youtube', { query: trimmed });
        if (!Array.isArray(result) || !result.every(isTrack)) {
          throw new YouTubeSearchError('invalidOutput', '搜尋服務回傳的資料格式無效，請稍後重試。');
        }
        return result;
      } catch (error) {
        throw searchError(error);
      }
    },
    async resolve(track) {
      if (!isTrack(track)) {
        throw new YouTubeSearchError('invalidTrack', '曲目資料無效，請重新搜尋。');
      }
      try {
        const result = await transport('resolve_youtube_audio', { trackId: track.id });
        if (!isAudioSource(result) || !new URL(result.url).hostname.endsWith('.googlevideo.com')
          || new URL(result.url).protocol !== 'https:' || new URL(result.url).port
          || (result.mimeType !== 'audio/mp4' && result.mimeType !== 'audio/webm')) {
          throw new YouTubeSearchError('invalidOutput', '音訊來源資料無效，請重新載入曲目。');
        }
        return result;
      } catch (error) {
        if (error instanceof YouTubeSearchError) throw error;
        if (typeof error === 'object' && error !== null && 'code' in error) throw searchError(error);
        throw new YouTubeSearchError('resolutionFailed', '無法解析音訊來源，請重新載入曲目。');
      }
    },
  };
}

export const youtubeService: YouTubeService = createYouTubeService();
