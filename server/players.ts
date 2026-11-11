import { createHash, randomBytes } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { currentPolicy } from '../shared/rounds.js';
import type { BuzzerState, HostAction, LiveSession, PlayerIdentity, PlayerPublic, PlayerState } from '../shared/live.js';
import type { openStore } from './db.js';
import type { roundService } from './rounds.js';
import type { scoringService } from './scoring.js';

type PlayerRow = { id:string; session_id:string; name:string; removed:number };
export const emptyBuzzer = (clueId:string|null=null):BuzzerState => ({clueId,windowId:null,open:false,winnerId:null,excludedIds:[],attemptedIds:[]});
const hash = (value:string) => createHash('sha256').update(value).digest('hex');
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status});}
const joinSchema=z.object({sessionId:z.uuid(),name:z.string().transform(s=>s.normalize('NFKC').trim()).pipe(z.string().min(1,'Enter a player name.').max(24,'Use a name with 24 characters or fewer.').regex(/^[^\p{C}]+$/u,'Use a name without control or invisible characters.'))}).strict();
const buzzSchema=z.object({sessionId:z.uuid(),windowId:z.uuid()}).strict();

export function playerService(store:ReturnType<typeof openStore>,io:Server,getSession:()=>LiveSession|null,broadcast:()=>void,origins:()=>string[],scoring:ReturnType<typeof scoringService>,transaction:<T>(fn:()=>T)=>T,afterCommit:(fn:()=>void)=>void,now:()=>number,rounds:ReturnType<typeof roundService>){
  // A credential can have many observer tabs but only one socket can buzz.
  const tabs=new Map<string,Set<string>>();
  const active=(id:string)=>tabs.get(id)?.values().next().value as string|undefined;
  function roster():PlayerPublic[]{
    const session=getSession();if(!session)return [];
    return (store.db.prepare('SELECT id,name FROM session_players WHERE session_id=? AND removed=0 ORDER BY rowid').all(session.id) as {id:string;name:string}[]).map(p=>({...p,connected:Boolean(tabs.get(p.id)?.size),score:scoring.score(p.id)}));
  }
  function allPlayers(){const s=getSession();if(!s)return [];return (store.db.prepare('SELECT id,name,removed FROM session_players WHERE session_id=? ORDER BY rowid').all(s.id) as {id:string;name:string;removed:number}[]).map(p=>({...p,removed:Boolean(p.removed),connected:!p.removed&&Boolean(tabs.get(p.id)?.size),score:scoring.score(p.id)}));}
  function authenticate(sessionId:unknown,token:unknown):PlayerRow{
    const session=getSession();
    if(!session||sessionId!==session.id)fail('This session ended or expired. Scan the QR code for the current game.',401);
    if(typeof token!=='string'||token.length>200)fail('Player credential is missing or invalid. A name cannot restore a player.',401);
    const row=store.db.prepare('SELECT id,session_id,name,removed FROM session_players WHERE session_id=? AND token_hash=?').get(session.id,hash(token)) as PlayerRow|undefined;
    if(!row)fail('Player credential is invalid. Rejoin with a new name or ask the host for help.',401);
    if(row.removed)fail('The host removed this player. Ask the host before joining again with a new name.',401);
    return row;
  }
  function view(sessionId:string,socket?:Socket):PlayerState{
    const session=getSession();if(!session||session.id!==sessionId)fail('This session ended or expired. Scan the current game QR code.',404);
    const players=roster(),self=players.find(p=>p.id===socket?.data.playerId)||null;
    return {attemptPolicy:currentPolicy(session),ownAttemptCount:scoring.attempts().filter(a=>a.clueId===session.currentClueId&&a.playerId===self?.id).length,buzzerMode:session.buzzerMode||'manual',sessionId:session.id,title:session.game.title,paused:session.paused,joiningOpen:session.joiningOpen,currentClueId:session.currentClueId,revealed:session.revealed,buzzer:structuredClone(session.buzzer),players,self,activeTab:Boolean(self&&active(self.id)===socket?.id),finished:session.finished,results:session.results,attempt:scoring.current(),serverNow:now(),round:session.round,dailyDouble:session.dailyDouble?{clueId:session.dailyDouble.clueId,playerId:session.dailyDouble.playerId,wager:session.dailyDouble.wager,revealed:session.dailyDouble.revealed}:null,final:rounds.publicFinal(),finalOwn:rounds.own(socket?.data.playerId)};
  }
  function publish(){
    const session=getSession();if(!session)return;
    for(const socket of io.sockets.sockets.values())if(socket.data.role==='player'&&socket.data.sessionId===session.id)socket.emit('player:state',view(session.id,socket));
  }
  function join(input:unknown):PlayerIdentity{
    const {sessionId,name}=joinSchema.parse(input),session=getSession();
    if(!session||session.id!==sessionId)fail('This join link expired. Scan the QR code for the active session.',404);
    if(session.finished)fail('This game has finished. Scan the QR code for a fresh session.',403);
    if(!session.joiningOpen)fail('Joining is closed. Ask the host to open joining.',403);
    const nameKey=name.toLocaleUpperCase('en-US').toLocaleLowerCase('en-US');
    if(store.db.prepare('SELECT id FROM session_players WHERE session_id=? AND name_key=?').get(sessionId,nameKey))fail('That name is already used in this session. Choose another name, such as your name plus an initial.',409);
    if((store.db.prepare('SELECT COUNT(*) AS n FROM session_players WHERE session_id=?').get(sessionId) as {n:number}).n>=64)fail('This session has reached its 64-player registration limit. Ask the host to start a fresh session.',409);
    const credential=randomBytes(32).toString('base64url'),id=crypto.randomUUID();
    transaction(()=>{store.db.prepare('INSERT INTO session_players (id,session_id,name,name_key,token_hash) VALUES (?,?,?,?,?)').run(id,sessionId,name,nameKey,hash(credential));session.revision++;});
    broadcast();return {sessionId,player:{id,name},credential};
  }
  function openWindow(session:LiveSession){
    session.buzzer.windowId=crypto.randomUUID();session.buzzer.attemptedIds=[];
    session.buzzer.open=roster().some(p=>p.connected&&!session.buzzer.excludedIds.includes(p.id));
  }
  function hostAction(a:HostAction):boolean{
    const session=getSession()!;
    if(a.type==='joining-open'||a.type==='joining-close'){if(a.type==='joining-open'&&(session.round!=='first'||session.game.categories.flatMap(c=>c.clues).every(q=>session.completed.includes(q.id))))fail('Joining permanently closes when the first board ends.');session.joiningOpen=a.type==='joining-open';}
    else if(a.type==='qr-show'||a.type==='qr-hide')session.showJoinQr=a.type==='qr-show';
    else if(a.type==='join-address'){
      if(!a.origin||!origins().includes(a.origin))fail('Choose one of this MacBook’s current network addresses. Player QR codes cannot use localhost.');
      session.joinOrigin=a.origin;
    }else if(a.type==='remove-player'){
      const row=store.db.prepare('SELECT id FROM session_players WHERE id=? AND session_id=? AND removed=0').get(a.playerId||'',session.id);if(!row)fail('This player has already been removed or is not in this session.');
      if(scoring.current()?.playerId===a.playerId)scoring.dismiss('Player removed');
      store.db.prepare('UPDATE session_players SET removed=1 WHERE id=?').run(a.playerId!);
      if(session.buzzer.winnerId===a.playerId){session.buzzer.winnerId=null;session.buzzer.open=false;session.buzzer.windowId=null;}
      // Invalidate sockets immediately. Their tokens can never reauthenticate.
      afterCommit(()=>{for(const id of tabs.get(a.playerId!)||[]){const socket=io.sockets.sockets.get(id);socket?.emit('player:invalid',{error:'The host removed this player. Ask the host before joining again with a new name.'});socket?.disconnect(true);}
      tabs.delete(a.playerId!);});
    }else if(['buzz-open','buzz-close','buzz-clear','buzz-exclude','eligibility-reset'].includes(a.type)){
      if(session.dailyDouble||session.round==='final')fail('Normal buzzers are disabled for Daily Doubles and Final Jeopardy.');
      if(!session.currentClueId||session.revealed||session.paused||session.finished||session.completed.includes(session.currentClueId))fail('Buzzing requires an open clue with its answer hidden and the session running.');
      const buzzer=session.buzzer;
      if(a.type==='buzz-open'){
        if(scoring.current()?.status==='pending')fail('Judge or dismiss the current response first.');
        if(buzzer.open)fail('Buzzing is already open.');
        if(buzzer.winnerId)fail('Clear the accidental winner or exclude that player before reopening.');
        if(!roster().some(p=>p.connected&&!buzzer.excludedIds.includes(p.id)))fail('No eligible connected players remain. Wait for a reconnect, reset eligibility, or finish without a winner.');
        openWindow(session);
      }else if(a.type==='buzz-close'){
        if(!buzzer.open)fail('Buzzing is already closed.');buzzer.open=false;
      }else if(a.type==='eligibility-reset'){scoring.dismiss('Eligibility reset');session.buzzer=emptyBuzzer(session.currentClueId);}
      else{
        if(!buzzer.winnerId)fail('There is no winning buzz to clear or exclude.');
        scoring.dismiss(a.type==='buzz-clear'?'Accidental buzz cleared':'Winner excluded without judgment');
        if(a.type==='buzz-exclude'&&!buzzer.excludedIds.includes(buzzer.winnerId))buzzer.excludedIds.push(buzzer.winnerId);
        buzzer.winnerId=null;openWindow(session);
      }
    }else return false;
    return true;
  }
  function buzz(socket:Socket,input:unknown){
    const parsed=buzzSchema.parse(input),session=getSession();
    const player=authenticate(socket.data.sessionId,socket.handshake.auth.token);
    if(socket.data.role!=='player'||active(player.id)!==socket.id)fail('Only the active buzzer tab for this player can buzz.',403);
    if(!session||parsed.sessionId!==session.id)fail('This session expired.',409);
    const buzzer=session.buzzer;
    if(parsed.windowId!==buzzer.windowId)fail('That buzzer window expired. Wait for the host to open buzzing again.',409);
    if(buzzer.attemptedIds.includes(player.id))fail('This player already buzzed in this window.',409);
    if(buzzer.excludedIds.includes(player.id))fail('You are ineligible for this clue.',403);
    if(session.dailyDouble||session.round==='final')fail('Normal buzzers are disabled for this special clue.');
    if(!session.currentClueId||session.paused||session.revealed||session.finished||session.completed.includes(session.currentClueId)||!buzzer.open||buzzer.winnerId)fail('Buzzing is closed. Early taps are never queued.',409);
    // Synchronous SQLite transaction + one event loop = exactly one accepted winner.
    transaction(()=>{buzzer.attemptedIds.push(player.id);buzzer.winnerId=player.id;buzzer.open=false;scoring.accept(player.id);session.revision++;});
    broadcast();
  }
  function register(socket:Socket){
    const id=socket.data.playerId;const set=tabs.get(id)||new Set<string>();set.add(socket.id);tabs.set(id,set);broadcast();
    socket.on('player:final',(input,ack)=>{
      if(typeof ack!=='function')return;
      try{authenticate(socket.data.sessionId,socket.handshake.auth.token);if(active(id)!==socket.id)fail('Use the active player tab to submit.',403);rounds.tick();rounds.submit(id,input);ack({ok:true});}
      catch(error){if(getSession()?.id===socket.data.sessionId)socket.emit('player:state',view(socket.data.sessionId,socket));ack({ok:false,error:error instanceof Error?error.message:'Submission rejected.'});}
    });
    socket.on('player:buzz',(input,ack)=>{
      if(typeof ack!=='function')return;
      try{buzz(socket,input);ack({ok:true});}
      catch(e){if(getSession()?.id===socket.data.sessionId)socket.emit('player:state',view(socket.data.sessionId,socket));ack({ok:false,error:e instanceof Error?e.message:'Buzz rejected.'});}
    });
    socket.on('disconnect',()=>{const set=tabs.get(id);set?.delete(socket.id);if(!set?.size)tabs.delete(id);broadcast();});
  }
  function end(){
    for(const socket of io.sockets.sockets.values())if(socket.data.role==='player'){socket.emit('player:invalid',{error:'This session ended. Scan the QR code for the next game.'});socket.disconnect(true);}
    tabs.clear(); // Historical players and ledger entries are retained across fresh sessions.
  }
  return {openWindow,roster,allPlayers,authenticate,view,publish,join,hostAction,register,end};
}
