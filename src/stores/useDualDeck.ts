import { useEffect, useState, useSyncExternalStore } from 'react';
import { createDualDeck } from '../audio/DualDeck';
import type { DualDeck } from '../audio/DualDeck';
import { emptyDeckSnapshot } from '../audio/DeckEngine';
import { emptyMixerSnapshot } from '../audio/MixerEngine';
import {emptyBeatSyncSnapshot} from '../audio/BeatSyncEngine';
import { audiusProvider } from '../services/audius';
import {WorkflowStore} from './WorkflowStore';
import {bindShortcuts} from '../services/shortcuts';

const subscribeEmpty = () => () => {};
const getEmptyDeck = () => emptyDeckSnapshot;
const getEmptyMixer = () => emptyMixerSnapshot;
const getEmptySync=()=>emptyBeatSyncSnapshot;

/** React observes engines; it never owns or edits audio nodes. */
export function useDualDeck() {
  const [owner,setOwner] = useState<DualDeck|null>(null);
  const [workflow,setWorkflow]=useState<WorkflowStore|null>(null);
  useEffect(()=>{
    const next = createDualDeck(track=>audiusProvider.resolve(track));
    let storage:Storage|null=null;try{storage=window.localStorage;}catch{ /* Keep in-memory workflow usable. */ }
    const store=new WorkflowStore(next,storage),removeKeys=bindShortcuts(document,next);
    window.addEventListener('pagehide',store.flush);
    setOwner(next);
    setWorkflow(store);
    return ()=>{removeKeys();window.removeEventListener('pagehide',store.flush);store.dispose();void next.dispose().catch(error=>console.warn('Audio runtime cleanup failed',error));};
  },[]);
  return {owner,workflow};
}
export function useDeckSnapshot(engine?:DualDeck['deckA']) {
  return useSyncExternalStore(engine?.subscribe??subscribeEmpty,engine?.getSnapshot??getEmptyDeck,getEmptyDeck);
}
export function useMixerSnapshot(engine?:DualDeck['mixer']) {
  return useSyncExternalStore(engine?.subscribe??subscribeEmpty,engine?.getSnapshot??getEmptyMixer,getEmptyMixer);
}
export function useBeatSyncSnapshot(engine?:DualDeck['sync']) {
  return useSyncExternalStore(engine?.subscribe??subscribeEmpty,engine?.getSnapshot??getEmptySync,getEmptySync);
}
