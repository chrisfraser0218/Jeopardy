import type { GameResults, HostAction, LedgerEntry, LiveSession, Outcome, ResponseAttempt, ResponseTimer } from '../shared/live.js';
import type { openStore } from './db.js';

type Store=ReturnType<typeof openStore>;
function fail(message:string):never{throw Object.assign(new Error(message),{status:409});}
export function scoringService(store:Store,getSession:()=>LiveSession|null,transaction:<T>(fn:()=>T)=>T,broadcast:()=>void,now:()=>number){
  function decode(row:any):ResponseAttempt{return {id:row.id,sessionId:row.session_id,playerId:row.player_id,clueId:row.clue_id,value:row.value,acceptedAt:row.accepted_at,status:row.status,effectiveOutcome:row.effective_outcome,timer:JSON.parse(row.timer)};}
  function attempt(id:string|null):ResponseAttempt|null{if(!id)return null;const row=store.db.prepare('SELECT * FROM response_attempts WHERE id=? AND session_id=?').get(id,getSession()?.id||'');return row?decode(row):null;}
  function current(){return attempt(getSession()?.currentAttemptId||null);}
  function attempts(){return (store.db.prepare('SELECT * FROM response_attempts WHERE session_id=? ORDER BY rowid').all(getSession()?.id||'') as any[]).map(decode);}
  function score(playerId:string){return Number((store.db.prepare('SELECT COALESCE(SUM(amount),0) AS score FROM score_ledger WHERE player_id=? AND session_id=?').get(playerId,getSession()?.id||'') as {score:number}).score);}
  function ledger():LedgerEntry[]{return (store.db.prepare('SELECT l.*,p.name FROM score_ledger l JOIN session_players p ON p.id=l.player_id WHERE l.session_id=? ORDER BY l.rowid').all(getSession()?.id||'') as any[]).map(r=>({id:r.id,sessionId:r.session_id,playerId:r.player_id,playerName:r.name,clueId:r.clue_id,attemptId:r.attempt_id,amount:r.amount,kind:r.kind,reason:r.reason,createdAt:r.created_at,referenceId:r.reference_id}));}
  function save(a:ResponseAttempt){store.db.prepare('UPDATE response_attempts SET status=?,effective_outcome=?,timer=? WHERE id=?').run(a.status,a.effectiveOutcome,JSON.stringify(a.timer),a.id);}
  function accept(playerId:string){
    const s=getSession()!,clue=s.game.categories.flatMap(c=>c.clues).find(q=>q.id===s.currentClueId)!;
    const duration=(s.timerSeconds||0)*1000;
    const a:ResponseAttempt={id:crypto.randomUUID(),sessionId:s.id,playerId,clueId:clue.id,value:clue.value,acceptedAt:new Date(now()).toISOString(),status:'pending',effectiveOutcome:null,timer:{state:s.timerSeconds===null?'disabled':'running',deadline:s.timerSeconds===null?null:now()+duration,remainingMs:duration,timedOut:false}};
    store.db.prepare('INSERT INTO response_attempts VALUES (?,?,?,?,?,?,?,?,?)').run(a.id,a.sessionId,a.playerId,a.clueId,a.value,a.acceptedAt,a.status,null,JSON.stringify(a.timer));s.currentAttemptId=a.id;return a;
  }
  function stopTimer(a:ResponseAttempt){if(a.timer.deadline!==null)a.timer.remainingMs=Math.max(0,a.timer.deadline-now());a.timer.deadline=null;a.timer.state=a.timer.state==='disabled'?'disabled':'stopped';}
  function dismiss(reason:string){const a=current();if(a?.status==='pending'){stopTimer(a);a.status='dismissed';a.effectiveOutcome='dismissed';save(a);}return reason;}
  function resolve(){const s=getSession()!;if(s.currentClueId&&!s.completed.includes(s.currentClueId))s.completed.push(s.currentClueId);s.buzzer.open=false;}
  function add(playerId:string,amount:number,kind:LedgerEntry['kind'],reason:string,a:ResponseAttempt|null=null,referenceId:string|null=null){
    if(!Number.isSafeInteger(amount)||Math.abs(score(playerId)+amount)>1_000_000_000)fail('Scores must be integer dollars between -$1,000,000,000 and $1,000,000,000.');
    const id=crypto.randomUUID();store.db.prepare('INSERT INTO score_ledger VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,getSession()!.id,playerId,a?.clueId||null,a?.id||null,amount,kind,reason,new Date(now()).toISOString(),referenceId);return id;
  }
  function standings(){const rows=store.db.prepare('SELECT id,name FROM session_players WHERE session_id=? AND removed=0 ORDER BY rowid').all(getSession()!.id) as {id:string;name:string}[];const sorted=rows.map(p=>({...p,score:score(p.id)})).sort((a,b)=>b.score-a.score);let rank=1;return sorted.map((p,i)=>{if(i&&p.score!==sorted[i-1].score)rank=i+1;return {...p,rank};});}
  function refreshResults(){const s=getSession()!;if(!s.finished||!s.results)return;s.results={...s.results,standings:standings()};store.db.prepare('INSERT OR REPLACE INTO session_results VALUES (?,?)').run(s.id,JSON.stringify(s.results));}
  function finish(reason:GameResults['reason']){
    const s=getSession()!;dismiss('Game ended without judgment');s.finished=true;s.paused=false;s.joiningOpen=false;s.showJoinQr=false;s.buzzer.open=false;s.buzzer.windowId=null;s.buzzer.winnerId=null;s.currentClueId=null;s.revealed=false;
    s.results={finishedAt:new Date(now()).toISOString(),reason,standings:standings()};refreshResults();
  }
  function hostAction(a:HostAction){
    const s=getSession()!;
    if(a.type==='score-adjust'){
      if(!a.playerId||!store.db.prepare('SELECT id FROM session_players WHERE id=? AND session_id=?').get(a.playerId,s.id))fail('Choose a player from this session, including removed players if correcting history.');
      if(!a.reason?.trim())fail('A reason is required for a score adjustment.');
      if(!Number.isInteger(a.amount)||!a.amount||Math.abs(a.amount)>1_000_000)fail('Enter a nonzero integer dollar adjustment up to $1,000,000 in either direction.');
      add(a.playerId,a.amount,'manual',a.reason.trim());refreshResults();return true;
    }
    if(a.type==='judgment-correct'){
      const target=attempt(a.attemptId||null);if(!target||!['correct','incorrect'].includes(target.status))fail('Choose an existing scored judgment from this session.');
      if(!a.reason?.trim()||!a.outcome)fail('Choose the intended outcome and give a correction reason.');
      if(target.effectiveOutcome===a.outcome)fail('That is already the effective judgment. No correction is needed.');
      const original=store.db.prepare("SELECT id FROM score_ledger WHERE attempt_id=? AND kind='judgment'").get(target.id) as {id:string}|undefined;if(!original)fail('The original judgment entry is unavailable.');
      const net=(store.db.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM score_ledger WHERE attempt_id=?').get(target.id) as {amount:number}).amount;
      add(target.playerId,-net,'reversal',a.reason.trim(),target,original.id);
      const replacement=a.outcome==='correct'?target.value:a.outcome==='incorrect'?-target.value:0;
      add(target.playerId,replacement,'correction',a.reason.trim(),target,original.id);target.effectiveOutcome=a.outcome;save(target);refreshResults();return true;
    }
    if(a.type==='finish-clue'){if(!s.currentClueId)fail('Select a clue first.');if(s.completed.includes(s.currentClueId))fail('This clue is already resolved. Return to the board.');dismiss('Clue finished without winner');resolve();s.buzzer.winnerId=null;s.buzzer.windowId=null;return true;}
    if(a.type==='judge-correct'||a.type==='judge-incorrect'){
      const target=current();if(!target||target.id!==a.attemptId||target.status!=='pending'||target.clueId!==s.currentClueId||s.completed.includes(target.clueId)||s.buzzer.winnerId!==target.playerId)fail('That response is no longer the current unresolved attempt. It cannot be scored again.');
      const outcome:Outcome=a.type==='judge-correct'?'correct':'incorrect';
      add(target.playerId,outcome==='correct'?target.value:-target.value,'judgment',outcome==='correct'?'Correct spoken response':'Incorrect spoken response',target);
      target.status=outcome;target.effectiveOutcome=outcome;stopTimer(target);save(target);s.buzzer.open=false;
      if(outcome==='correct')resolve();else{if(!s.buzzer.excludedIds.includes(target.playerId))s.buzzer.excludedIds.push(target.playerId);s.buzzer.winnerId=null;s.buzzer.windowId=null;}
      return true;
    }
    if(a.type==='dismiss-attempt'){
      const target=current();if(!target||target.id!==a.attemptId||target.status!=='pending')fail('That attempt is no longer awaiting a decision.');
      dismiss('Host dismissed the attempt without a score');s.buzzer.winnerId=null;s.buzzer.windowId=null;s.buzzer.open=false;return true;
    }
    if(a.type==='timer-pause'||a.type==='timer-resume'){
      const target=current();if(!target||target.id!==a.attemptId||target.status!=='pending')fail('The timer belongs to an old or judged attempt.');
      if(a.type==='timer-pause'){
        if(target.timer.state!=='running')fail('Only a running timer can be paused.');target.timer.remainingMs=Math.max(0,target.timer.deadline!-now());target.timer.deadline=null;target.timer.state='paused';
      }else{
        if(target.timer.state!=='paused'||target.timer.remainingMs<=0||target.timer.timedOut)fail('Only a paused timer with time remaining can resume. Judge or dismiss a timed-out response.');target.timer.deadline=now()+target.timer.remainingMs;target.timer.state='running';
      }
      save(target);return true;
    }
    return false;
  }
  function expire(id:string,deadline:number){
    const s=getSession(),a=current();if(!s||s.finished||!a||a.id!==id||a.status!=='pending'||a.timer.state!=='running'||a.timer.deadline!==deadline||now()<deadline)return false;
    transaction(()=>{a.timer={...a.timer,state:'expired',remainingMs:0,deadline:null,timedOut:true};save(a);s.buzzer.open=false;s.revision++;});broadcast();return true;
  }
  function tick(){const a=current();if(a?.timer.state==='running'&&a.timer.deadline!==null)expire(a.id,a.timer.deadline);}
  function recover(){
    const s=getSession();if(!s)return;
    // Legacy winners have no invented score: create only an unresolved response to judge.
    if(!s.currentAttemptId&&s.currentClueId&&s.buzzer.winnerId&&!s.finished){if(store.db.prepare('SELECT id FROM session_players WHERE id=?').get(s.buzzer.winnerId))accept(s.buzzer.winnerId);}
    const a=current();if(a?.status==='pending'&&a.timer.state!=='disabled'){
      if(a.timer.deadline!==null)a.timer.remainingMs=Math.max(0,a.timer.deadline-now());if(a.timer.remainingMs===0)a.timer.timedOut=true;a.timer.deadline=null;a.timer.state='paused';save(a);
    }
  }
  return {current,attempt,attempts,score,ledger,accept,dismiss,resolve,finish,hostAction,expire,tick,recover,refreshResults};
}
