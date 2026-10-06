/** Provider-neutral playback contract. Expiry is Unix seconds. */
export interface AudioSource {
  url: string;
  mimeType: 'audio/mp4' | 'audio/webm' | 'audio/wav' | 'audio/mpeg';
  expiresAt: number | null;
}

export function isAudioSource(value: unknown, localOrigin = typeof location === 'undefined' ? undefined : location.origin): value is AudioSource {
  if (typeof value !== 'object' || value === null) return false;
  const source = value as Record<string, unknown>;
  if (typeof source.url !== 'string') return false;
  try {
    const url = new URL(source.url);
    const sameOrigin = localOrigin !== undefined && url.origin === localOrigin
      && (url.protocol === 'http:' || url.protocol === 'https:');
    if ((!sameOrigin && (url.protocol !== 'https:' || url.port))
      || url.username || url.password || url.hash) return false;
  } catch { return false; }
  return ['audio/mp4', 'audio/webm', 'audio/wav', 'audio/mpeg'].includes(source.mimeType as string)
    && (source.expiresAt === null || (typeof source.expiresAt === 'number'
      && Number.isSafeInteger(source.expiresAt) && source.expiresAt >= 0));
}
