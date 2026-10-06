import type {SearchState} from '../types/search';
import type {Track} from '../types/track';
import {TrackTable} from './TrackTable';
export function SearchResults({state,onLoadA,onLoadB,onQueue,onFavorite,isFavorite}:{
 state:SearchState;onLoadA?:(track:Track)=>void;onLoadB?:(track:Track)=>void;
 onQueue?:(track:Track)=>void;onFavorite?:(track:Track)=>void;isFavorite?:(track:Track)=>boolean;
}) {
 return <section className="search-results" aria-label="搜尋結果" aria-busy={state.status==='loading'}>
  {state.status==='idle'&&<div className="library-empty"><b>尋找下一首曲目</b><p>搜尋 Audius 音樂，載入 A / B 或加入 Queue。YouTube 僅提供搜尋。</p></div>}
  {state.status==='loading'&&<p role="status">正在搜尋「{state.query}」…</p>}
  {state.status==='error'&&<p className="search-error" role="alert">{state.message}</p>}
  {state.status==='success'&&<>
   <p className="results-summary" role="status">{state.tracks.length?`「${state.query}」· ${state.tracks.length} 首曲目`:`「${state.query}」沒有找到結果，請換個關鍵字。`}</p>
   {state.tracks.length>0&&<TrackTable rows={state.tracks.map(track=>({track,rowKey:`${track.provider??'youtube'}:${track.id}`}))}
    onLoadA={onLoadA} onLoadB={onLoadB} onQueue={onQueue} onFavorite={onFavorite} isFavorite={isFavorite}/>}
  </>}
 </section>;
}

