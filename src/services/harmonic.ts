import type {Track} from '../types/track';
export interface MusicalKey {readonly name:string;readonly camelot:string;readonly number:number;readonly mode:'major'|'minor';}
export interface KeyAnalysis {readonly key:MusicalKey;readonly kind:'provider'|'providerEstimated';readonly confidence:null;}
const pitches:Record<string,number>={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const major=[8,3,10,5,12,7,2,9,4,11,6,1],minor=[5,12,7,2,9,4,11,6,1,8,3,10];
/** Reject unspecified mode rather than inventing major/minor or detection confidence. */
export function normalizeKey(value:unknown):MusicalKey|null {
 if(typeof value!=='string')return null;
 const match=/^([A-Ga-g])([#b]?)\s*(major|maj|minor|min|m)$/i.exec(value.trim().replaceAll('♯','#').replaceAll('♭','b'));
 if(!match)return null;const mode=match[3].toLowerCase().startsWith('maj')?'major':'minor';
 const pitch=(pitches[match[1].toUpperCase()]+(match[2]==='#'?1:match[2]==='b'?-1:0)+12)%12;
 const number=(mode==='major'?major:minor)[pitch];return Object.freeze({name:`${names[pitch]} ${mode}`,camelot:`${number}${mode==='major'?'B':'A'}`,number,mode});
}
export function compatibleKeys(key:MusicalKey):string[]{const letter=key.mode==='major'?'B':'A';return [key.camelot,`${(key.number+10)%12+1}${letter}`,`${key.number%12+1}${letter}`,`${key.number}${letter==='A'?'B':'A'}`];}
export function harmonicCompatibility(a:MusicalKey|null,b:MusicalKey|null):'unknown'|'compatible'|'other' {return !a||!b?'unknown':compatibleKeys(a).includes(b.camelot)?'compatible':'other';}
export function analyzeKey(track:Track):KeyAnalysis|null {const key=normalizeKey(track.tonality?.key),kind=track.tonality?.kind;return key&&(kind==='provider'||kind==='providerEstimated')?Object.freeze({key,kind,confidence:null}):null;}
