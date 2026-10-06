import { DeckEngine } from './DeckEngine.ts';
import { WebAudioRuntime } from './WebAudioSession.ts';
import type { Track } from '../types/track';
import type { AudioSource } from '../types/audio';
import {analyzeTrack} from '../services/analysis.ts';
import {BeatSyncEngine} from './BeatSyncEngine.ts';
import {PerformanceEngine} from './PerformanceEngine.ts';

/** One owner per DJ workspace. Deck disposal never owns the shared context. */
export function createDualDeck(resolveSource: (track:Track)=>Promise<AudioSource>, runtime = new WebAudioRuntime()) {
  const mixer = runtime.getMixer();
  const deckA = new DeckEngine(resolveSource,event=>runtime.createDeckSession('A',event),analyzeTrack);
  const deckB = new DeckEngine(resolveSource,event=>runtime.createDeckSession('B',event),analyzeTrack);
  const sync=new BeatSyncEngine(deckA,deckB);
  const performanceA=new PerformanceEngine(deckA,()=>sync.disable('表演動作已解除 Sync；結束後可重新同步'));
  const performanceB=new PerformanceEngine(deckB,()=>sync.disable('表演動作已解除 Sync；結束後可重新同步'));
  let disposal: Promise<void> | undefined;
  return {deckA,deckB,mixer,sync,performanceA,performanceB,readWaveform:(deck:'A'|'B')=>runtime.readDeckWaveform(deck),
    dispose(): Promise<void> {
      return disposal ??= (async()=>{performanceA.dispose();performanceB.dispose();sync.dispose();deckA.dispose();deckB.dispose();await runtime.dispose();})();
    },
  };
}
export type DualDeck = ReturnType<typeof createDualDeck>;
