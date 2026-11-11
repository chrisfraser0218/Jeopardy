import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import type { ActionName, HostAction, PlayerIdentity } from '../shared/live.js';

async function connect(root:string,role:string,token?:string,sessionId?:string){
  const socket=io(root,{auth:{role,token,sessionId},forceNew:true,reconnection:false});
  const initial=await new Promise<any>((resolve,reject)=>{socket.once(role==='player'?'player:state':'state',resolve);socket.once('connect_error',e=>{socket.disconnect();reject(e);});});return {socket,initial};
}
async function fixture(timerSeconds:number|null=10,clock?:()=>number){
  const directory=await mkdtemp(join(tmpdir(),'blueboard-scoring-'));const app=createApp(directory,{now:clock});app.server.listen(0,'0.0.0.0');await once(app.server,'listening');const root=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
  const legacyGame=app.store.get(app.store.list()[0].id)!;legacyGame.categories.forEach(c=>c.attemptPolicy='one');app.store.write(legacyGame);app.live.start(legacyGame.id,timerSeconds);const session=()=>app.live.hostState().session!,sid=session().id,token=app.live.setup(3000).hostToken!;const sockets:Socket[]=[];
  const host=(await connect(root,'host',token)).socket;sockets.push(host);
  async function player(name:string){const identity:PlayerIdentity=await(await fetch(root+'/api/player/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sid,name})})).json();const {socket}=await connect(root,'player',identity.credential,sid);sockets.push(socket);return {identity,socket};}
  const command=(type:ActionName,extra:Partial<HostAction>={})=>({sessionId:session().id,expectedRevision:session().revision,commandId:crypto.randomUUID(),type,...extra});
  async function act(type:ActionName,extra:Partial<HostAction>={}){const result=await host.timeout(3000).emitWithAck('host:action',command(type,extra));assert.equal(result.ok,true,result.error);}
  async function buzz(socket:Socket){const result=await socket.timeout(3000).emitWithAck('player:buzz',{sessionId:session().id,windowId:session().buzzer.windowId});assert.equal(result.ok,true,result.error);return app.live.scoring.current()!;}
  const clues=()=>session().game.categories.flatMap(c=>c.clues);
  return {...app,root,session,sid,token,host,player,command,act,buzz,clues,sockets,cleanup:async()=>{sockets.forEach(s=>s.disconnect());await new Promise<void>(resolve=>app.live.io.close(()=>resolve()));app.store.db.close();await rm(directory,{recursive:true,force:true});}};
}

test('atomic individual judgments, negative scores, append-only corrections, and retained final results',async()=>{
  const f=await fixture();try{
    assert.equal((await fetch(f.root+'/api/live/end',{method:'POST',headers:{'Content-Type':'application/json'}})).status,401);
    for(const timerSeconds of [0,121,1.5,-1])assert.equal((await fetch(f.root+'/api/live/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:f.store.list()[0].id,timerSeconds})})).status,400);
    const alice=await f.player('Alice'),bob=await f.player('Bob');const score=(id:string)=>f.live.scoring.score(id),first=f.clues()[0],second=f.clues()[1];
    await f.act('select',{clueId:first.id});await f.act('buzz-open');let a=await f.buzz(alice.socket);
    // Fail after the ledger insert: all judgment writes must roll back together.
    f.store.db.exec("CREATE TRIGGER reject_test_score BEFORE UPDATE OF status ON response_attempts WHEN NEW.status='correct' BEGIN SELECT RAISE(ABORT,'simulated disk write rejection'); END;");
    const before=f.session().revision;let result=await f.host.timeout(3000).emitWithAck('host:action',f.command('judge-correct',{attemptId:a.id}));assert.equal(result.ok,false);assert.equal(f.session().revision,before);assert.equal(f.live.scoring.current()!.status,'pending');assert.equal(score(alice.identity.player.id),0);assert.equal(f.live.scoring.ledger().length,0);assert.ok(!f.session().completed.includes(first.id));f.store.db.exec('DROP TRIGGER reject_test_score');
    await f.act('judge-incorrect',{attemptId:a.id});assert.equal(score(alice.identity.player.id),-first.value);assert.equal(f.session().buzzer.open,false);assert.ok(f.session().buzzer.excludedIds.includes(alice.identity.player.id));
    const oldAttempt=a.id;await f.act('buzz-open');a=await f.buzz(bob.socket);
    const host2=(await connect(f.root,'host',f.token)).socket;f.sockets.push(host2);
    const correct=f.command('judge-correct',{attemptId:a.id,amount:999999}),other={...correct,commandId:crypto.randomUUID()};
    const results=await Promise.all([f.host.timeout(3000).emitWithAck('host:action',correct),host2.timeout(3000).emitWithAck('host:action',other)]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(score(bob.identity.player.id),first.value);assert.equal(f.live.scoring.ledger().filter(e=>e.attemptId===a.id&&e.kind==='judgment').length,1);assert.ok(f.session().completed.includes(first.id));
    assert.equal((await f.host.timeout(3000).emitWithAck('host:action',results[0].ok?correct:other)).ok,true,'same command retry is a no-op');assert.equal(score(bob.identity.player.id),first.value);
    assert.equal(f.session().revealed,true);await f.act('board');await f.act('reopen',{clueId:first.id});result=await f.host.timeout(3000).emitWithAck('host:action',f.command('judge-correct',{attemptId:oldAttempt}));assert.equal(result.ok,false);assert.equal(score(alice.identity.player.id),-first.value);
    await f.act('finish-clue');await f.act('board');await f.act('select',{clueId:second.id});await f.act('buzz-open');a=await f.buzz(alice.socket);await f.act('judge-incorrect',{attemptId:a.id});await f.act('buzz-open');a=await f.buzz(bob.socket);await f.act('judge-incorrect',{attemptId:a.id});assert.equal(score(alice.identity.player.id),-first.value-second.value);assert.equal(score(bob.identity.player.id),first.value-second.value);
    result=await f.host.timeout(3000).emitWithAck('host:action',f.command('buzz-open'));assert.equal(result.ok,false,'everyone excluded');await f.act('finish-clue');assert.ok(f.session().completed.includes(second.id));
    const original=f.live.scoring.ledger().find(e=>e.attemptId===oldAttempt)!;const progress=structuredClone(f.session().completed),exclusions=[...f.session().buzzer.excludedIds];await f.act('judgment-correct',{attemptId:oldAttempt,outcome:'correct',reason:'Host misheard the response'});const history=f.live.scoring.ledger();assert.ok(history.some(e=>e.id===original.id));assert.deepEqual(history.slice(-2).map(e=>e.kind),['reversal','correction']);assert.equal(score(alice.identity.player.id),first.value-second.value);assert.deepEqual(f.session().completed,progress);assert.deepEqual(f.session().buzzer.excludedIds,exclusions,'correction never resets gameplay');
    await f.act('judgment-correct',{attemptId:oldAttempt,outcome:'dismissed',reason:'Remove the judgment from the total'});assert.equal(score(alice.identity.player.id),-second.value);assert.equal(f.live.scoring.ledger().length,8);
    for(const extra of [{amount:1.5,reason:'fraction'},{amount:0,reason:'zero'},{amount:25,reason:' '},{amount:1000001,reason:'too large'}])assert.equal((await f.host.timeout(3000).emitWithAck('host:action',f.command('score-adjust',{playerId:alice.identity.player.id,...extra}))).ok,false);
    await f.act('score-adjust',{playerId:alice.identity.player.id,amount:-25,reason:'Manual correction'});assert.equal(score(alice.identity.player.id),-second.value-25);
    const late=await f.player('Late arrival');assert.equal(score(late.identity.player.id),0);
    await f.act('score-adjust',{playerId:late.identity.player.id,amount:999,reason:'Retain removed history'});await f.act('remove-player',{playerId:late.identity.player.id});assert.equal(score(late.identity.player.id),999);assert.ok(f.live.scoring.ledger().some(e=>e.playerId===late.identity.player.id));
    bob.socket.disconnect();await new Promise(r=>setTimeout(r,20));await f.act('score-adjust',{playerId:bob.identity.player.id,amount:25,reason:'Disconnected correction'});const restored=await connect(f.root,'player',bob.identity.credential,f.sid);f.sockets.push(restored.socket);assert.equal(restored.initial.self.score,first.value-second.value+25);
    // Unauthorized roles cannot judge, adjust, or control timers.
    const display=(await connect(f.root,'display')).socket;f.sockets.push(display);for(const socket of [display,alice.socket])for(const type of ['judge-correct','score-adjust','timer-pause','end'] as const)assert.equal((await socket.timeout(3000).emitWithAck('host:action',f.command(type,{attemptId:a.id,playerId:alice.identity.player.id,amount:1,reason:'unauthorized'}))).ok,false);
    assert.equal((await f.host.timeout(3000).emitWithAck('host:action',f.command('finish-game'))).ok,false);
    // Tie the active players, then end early. Removed players must not rank.
    const difference=score(bob.identity.player.id)-score(alice.identity.player.id);await f.act('score-adjust',{playerId:alice.identity.player.id,amount:difference,reason:'Tie for result coverage'});await f.act('end');assert.equal(f.session().results!.reason,'early');assert.deepEqual(f.session().results!.standings.map(p=>p.rank),[1,1]);assert.equal(f.session().results!.standings.length,2);assert.equal(f.session().buzzer.open,false);assert.equal(f.live.scoring.current()!.timer.state==='running',false);
    const count=(f.store.db.prepare('SELECT COUNT(*) AS n FROM score_ledger').get() as {n:number}).n;const saved=f.store.get(f.store.list()[0].id)!;const oldSid=f.sid;
    f.live.start(saved.id,null);assert.equal(f.session().finished,false);assert.equal(f.session().completed.length,0);assert.equal(f.live.scoring.attempts().length,0);assert.equal(f.live.scoring.ledger().length,0);assert.equal((f.store.db.prepare('SELECT COUNT(*) AS n FROM score_ledger').get() as {n:number}).n,count);assert.ok(f.store.db.prepare('SELECT id FROM session_players WHERE id=?').get(late.identity.player.id));assert.ok(f.store.db.prepare('SELECT session_id FROM session_results WHERE session_id=?').get(oldSid));assert.deepEqual(f.store.get(saved.id),saved);
  }finally{await f.cleanup();}
});

test('server deadlines, pause/resume, timeout without deductions, disabled timers and stale events',async()=>{
  let clock=1_900_000_000_000;const f=await fixture(10,()=>clock);try{
    const a=await f.player('A'),b=await f.player('B');await f.act('select',{clueId:f.clues()[0].id});await f.act('buzz-open');let attempt=await f.buzz(a.socket);const firstDeadline=attempt.timer.deadline!;assert.equal(firstDeadline,clock+10000);
    clock+=3000;await f.act('timer-pause',{attemptId:attempt.id});assert.equal(f.live.scoring.current()!.timer.remainingMs,7000);clock+=5000;f.live.scoring.tick();assert.equal(f.live.scoring.current()!.timer.state,'paused');await f.act('timer-resume',{attemptId:attempt.id});assert.equal(f.live.scoring.current()!.timer.deadline,clock+7000);assert.equal(f.live.scoring.expire(attempt.id,firstDeadline),false,'obsolete deadline ignored');
    const activeDeadline=f.live.scoring.current()!.timer.deadline!;clock=activeDeadline+1;f.live.scoring.tick();assert.equal(f.live.scoring.current()!.timer.state,'expired');assert.equal(f.live.scoring.current()!.status,'pending');assert.equal(f.live.scoring.score(a.identity.player.id),0);assert.equal(f.live.scoring.ledger().length,0);const revision=f.session().revision;f.live.scoring.tick();assert.equal(f.session().revision,revision,'timeout processed once');
    await f.act('judge-incorrect',{attemptId:attempt.id});assert.equal(f.live.scoring.score(a.identity.player.id),-f.clues()[0].value);await f.act('buzz-open');attempt=await f.buzz(b.socket);assert.equal(f.live.scoring.expire(f.live.scoring.attempts()[0].id,activeDeadline),false,'old attempt cannot expire new response');
    await f.act('dismiss-attempt',{attemptId:attempt.id});assert.equal(f.live.scoring.score(b.identity.player.id),0);assert.equal(f.session().buzzer.open,false);assert.equal(f.live.scoring.current()!.status,'dismissed');await f.act('finish-clue');await f.act('board');assert.equal(f.live.scoring.expire(attempt.id,attempt.timer.deadline!),false);
    await f.act('end');f.live.start(f.store.list()[0].id,null);const sid=f.session().id;const identity=f.live.players.join({sessionId:sid,name:'Timer off'});const connection=await connect(f.root,'player',identity.credential,sid);f.sockets.push(connection.socket);const token=f.live.setup(3000).hostToken!;const host=(await connect(f.root,'host',token)).socket;f.sockets.push(host);
    async function offAction(type:ActionName,extra:Partial<HostAction>={}){const r=await host.timeout(3000).emitWithAck('host:action',f.command(type,extra));assert.equal(r.ok,true,r.error);}
    await offAction('select',{clueId:f.clues()[0].id});await offAction('buzz-open');const r=await connection.socket.timeout(3000).emitWithAck('player:buzz',{sessionId:sid,windowId:f.session().buzzer.windowId});assert.equal(r.ok,true);assert.equal(f.live.scoring.current()!.timer.state,'disabled');clock+=999999;f.live.scoring.tick();assert.equal(f.live.scoring.current()!.status,'pending');
  }finally{await f.cleanup();}
});

test('real restart restores scores, ledger, pending timer paused, and durable corrected final standings', {timeout:20000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'blueboard-score-restart-'));let child:ChildProcess|undefined;const sockets:Socket[]=[];
  async function boot(){child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DATA_DIR:directory,PORT:'0'},stdio:['ignore','pipe','pipe']});child.stderr?.on('data',()=>{});return new Promise<string>((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(new Error('Server startup timeout')),10000);child!.stdout!.on('data',d=>{text+=d;const match=text.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`);}});child!.once('exit',c=>{clearTimeout(timeout);reject(new Error(`Backend exited ${c}`));});});}
  async function stop(){if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}child=undefined;}
  try{
    let root=await boot();const game=(await(await fetch(root+'/api/games')).json())[0];const setup=await(await fetch(root+'/api/live/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:game.id,timerSeconds:10})})).json();const sid=setup.session.id,token=setup.hostToken;
    const identity:PlayerIdentity=await(await fetch(root+'/api/player/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sid,name:'Persistent player'})})).json();let player=(await connect(root,'player',identity.credential,sid)).socket,host=(await connect(root,'host',token)).socket;sockets.push(player,host);
    const state=async()=>await(await fetch(root+'/api/live/host',{headers:{Authorization:`Bearer ${token}`}})).json();
    async function act(type:ActionName,extra:Partial<HostAction>={}){const s=await state();const r=await host.timeout(3000).emitWithAck('host:action',{sessionId:sid,expectedRevision:s.session.revision,commandId:crypto.randomUUID(),type,...extra});assert.equal(r.ok,true,r.error);}
    const clues=(await state()).session.game.categories.flatMap((c:any)=>c.clues);await act('select',{clueId:clues[0].id});await act('buzz-open');await player.timeout(3000).emitWithAck('player:buzz',{sessionId:sid,windowId:(await state()).session.buzzer.windowId});const judged=(await state()).attempt.id;await act('judge-correct',{attemptId:judged});await act('board');await act('select',{clueId:clues[1].id});await act('buzz-open');await player.timeout(3000).emitWithAck('player:buzz',{sessionId:sid,windowId:(await state()).session.buzzer.windowId});const pending=(await state()).attempt;await stop();root=await boot();
    let recovered=await state();assert.equal(recovered.players[0].score,clues[0].value);assert.equal(recovered.ledger.length,1);assert.equal(recovered.session.paused,true);assert.equal(recovered.session.buzzer.open,false);assert.equal(recovered.attempt.id,pending.id);assert.equal(recovered.attempt.timer.state,'paused');assert.equal(recovered.attempt.timer.deadline,null);assert.ok(recovered.attempt.timer.remainingMs>0&&recovered.attempt.timer.remainingMs<=10000);
    const restored=await connect(root,'player',identity.credential,sid);player=restored.socket;host=(await connect(root,'host',token)).socket;sockets.push(player,host);assert.equal(restored.initial.self.score,clues[0].value);await act('resume');assert.equal((await state()).attempt.timer.state,'paused');await act('timer-resume',{attemptId:pending.id});assert.equal((await state()).attempt.timer.state,'running');await act('judge-incorrect',{attemptId:pending.id});await act('judgment-correct',{attemptId:pending.id,outcome:'correct',reason:'Restart correction'});await act('end');const final=await state();assert.equal(final.session.finished,true);assert.equal(final.players[0].score,clues[0].value+clues[1].value);assert.equal(final.ledger.length,4);await stop();root=await boot();recovered=await state();assert.equal(recovered.session.finished,true);assert.equal(recovered.session.paused,false);assert.deepEqual(recovered.session.results,final.session.results);assert.equal(recovered.ledger.length,4);
  }finally{sockets.forEach(s=>s.disconnect());await stop();await rm(directory,{recursive:true,force:true});}
});

test('v3 migration initializes zero scores and a paused unresolved legacy winner without inventing judgments',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'blueboard-v3-score-upgrade-'));
  try{
    const old=createApp(directory);old.live.start(old.store.list()[0].id);const sid=old.live.hostState().session!.id;const person=old.live.players.join({sessionId:sid,name:'Legacy player'});const game=old.store.get(old.store.list()[0].id)!;
    old.live.action({sessionId:sid,expectedRevision:old.live.hostState().session!.revision,commandId:crypto.randomUUID(),type:'select',clueId:game.categories[0].clues[0].id});
    const legacy:any=structuredClone(old.live.hostState().session);legacy.buzzer.winnerId=person.player.id;
    for(const field of ['timerSeconds','currentAttemptId','finished','results'])delete legacy[field];
    old.store.db.prepare('UPDATE live_session SET state=? WHERE slot=1').run(JSON.stringify(legacy));old.store.db.exec('DROP TABLE score_ledger; DROP TABLE response_attempts; DROP TABLE session_results; PRAGMA user_version=3;');await new Promise<void>(resolve=>old.live.io.close(()=>resolve()));old.store.db.close();
    const upgraded=createApp(directory);
    try{assert.deepEqual(upgraded.store.get(game.id),game);const current=upgraded.live.hostState();assert.equal(current.session!.id,sid);assert.equal(current.players[0].score,0);assert.equal(current.ledger!.length,0);assert.equal(current.attempt!.status,'pending');assert.equal(current.attempt!.timer.state,'paused');assert.equal(current.session!.buzzer.open,false);assert.equal(current.session!.paused,true);assert.equal(upgraded.live.players.authenticate(sid,person.credential).id,person.player.id);}
    finally{await new Promise<void>(resolve=>upgraded.live.io.close(()=>resolve()));upgraded.store.db.close();}
  }finally{await rm(directory,{recursive:true,force:true});}
});
