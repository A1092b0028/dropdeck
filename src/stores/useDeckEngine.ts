import { useEffect, useState, useSyncExternalStore } from 'react';
import { DeckEngine, emptyDeckSnapshot } from '../audio/DeckEngine';
import { WebAudioRuntime } from '../audio/WebAudioSession';
import { youtubeService } from '../services/youtube';
import { createLocalProvider } from '../services/local';
import { audiusProvider } from '../services/audius';

const subscribeEmpty = () => () => {};
const getEmpty = () => emptyDeckSnapshot;

export function useDeckEngine() {
  const [engine, setEngine] = useState<DeckEngine | null>(null);
  useEffect(() => {
    const runtime = new WebAudioRuntime();
    const localProvider = createLocalProvider(location.origin);
    const deck = new DeckEngine(track => (track.provider === 'local' ? localProvider
      : track.provider === 'audius' ? audiusProvider : youtubeService).resolve(track), runtime.createSession);
    setEngine(deck);
    return () => {
      deck.dispose();
      void runtime.dispose().catch(error => console.warn('Audio context cleanup failed', error));
    };
  }, []);
  const snapshot = useSyncExternalStore(engine?.subscribe ?? subscribeEmpty, engine?.getSnapshot ?? getEmpty, getEmpty);
  return { engine, snapshot };
}
