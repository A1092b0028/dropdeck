import type { MusicProvider } from './music';
import type { Track } from '../types/track';
import { isAudioSource } from '../types/audio.ts';
import {normalizeBpm} from './analysis.ts';
import {normalizeKey} from './harmonic.ts';

const API = 'https://api.audius.co/v1';
const idPattern = /^[a-zA-Z0-9]{3,32}$/;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function normalize(value: unknown): Track | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as Record<string, unknown>;
  const user = t.user as Record<string, unknown> | undefined;
  if (t.is_streamable !== true || t.is_stream_gated !== false
    || typeof t.id !== 'string' || !idPattern.test(t.id)
    || typeof t.title !== 'string' || !t.title.trim()
    || typeof t.duration !== 'number' || !Number.isFinite(t.duration) || t.duration <= 0
    || !user || typeof user.name !== 'string'
    || typeof t.permalink !== 'string' || !t.permalink.startsWith('/') || t.permalink.startsWith('//')) return null;
  const permalink = new URL(t.permalink, 'https://audius.co');
  if (permalink.origin !== 'https://audius.co') return null;
  const bpm=normalizeBpm(t.bpm);
  const key=normalizeKey(t.musical_key);
  return {provider:'audius',id:t.id,title:t.title,channel:user.name,duration:t.duration,
    // Artwork lives on many independently operated nodes. Keep this POC's CSP narrow.
    thumbnail:'',sourceUrl:permalink.href,...(bpm!==null?{timing:{bpm,kind:t.is_custom_bpm===true?'provider' as const:'providerEstimated' as const}}:{}),
    ...(key?{tonality:{key:key.name,kind:t.is_custom_musical_key===true?'provider' as const:'providerEstimated' as const}}:{})};
}

/** Small read-only official REST adapter. No provider metadata enters DeckEngine. */
export function createAudiusProvider(fetcher: Fetch = (input, init) => fetch(input, init)): MusicProvider {
  async function request(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${API}${path}`);
    url.search = new URLSearchParams({app_name:'Drop Deck',...params}).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      // Keep JSON/API trust at this fixed origin; media redirects are handled by the WebView.
      const response = await fetcher(url.href, {signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});
      if (!response.ok) throw new Error(`Audius 請求失敗（HTTP ${response.status}）。`);
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('data' in body)) throw new Error('Audius 回應格式不支援。');
      return (body as {data:unknown}).data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Audius 請求逾時，請稍後重試。');
      if (error instanceof TypeError) throw new Error('Audius 網路連線失敗，請稍後重試。');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  return {
    async search(query) {
      if (!query.trim()) throw new Error('請輸入搜尋關鍵字。');
      const data = await request('/tracks/search', {query:query.trim(),limit:'10'});
      if (!Array.isArray(data)) throw new Error('Audius 搜尋回應格式不支援。');
      const seen = new Set<string>();
      return data.flatMap(value => {
        const track = normalize(value);
        if (!track || seen.has(track.id)) return [];
        seen.add(track.id); return [track];
      });
    },
    async resolve(track) {
      if (track.provider !== 'audius' || !idPattern.test(track.id)) throw new Error('不是有效的 Audius 曲目。');
      const data = await request(`/tracks/${track.id}`);
      const current = normalize(data);
      if (!current || current.id !== track.id) throw new Error('Audius 曲目無法公開串流，或需要存取授權。');
      const url = await request(`/tracks/${track.id}/stream`, {no_redirect:'true'});
      const source = {url,mimeType:'audio/mpeg' as const,expiresAt:null};
      // Trust the official API's original HTTPS stream, independent of operator or CDN path.
      if (!isAudioSource(source) || new URL(source.url).protocol !== 'https:') {
        throw new Error('Audius 串流來源格式不支援。');
      }
      return source;
    },
  };
}
export const audiusProvider = createAudiusProvider();





