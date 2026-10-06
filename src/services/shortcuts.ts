import type {DualDeck} from '../audio/DualDeck';
import type {DeckId} from '../types/deck';
type Action='playPause'|'cue'|'setCue'|'sync'|'loop'|'hotCue'|'setHotCue';
export interface Shortcut {deck:DeckId;action:Action;index?:number;}
export function shortcutAction(code:string,shift:boolean):Shortcut|null {
 const pairs:Record<string,Shortcut>={KeyZ:{deck:'A',action:'playPause'},KeyX:{deck:'B',action:'playPause'},KeyA:{deck:'A',action:shift?'setCue':'cue'},KeyS:{deck:'B',action:shift?'setCue':'cue'},KeyD:{deck:'A',action:'sync'},KeyF:{deck:'B',action:'sync'},KeyG:{deck:'A',action:'loop'},KeyH:{deck:'B',action:'loop'}};
 if(pairs[code])return pairs[code];const match=/^Digit([1-8])$/.exec(code);if(!match)return null;const number=Number(match[1])-1;return {deck:number<4?'A':'B',index:number%4,action:shift?'setHotCue':'hotCue'};
}
export function routeShortcut(event:{code:string;shiftKey?:boolean;ctrlKey?:boolean;metaKey?:boolean;altKey?:boolean;repeat?:boolean},dj:DualDeck,editing=false):boolean {
 if(editing||event.ctrlKey||event.metaKey||event.altKey||event.repeat)return false;const command=shortcutAction(event.code,Boolean(event.shiftKey));if(!command)return false;
 const deck=command.deck==='A'?dj.deckA:dj.deckB,performance=command.deck==='A'?dj.performanceA:dj.performanceB;
 switch(command.action){case 'playPause':if(deck.getSnapshot().status==='playing'||deck.getSnapshot().starting)deck.pause();else void deck.play();break;case 'cue':performance.jumpCue();break;case 'setCue':deck.setCue();break;case 'sync':if(dj.sync.getSnapshot().enabled&&dj.sync.getSnapshot().follower===command.deck)dj.sync.disable();else dj.sync.sync(command.deck);break;case 'loop':if(performance.getSnapshot().loop)performance.disableLoop();else performance.enableLoop();break;case 'hotCue':performance.jumpHotCue(command.index!);break;case 'setHotCue':deck.setHotCue(command.index!);break;}
 return true;
}
export function bindShortcuts(target:Document,dj:DualDeck):()=>void {
 const listener=(event:KeyboardEvent)=>{const node=event.target as HTMLElement|null;const editing=Boolean(event.isComposing||node?.isContentEditable||node?.closest?.('input, textarea, select, [contenteditable]'));if(routeShortcut(event,dj,editing))event.preventDefault();};
 target.addEventListener('keydown',listener);return()=>target.removeEventListener('keydown',listener);
}
