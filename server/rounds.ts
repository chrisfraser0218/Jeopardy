import type { openStore } from './db.js';
import type { scoringService } from './scoring.js';
import type { HostAction, LiveSession, ResponseTimer } from '../shared/live.js';
import type { FinalOwn, FinalPublic, FinalSubmission } from '../shared/rounds.js';
import { boardCategories, boardProgress, currentDefinition } from '../shared/rounds.js';
import { z } from 'zod';

function fail(message:string,status=409):never{throw Object.assign(new Error(message),{status});}
const submissionSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('wager'),sessionId:z.uuid(),finalId:z.uuid(),commandId:z.uuid(),amount:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict(),
  z.object({type:z.enum(['draft','submit']),sessionId:z.uuid(),finalId:z.uuid(),commandId:z.uuid(),response:z.string().max(5000),responseRevision:z.number().int().min(0)}).strict()
]);
type Row={session_id:string;player_id:string;name:string;starting_score:number;wager:number|null;wager_reason:string|null;wager_command_id:string|null;response:string;response_revision:number;locked:number;judgment:'correct'|'incorrect'|null;revealed:number;attempt_id:string|null;response_command_id:string|null};
export function roundService(store:ReturnType<typeof openStore>,get:()=>LiveSession|null,score:ReturnType<typeof scoringService>,transaction:<T>(fn:()=>T)=>T,broadcast:()=>void,now:()=>number){
  const rows=()=>store.db.prepare('SELECT f.*,p.name FROM final_submissions f JOIN session_players p ON p.id=f.player_id WHERE f.session_id=? ORDER BY f.rowid').all(get()?.id||'') as Row[];
  function privateFinal():FinalSubmission[]{return rows().map(r=>({playerId:r.player_id,name:r.name,startingScore:r.starting_score,wager:r.wager,wagerReason:r.wager_reason,response:r.response,responseRevision:r.response_revision,locked:Boolean(r.locked),judgment:r.attempt_id?(score.attempt(r.attempt_id)?.effectiveOutcome as 'correct'|'incorrect')||r.judgment:r.judgment,revealed:Boolean(r.revealed),attemptId:r.attempt_id}));}
  function publicFinal():FinalPublic|null{
    const s=get();if(!s?.final||s.round!=='final')return null;const submissions=rows();
    return {...structuredClone(s.final),...(submissions.length>0&&s.final.phase!=='wagering'?{clue:{text:s.game.finalJeopardy!.clue.text,imageId:s.game.finalJeopardy!.clue.imageId}}:{}),category:s.game.finalJeopardy!.category,total:submissions.length,wagersSubmitted:submissions.filter(r=>r.wager!==null).length,responsesLocked:submissions.filter(r=>r.locked).length,reveals:privateFinal().filter(r=>r.revealed).map(r=>({playerId:r.playerId,name:r.name,startingScore:r.startingScore,wager:r.wager!,response:r.response,judgment:r.judgment!,resultingScore:score.score(r.playerId)}))};
  }
  function own(playerId?:string):FinalOwn|null{if(get()?.round!=='final')return null;const r=rows().find(r=>r.player_id===playerId);return r?{eligible:true,startingScore:r.starting_score,wager:r.wager,response:r.response,responseRevision:r.response_revision,locked:Boolean(r.locked)}:{eligible:false};}
  function playerRows(){return store.db.prepare('SELECT id FROM session_players WHERE session_id=? AND removed=0 ORDER BY rowid').all(get()!.id) as {id:string}[];}
  function maxDaily(playerId:string){const s=get()!;return Math.max(s.dailyDouble?.revealed?(s.dailyDouble.startingScores[playerId]??score.score(playerId)):score.score(playerId),...boardCategories(s).flatMap(c=>c.clues.map(q=>q.value)));}
  function validateDaily(playerId:string|undefined,amount:number|undefined){
    if(!playerId||!playerRows().some(p=>p.id===playerId))fail('Choose a nonremoved player who selected this Daily Double.');
    const max=maxDaily(playerId);if(!Number.isInteger(amount)||amount!<5||amount!>max)fail(`Enter an integer Daily Double wager from $5 through $${max}.`);return playerId;
  }
  function announceDaily(){const s=get()!,clue=currentDefinition(s)!;if(!clue.dailyDouble)return;s.dailyDouble={clueId:clue.id,playerId:null,wager:null,revealed:false,startingScores:Object.fromEntries(playerRows().map(p=>[p.id,score.score(p.id)]))};}
  function enterFinal(){
    const s=get()!;s.round='final';s.currentClueId=s.game.finalJeopardy!.clue.id;s.currentAttemptId=null;s.dailyDouble=null;s.revealed=false;s.buzzer={clueId:null,windowId:null,open:false,winnerId:null,excludedIds:[],attemptedIds:[]};
    s.final={id:crypto.randomUUID(),phase:'wagering',timer:{state:'stopped',deadline:null,remainingMs:30000,timedOut:false}};
    for(const p of playerRows()){const starting=score.score(p.id);if(starting>0)store.db.prepare('INSERT INTO final_submissions (session_id,player_id,starting_score) VALUES (?,?,?)').run(s.id,p.id,starting);}
    if(rows().length===0){s.final.phase='complete';score.resolve();score.finish('complete');}
  }
  function advance(skip=false){
    const s=get()!;if(s.round==='final')fail('Final Jeopardy is already the last round.');
    const progress=boardProgress(s);if(!skip&&progress.resolved!==progress.total)fail('Resolve this board first, or explicitly skip its remaining clues.');
    if(!progress.hasNext&&!skip)fail('No enabled round remains. Finish this game instead.');
    score.dismiss('Round advanced');if(skip)for(const c of boardCategories(s))for(const q of c.clues)if(!s.completed.includes(q.id))s.completed.push(q.id);
    s.joiningOpen=false;s.currentAttemptId=null;s.currentClueId=null;s.revealed=false;s.dailyDouble=null;s.buzzer={clueId:null,windowId:null,open:false,winnerId:null,excludedIds:[],attemptedIds:[]};
    if(!progress.hasNext)return;
    if(s.round==='first'&&s.game.doubleJeopardy?.enabled)s.round='double';else enterFinal();
  }
  function setWager(row:Row,amount:number,reason:string|null,commandId:string){
    if(!Number.isInteger(amount)||amount<0||amount>row.starting_score)fail(`Enter an integer Final wager from $0 through $${row.starting_score}.`);
    if(row.wager!==null){if(row.wager_command_id===commandId&&row.wager===amount)return;fail('This confirmed wager is locked.');}
    store.db.prepare('UPDATE final_submissions SET wager=?,wager_reason=?,wager_command_id=? WHERE session_id=? AND player_id=?').run(amount,reason,commandId,row.session_id,row.player_id);
  }
  function closeResponses(expired=false){const s=get()!,f=s.final!;if(f.phase!=='responses')fail('Final responses are not open.');
    if(f.timer.deadline!==null)f.timer.remainingMs=Math.max(0,f.timer.deadline-now());f.timer.deadline=null;f.timer.state=expired?'expired':'stopped';f.timer.timedOut=expired;if(expired)f.timer.remainingMs=0;
    store.db.prepare('UPDATE final_submissions SET locked=1 WHERE session_id=?').run(s.id);f.phase='judging';
  }
  function hostAction(a:HostAction){
    const s=get()!;
    if(a.type==='advance-round'||a.type==='skip-round'){advance(a.type==='skip-round');return true;}
    if(a.type.startsWith('dd-')){
      const dd=s.dailyDouble;if(!dd||dd.clueId!==s.currentClueId||s.round==='final')fail('Select a Daily Double first.');
      if(s.completed.includes(dd.clueId)&&a.type!=='dd-correct')fail('This Daily Double is resolved. Return to the board or use an explicit setup correction.');
      if(a.type==='dd-player'){if(dd.revealed)fail('Use the explicit Daily Double setup correction after reveal.');if(!playerRows().some(p=>p.id===a.playerId))fail('Choose an active player.');dd.playerId=a.playerId!;dd.wager=null;}
      else if(a.type==='dd-wager'){if(dd.revealed)fail('Use the explicit setup correction after reveal.');validateDaily(dd.playerId||undefined,a.amount);dd.wager=a.amount!;}
      else if(a.type==='dd-reveal'){if(dd.revealed)fail('The Daily Double clue is already revealed.');validateDaily(dd.playerId||undefined,dd.wager??undefined);dd.startingScores[dd.playerId!]=score.score(dd.playerId!);dd.revealed=true;s.buzzer.winnerId=dd.playerId;score.accept(dd.playerId!,{value:dd.wager!,kind:'daily-double'});}
      else if(a.type==='dd-correct'){
        if(!dd.revealed||!a.reason?.trim()||score.current()?.id!==a.attemptId)fail('Choose the current revealed Daily Double attempt and give a correction reason.');
        const playerId=validateDaily(a.playerId,a.amount),old=score.current()!;
        if(old.status==='correct'||old.status==='incorrect')score.hostAction({...a,type:'judgment-correct',outcome:'dismissed'});
        else{score.dismiss(a.reason);score.add(old.playerId,0,'correction',a.reason,old);}
        s.revealed=false;s.completed=s.completed.filter(id=>id!==s.currentClueId);dd.playerId=playerId;dd.wager=a.amount!;s.buzzer.winnerId=playerId;
        score.accept(playerId,{value:a.amount!,kind:'daily-double',paused:true});
      }return true;
    }
    if(!a.type.startsWith('final-'))return false;
    const f=s.final;if(s.round!=='final'||!f||a.finalId!==f.id)fail('This Final stage changed. Review the current host view.');
    const submissions=rows(),row=submissions.find(r=>r.player_id===a.playerId);
    if(a.type==='final-wager'){if(f.phase!=='wagering'||!row||!a.reason?.trim())fail('Choose an eligible player and give a reason for a host-entered wager.');setWager(row,a.amount!,a.reason!,a.commandId);}
    else if(a.type==='final-zero-missing'){if(f.phase!=='wagering')fail('Wagering is closed.');for(const r of submissions)if(r.wager===null)setWager(r,0,'Host explicitly assigned missing wager to $0',`${a.commandId}:${r.player_id}`);}
    else if(a.type==='final-reveal-clue'){if(f.phase!=='wagering'||submissions.some(r=>r.wager===null))fail('Every eligible player needs a confirmed wager; explicitly assign missing wagers to $0 if needed.');f.phase='responses';f.timer={state:'running',deadline:now()+30000,remainingMs:30000,timedOut:false};}
    else if(a.type==='final-pause'){if(f.phase!=='responses'||f.timer.state!=='running')fail('Only an open running Final timer can be paused.');f.timer.remainingMs=Math.max(0,f.timer.deadline!-now());if(f.timer.remainingMs===0)f.timer.timedOut=true;f.timer.deadline=null;f.timer.state='paused';}
    else if(a.type==='final-resume'){if(f.phase!=='responses'||f.timer.state!=='paused'||f.timer.remainingMs<=0)fail('Only a paused Final timer with time remaining can resume.');f.timer.deadline=now()+f.timer.remainingMs;f.timer.state='running';}
    else if(a.type==='final-close'){closeResponses();}
    else if(a.type==='final-judge'){
      if(!['judging','revealing'].includes(f.phase)||!row?.locked||row.revealed||!['correct','incorrect'].includes(a.outcome||''))fail('Choose an unrevealed locked Final response to judge.');
      if(!row.response.trim()&&a.outcome==='correct')fail('Blank Final responses must be judged incorrect.');
      store.db.prepare('UPDATE final_submissions SET judgment=? WHERE session_id=? AND player_id=?').run(a.outcome!,s.id,row.player_id);
    }else if(a.type==='final-reveal-player'){
      if(!['judging','revealing'].includes(f.phase)||!row?.locked||!row.judgment||row.revealed)fail('Judge this locked response first, then reveal its result exactly once.');
      const attempt=score.accept(row.player_id,{clue:s.game.finalJeopardy!.clue,value:row.wager!,kind:'final',timerDisabled:true});score.judgeAttempt(attempt,row.judgment,false);
      store.db.prepare('UPDATE final_submissions SET revealed=1,attempt_id=? WHERE session_id=? AND player_id=?').run(attempt.id,s.id,row.player_id);f.phase='revealing';
      if(rows().every(r=>r.revealed)){f.phase='complete';score.resolve();score.finish('complete');}
    }else if(a.type==='final-reveal-answer'){if(!['judging','revealing'].includes(f.phase))fail('Lock all responses before revealing the Final answer.');s.revealed=true;}
    return true;
  }
  function submit(playerId:string,input:unknown){
    const a=submissionSchema.parse(input),s=get(),f=s?.final;
    if(!s||s.finished||s.paused||a.sessionId!==s.id||s.round!=='final'||!f||a.finalId!==f.id)fail('Final submissions are unavailable or this stage expired.');
    const row=rows().find(r=>r.player_id===playerId);if(!row)fail('You were not eligible at entry to Final Jeopardy.',403);
    if(a.type==='wager'){if(f.phase!=='wagering')fail('Final wagering is closed.');transaction(()=>{setWager(row,a.amount,null,a.commandId);});}
    else{
      if(f.phase!=='responses'||f.timer.timedOut||(f.timer.deadline!==null&&now()>=f.timer.deadline))fail('The Final response deadline has passed or responses are closed.');
      if(row.response_command_id===a.commandId){if(row.response!==a.response||Boolean(row.locked)!==(a.type==='submit'))fail('This submission identifier was already used for another operation.');return;}
      if(row.locked)fail('Your final response is locked.');
      if(a.responseRevision!==row.response_revision)fail('Your saved response changed in another tab. Reload the latest response before editing.');
      transaction(()=>{store.db.prepare('UPDATE final_submissions SET response=?,response_revision=response_revision+1,locked=?,response_command_id=? WHERE session_id=? AND player_id=?').run(a.response,Number(a.type==='submit'),a.commandId,s.id,playerId);});
    }broadcast();
  }
  function tick(){const s=get(),f=s?.final;if(!s||s.finished||!f||f.phase!=='responses'||f.timer.state!=='running'||f.timer.deadline===null||now()<f.timer.deadline)return;transaction(()=>{closeResponses(true);s.revision++;});broadcast();}
  function recover(){const f=get()?.final;if(f?.phase==='responses'&&f.timer.state!=='disabled'){if(f.timer.deadline!==null)f.timer.remainingMs=Math.max(0,f.timer.deadline-now());if(f.timer.remainingMs===0)f.timer.timedOut=true;f.timer.deadline=null;f.timer.state='paused';}}
  return {privateFinal,publicFinal,own,maxDaily,announceDaily,hostAction,submit,tick,recover};
}
