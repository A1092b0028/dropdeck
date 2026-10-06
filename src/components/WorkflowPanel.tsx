import {useSyncExternalStore} from 'react';
import type {WorkflowStore} from '../stores/WorkflowStore';
import {trackIdentity} from '../stores/WorkflowStore';
import {TrackTable} from './TrackTable';
import type {TrackRow} from './TrackTable';
export type WorkflowTab='queue'|'history'|'favorites';
export function WorkflowPanel({store,tab='queue'}:{store:WorkflowStore;tab?:WorkflowTab}) {
 const state=useSyncExternalStore(store.subscribe,store.getViewSnapshot);
 const rows:TrackRow[]=tab==='history'?state.history.map((entry,index)=>({
  track:entry.track,rowKey:`${entry.at}:${index}`,
  detail:`Deck ${entry.deck} · ${entry.action==='loaded'?'載入':'播放'} · ${new Date(entry.at).toLocaleString()}`,
 })):(tab==='favorites'?state.favorites:state.queue).map((track,index)=>({
  track,rowKey:trackIdentity(track),
  extra:tab==='queue'?<>
   <button className="btn" disabled={index===0} aria-label={`${track.title} 上移`} onClick={()=>store.moveQueue(index,-1)}>↑</button>
   <button className="btn" disabled={index===state.queue.length-1} aria-label={`${track.title} 下移`} onClick={()=>store.moveQueue(index,1)}>↓</button>
   <button className="btn" aria-label={`移除 ${track.title}`} onClick={()=>store.removeQueue(trackIdentity(track))}>×</button>
  </>:undefined,
 }));
 return <section className="workflow-panel" aria-label={tab}>
  {rows.length===0?<div className="library-empty"><b>{tab==='queue'?'Queue 尚無曲目':tab==='favorites'?'尚未收藏曲目':'尚無載入／播放紀錄'}</b><p>{tab==='history'?'載入或播放曲目後會顯示於此。':'從搜尋結果加入曲目。'}</p></div>:
   <TrackTable rows={rows} onLoadA={track=>void store.load('A',track)} onLoadB={track=>void store.load('B',track)}
    onQueue={tab==='queue'?undefined:track=>store.addQueue(track)} onFavorite={track=>store.toggleFavorite(track)}
    isFavorite={track=>state.favorites.some(t=>trackIdentity(t)===trackIdentity(track))}/>}
 </section>;
}
