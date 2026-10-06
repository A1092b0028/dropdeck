export interface Track {
  /** Omitted by legacy YouTube IPC; omission means YouTube. */
  provider?: 'youtube' | 'local' | 'audius';
  id: string;
  title: string;
  channel: string;
  /** Duration in seconds; null when the metadata has no known duration. */
  duration: number | null;
  thumbnail: string;
  sourceUrl: string;
  /** Provider-neutral timing metadata, never an asserted exact beat alignment. */
  timing?:{readonly bpm:number;readonly kind:'provider'|'providerEstimated'};
  tonality?:{readonly key:string;readonly kind:'provider'|'providerEstimated'};
}

export function formatDuration(duration: number | null): string {
  if (duration === null) return '時長未知';
  const seconds = Math.floor(duration);
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  if (minutes < 60) return `${minutes}:${remainder}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`;
}
