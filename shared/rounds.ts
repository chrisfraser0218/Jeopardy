import type { Category, Clue } from './model.js';
import type { LiveSession, ResponseTimer } from './live.js';
export type RoundName='first'|'double'|'final';
export type DailyDoubleState={clueId:string;playerId:string|null;wager:number|null;revealed:boolean;startingScores:Record<string,number>};
export type PublicDailyDouble=Omit<DailyDoubleState,'startingScores'>;
export type FinalStage={id:string;phase:'wagering'|'responses'|'judging'|'revealing'|'complete';timer:ResponseTimer};
export type FinalReveal={playerId:string;name:string;startingScore:number;wager:number;response:string;judgment:'correct'|'incorrect';resultingScore:number};
export type FinalPublic=FinalStage&{category:string;total:number;wagersSubmitted:number;responsesLocked:number;reveals:FinalReveal[];clue?:{text:string;imageId:string|null}};
export type FinalSubmission={playerId:string;name:string;startingScore:number;wager:number|null;wagerReason:string|null;response:string;responseRevision:number;locked:boolean;judgment:'correct'|'incorrect'|null;revealed:boolean;attemptId:string|null};
export type FinalOwn={eligible:boolean;startingScore?:number;wager?:number|null;response?:string;responseRevision?:number;locked?:boolean};
export function boardCategories(s:LiveSession):Category[]{return s.round==='double'?s.game.doubleJeopardy?.categories||[]:s.round==='final'?[]:s.game.categories;}
export function currentDefinition(s:LiveSession):Clue|undefined{return s.round==='final'?s.game.finalJeopardy?.clue:boardCategories(s).flatMap(c=>c.clues).find(q=>q.id===s.currentClueId);}
export function boardProgress(s:LiveSession){const clues=boardCategories(s).flatMap(c=>c.clues);return {resolved:clues.filter(q=>s.completed.includes(q.id)).length,total:clues.length,hasNext:s.round==='first'?Boolean(s.game.doubleJeopardy?.enabled||s.game.finalJeopardy?.enabled):s.round==='double'?Boolean(s.game.finalJeopardy?.enabled):false};}
export const roundLabel=(round:RoundName)=>round==='double'?'Double Jeopardy':round==='final'?'Final Jeopardy':'First board';
