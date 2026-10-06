import {Deck} from './components/Deck';
import {Mixer} from './components/Mixer';
import {Waveform} from './components/Waveform';
import {Search} from './components/Search';
import {SearchResults} from './components/SearchResults';
import {useYouTubeSearch} from './stores/useYouTubeSearch';
import {useDualDeck,useDeckSnapshot,useMixerSnapshot,useBeatSyncSnapshot} from './stores/useDualDeck';
import type {DualDeck} from './audio/DualDeck';
import type {DeckId} from './types/deck';
import {audiusProvider} from './services/audius';
import {youtubeService} from './services/youtube';
import {useState,useCallback,memo,useSyncExternalStore,useRef} from 'react';
import {WorkflowPanel} from './components/WorkflowPanel';
import {trackIdentity} from './stores/WorkflowStore';
import type {WorkflowStore} from './stores/WorkflowStore';
import type {SearchState} from './types/search';
const emptyFavorites:readonly import('./types/track').Track[]=[];
const subscribeEmpty=()=>()=>{};
const StorageStatus=memo(function StorageStatus({store}:{store:WorkflowStore|null}){
 const error=useSyncExternalStore(store?.subscribe??subscribeEmpty,()=>store?.getViewSnapshot().storageError??null);
 return error?<p className="storage-error" role="alert">{error}</p>:null;
});
const ConnectedResults=memo(function ConnectedResults({store,state}:{store:WorkflowStore|null;state:SearchState}){
 const favorites=useSyncExternalStore(store?.subscribe??subscribeEmpty,()=>store?.getViewSnapshot().favorites??emptyFavorites);
 return <SearchResults state={state} onLoadA={store?track=>{void store.load('A',track);}:undefined} onLoadB={store?track=>{void store.load('B',track);}:undefined}
  onQueue={store?track=>store.addQueue(track):undefined} onFavorite={store?track=>store.toggleFavorite(track):undefined} isFavorite={track=>favorites.some(t=>trackIdentity(t)===trackIdentity(track))}/>;
});
const ConnectedDeck=memo(function ConnectedDeck({owner,id}:{owner:DualDeck|null;id:DeckId}){
 const engine=id==='A'?owner?.deckA:owner?.deckB;
 const snapshot=useDeckSnapshot(engine),syncSnapshot=useBeatSyncSnapshot(owner?.sync);
 return <Deck id={id} engine={engine} snapshot={snapshot} sync={owner?.sync} syncSnapshot={syncSnapshot} performance={id==='A'?owner?.performanceA:owner?.performanceB}/>;
});
const ConnectedWaveform=memo(function ConnectedWaveform({owner,id}:{owner:DualDeck|null;id:DeckId}){
 const engine=id==='A'?owner?.deckA:owner?.deckB,snapshot=useDeckSnapshot(engine);
 const readSamples=useCallback(()=>owner?.readWaveform(id)??null,[owner,id]);
 return <section className="global-waveform-deck" data-d={id.toLowerCase()} aria-label={`Deck ${id} waveform`}>
  <div className="waveform-heading"><b>DECK {id}</b><span>{snapshot.track?.title??'NO TRACK LOADED'}</span><small>LIVE / OBSERVED</small></div>
  <Waveform id={id} engine={engine} snapshot={snapshot} readSamples={readSamples} performance={id==='A'?owner?.performanceA:owner?.performanceB}/>
 </section>;
});
const ConnectedMixer=memo(function ConnectedMixer({owner}:{owner:DualDeck|null}){
 const snapshot=useMixerSnapshot(owner?.mixer);
 return <Mixer engine={owner?.mixer} snapshot={snapshot} owner={owner}/>;
});
const tabs=[['search','SEARCH'],['queue','QUEUE'],['history','HISTORY'],['favorites','FAVORITES']] as const;
export default function App(){
 const [provider,setProvider]=useState<'youtube'|'audius'>('audius');
 const [tab,setTab]=useState<(typeof tabs)[number][0]>('search');
 const tabRefs=useRef<Array<HTMLButtonElement|null>>([]);
 const search=useYouTubeSearch(provider==='audius'?audiusProvider:youtubeService);
 const dj=useDualDeck();
 return <div className="app">
  <header className="app-header"><h1 className="logo"><img className="brand-mark" src="/brand/drop-deck-mark.png" alt="Drop Deck" width="52" height="52"/></h1><span className="workspace-label">PERFORMANCE WORKSPACE</span>
   <span className="header-note"><i/> DUAL DECK / STEREO</span></header>
  <main>
   <div className="global-waveforms"><ConnectedWaveform id="A" owner={dj.owner}/><ConnectedWaveform id="B" owner={dj.owner}/></div>
   <div className="controller"><ConnectedDeck id="A" owner={dj.owner}/><ConnectedMixer owner={dj.owner}/><ConnectedDeck id="B" owner={dj.owner}/></div>
   <section className="library" aria-label="曲庫">
    <StorageStatus store={dj.workflow}/>
    <div className="library-header"><div className="library-tabs" role="tablist" aria-label="曲庫分頁">{tabs.map(([value,label],index)=>
     <button key={value} ref={node=>{tabRefs.current[index]=node;}} id={`tab-${value}`} role="tab" aria-selected={tab===value} aria-controls={`panel-${value}`} tabIndex={tab===value?0:-1}
      onClick={()=>setTab(value)} onKeyDown={event=>{
       let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
       else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;
       event.preventDefault();setTab(tabs[next]![0]);tabRefs.current[next]?.focus();
      }}>{label}</button>)}</div>
     <details className="shortcut-help"><summary>快捷鍵 / 說明</summary><div><p>Z / X：Play/Pause A / B · A / S：Cue · D / F：Sync · G / H：Loop</p>
      <p>1–4：Hot Cue A · 5–8：Hot Cue B · Shift + Cue／Hot Cue：設定位置。</p><p>本機保存 Queue、收藏、最近 100 筆載入／首次播放紀錄、Cue、分析及控制設定。重啟不自動載入或播放。</p>
      <p>波形僅顯示實際觀察的區段。灰線為 BPM 推算拍點，暫定起點需手動對齊。≈ 表示平台估計。Jog 僅提供定位，未支援 scratch。</p></div></details></div>
    <div className="library-toolbar"><select aria-label="音樂來源" value={provider} disabled={search.state.status==='loading'}
     onChange={event=>{setProvider(event.target.value as 'youtube'|'audius');setTab('search');}}>
     <option value="audius">AUDIUS</option><option value="youtube">YOUTUBE 搜尋</option></select>
     <Search query={search.query} onQueryChange={search.setQuery} onSearch={()=>{setTab('search');void search.search();}} loading={search.state.status==='loading'} providerLabel={provider==='audius'?'Audius':'YouTube'}/>
     <span className="library-source-note">≈ 平台估計 · — 未知</span></div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="library-content">
     {tab==='search'?<ConnectedResults state={search.state} store={dj.workflow}/>:dj.workflow?<WorkflowPanel store={dj.workflow} tab={tab}/>:<p role="status">初始化曲庫…</p>}
    </div>
   </section>
  </main>
  <footer className="app-footer"><span>DROP DECK / 2 DECK CONTROLLER</span><span>Tempo ±20% · 串流 Loop 不保證無縫 · 視覺與音訊待使用者驗收</span></footer>
 </div>;
}
