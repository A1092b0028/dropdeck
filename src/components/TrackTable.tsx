import type {ReactNode} from 'react';
import type {Track} from '../types/track';
import {formatDuration} from '../types/track';
import {analyzeKey} from '../services/harmonic';
import {normalizeBpm} from '../services/analysis';
export interface TrackRow {track:Track;rowKey:string;detail?:string;extra?:ReactNode;}
export function TrackTable({rows,onLoadA,onLoadB,onQueue,onFavorite,isFavorite}:{
 rows:readonly TrackRow[];onLoadA?:(track:Track)=>void;onLoadB?:(track:Track)=>void;
 onQueue?:(track:Track)=>void;onFavorite?:(track:Track)=>void;isFavorite?:(track:Track)=>boolean;
}) {
 return <div className="track-table-wrap"><table className="track-table"><thead><tr>
  <th scope="col">TRACK / ARTIST</th><th scope="col">BPM</th><th scope="col">KEY</th><th scope="col">TIME</th><th scope="col">LOAD / ACTIONS</th>
 </tr></thead><tbody>{rows.map(({track,rowKey,detail,extra})=>{
  const key=analyzeKey(track),bpm=normalizeBpm(track.timing?.bpm),playable=track.provider==='audius';
  return <tr key={rowKey}><td className="track-cell"><div><strong title={track.title}>{track.title}</strong><small>{track.channel}{detail?` · ${detail}`:''}</small></div></td>
   <td>{bpm===null?'—':`${track.timing?.kind==='providerEstimated'?'≈':''}${bpm.toFixed(1)}`}</td>
   <td title={key?.key.name}>{key?`${key.kind==='providerEstimated'?'≈':''}${key.key.camelot}`:'—'}</td>
   <td>{formatDuration(track.duration)}</td><td><div className="result-actions" role="group" aria-label={`${track.title}：載入 Deck`}>
    <button className="btn load-a" disabled={!onLoadA||!playable} title={playable?'載入 Deck A':'僅 Audius 可載入'} onClick={()=>onLoadA?.(track)}>A</button>
    <button className="btn load-b" disabled={!onLoadB||!playable} title={playable?'載入 Deck B':'僅 Audius 可載入'} onClick={()=>onLoadB?.(track)}>B</button>
    {onQueue&&<button className="btn" disabled={!playable} aria-label={`加入 Queue：${track.title}`} onClick={()=>onQueue(track)}>＋</button>}
    {onFavorite&&<button className="btn favorite-button" aria-label={`收藏：${track.title}`} aria-pressed={isFavorite?.(track)??false} onClick={()=>onFavorite(track)}>{isFavorite?.(track)?'★':'☆'}</button>}
    {extra}</div></td></tr>;
 })}</tbody></table></div>;
}

