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
async function fixture(timerSeconds:number|null=10,clock?:()=>number,mode:'manual'|'automatic'='manual',policy:'repeat'|'one'='repeat'){
  const directory=await mkdtemp(join(tmpdir(),'blueboard-scoring-'));const app=createApp(directory,{now:clock});app.server.listen(0,'0.0.0.0');await once(app.server,'listening');const root=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
  const legacyGame=app.store.get(app.store.list()[0].id)!;legacyGame.categories.forEach(c=>c.attemptPolicy=policy);app.store.write(legacyGame);app.live.start(legacyGame.id,timerSeconds,mode);const session=()=>app.live.hostState().session!,sid=session().id,token=app.live.setup(3000).hostToken!;const sockets:Socket[]=[];
  const host=(await connect(root,'host',token)).socket;sockets.push(host);
  async function player(name:string){const identity:PlayerIdentity=await(await fetch(root+'/api/player/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sid,name})})).json();const {socket}=await connect(root,'player',identity.credential,sid);sockets.push(socket);return {identity,socket};}
  const command=(type:ActionName,extra:Partial<HostAction>={})=>({sessionId:session().id,expectedRevision:session().revision,commandId:crypto.randomUUID(),type,...extra});
  async function act(type:ActionName,extra:Partial<HostAction>={}){const result=await host.timeout(3000).emitWithAck('host:action',command(type,extra));assert.equal(result.ok,true,result.error);}
  async function buzz(socket:Socket){const result=await socket.timeout(3000).emitWithAck('player:buzz',{sessionId:session().id,windowId:session().buzzer.windowId});assert.equal(result.ok,true,result.error);return app.live.scoring.current()!;}
  const clues=()=>session().game.categories.flatMap(c=>c.clues);
  return {...app,root,session,sid,token,host,player,command,act,buzz,clues,sockets,cleanup:async()=>{sockets.forEach(s=>s.disconnect());await new Promise<void>(resolve=>app.live.io.close(()=>resolve()));app.store.db.close();await rm(directory,{recursive:true,force:true});}};
}


test('automatic repeat attempts: four distinct attempts, atomic reveal, stale windows and concurrent judgments',async()=>{
 const f=await fixture(10,undefined,'automatic');try{
  const p=await f.player('Repeat'),q=f.clues()[0];await f.act('select',{clueId:q.id});assert.equal(f.session().buzzer.open,true);
  const ids:string[]=[],windows:string[]=[];
  for(let i=0;i<4;i++){
   const window=f.session().buzzer.windowId!;windows.push(window);const a=await f.buzz(p.socket);ids.push(a.id);assert.equal(a.timer.state,'running');assert.equal(a.status,'pending');
   const cmd=f.command(i===3?'judge-correct':'judge-incorrect',{attemptId:a.id});
   const results=await Promise.all([f.host.timeout(3000).emitWithAck('host:action',cmd),f.host.timeout(3000).emitWithAck('host:action',{...cmd,commandId:crypto.randomUUID()})]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal((await f.host.timeout(3000).emitWithAck('host:action',cmd)).ok,true);
   assert.equal(f.live.scoring.ledger().filter(e=>e.attemptId===a.id).length,1);
   assert.equal((await p.socket.timeout(3000).emitWithAck('player:buzz',{sessionId:f.sid,windowId:window})).ok,false,'old tap cannot enter a fresh window');
   assert.equal(f.session().revealed,i===3);assert.equal(f.session().buzzer.open,i!==3);assert.equal(f.session().buzzer.excludedIds.length,0);
  }
  assert.equal(new Set(ids).size,4);assert.equal(new Set(windows).size,4);assert.equal(f.live.scoring.score(p.identity.player.id),-400);assert.equal(f.live.scoring.current()!.timer.state,'stopped');assert.ok(f.session().completed.includes(q.id));assert.equal(f.live.publicState().session!.game.categories[0].clues[0].answer,q.answer);
  assert.equal((await f.host.timeout(3000).emitWithAck('host:action',f.command('judge-incorrect',{attemptId:ids[0]}))).ok,false);
  await f.act('judgment-correct',{attemptId:ids[3],outcome:'incorrect',reason:'Correction must not hide answer'});assert.equal(f.session().revealed,true);assert.equal(f.session().buzzer.open,false);
  await f.act('board');await f.act('reopen',{clueId:q.id});assert.equal(f.session().revealed,false);assert.equal(f.session().buzzer.open,true);assert.equal(f.live.scoring.current(),null);assert.equal(f.live.scoring.attempts().length,4);
 }finally{await f.cleanup();}
});

test('manual activation, explicit exclusions, mixed policies and no automatic reopening on reconnect',async()=>{
 const f=await fixture(10,undefined,'manual');try{
  const p=await f.player('Manual');await f.act('select',{clueId:f.clues()[0].id});assert.equal(f.session().buzzer.open,false);await f.act('buzz-open');const a=await f.buzz(p.socket);await f.act('judge-incorrect',{attemptId:a.id});assert.equal(f.session().buzzer.open,false);assert.deepEqual(f.session().buzzer.excludedIds,[]);await f.act('buzz-open');await f.buzz(p.socket);await f.act('buzz-exclude');assert.equal(f.session().buzzer.open,false);assert.deepEqual(f.session().buzzer.excludedIds,[p.identity.player.id]);await f.act('eligibility-reset');assert.deepEqual(f.session().buzzer.excludedIds,[]);await f.act('end');
  const g=f.store.get(f.store.list()[0].id)!;g.categories[1].attemptPolicy='one';g.doubleJeopardy={enabled:true,categories:structuredClone(g.categories).map(c=>({...c,id:crypto.randomUUID(),clues:c.clues.map(q=>({...q,id:crypto.randomUUID()}))}))};f.store.write(g);f.live.start(g.id,10,'automatic');const sid=f.session().id;const identity=f.live.players.join({sessionId:sid,name:'Mixed'});const c=await connect(f.root,'player',identity.credential,sid);f.sockets.push(c.socket);const h=await connect(f.root,'host',f.live.setup(3000).hostToken!);f.sockets.push(h.socket);
  async function act(type:ActionName,extra:Partial<HostAction>={}){const r=await h.socket.timeout(3000).emitWithAck('host:action',f.command(type,extra));assert.equal(r.ok,true,r.error);}
  await act('select',{clueId:g.categories[1].clues[0].id});assert.equal(f.session().buzzer.open,true);await f.buzz(c.socket);await act('judge-incorrect',{attemptId:f.live.scoring.current()!.id});assert.equal(f.session().buzzer.open,false);assert.deepEqual(f.session().buzzer.excludedIds,[identity.player.id]);await act('board');await act('select',{clueId:g.categories[0].clues[1].id});assert.equal(f.session().buzzer.open,true);await act('buzz-close');c.socket.disconnect();await new Promise(r=>setTimeout(r,20));const restored=await connect(f.root,'player',identity.credential,sid);f.sockets.push(restored.socket);assert.equal(f.session().buzzer.open,false,'reconnect does not undo manual close');
  await act('buzz-open');await f.buzz(restored.socket);restored.socket.disconnect();await new Promise(r=>setTimeout(r,20));await act('judge-incorrect',{attemptId:f.live.scoring.current()!.id});assert.equal(f.session().buzzer.open,false,'no eligible connected players');const again=await connect(f.root,'player',identity.credential,sid);f.sockets.push(again.socket);assert.equal(f.session().buzzer.open,false);await act('buzz-open');await act('finish-clue');await act('board');await act('skip-round');assert.equal(f.session().round,'double');assert.equal(f.session().game.categories[1].attemptPolicy,'one');await act('select',{clueId:g.doubleJeopardy.categories[1].clues[0].id});await f.buzz(again.socket);await act('judge-incorrect',{attemptId:f.live.scoring.current()!.id});assert.equal(f.session().buzzer.open,false);await act('end');assert.equal(f.session().buzzer.open,false);
 }finally{await f.cleanup();}
});

test('v5 policy migration preserves saved games and active history with legacy defaults',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blueboard-policy-migration-'));let app=createApp(directory);try{
  const g=app.store.get(app.store.list()[0].id)!;assert.equal(g.categories[0].attemptPolicy,'repeat');app.live.start(g.id);const state:any=structuredClone(app.live.hostState().session);delete state.buzzerMode;state.game.categories.forEach((c:any)=>delete c.attemptPolicy);app.store.db.prepare('UPDATE live_session SET state=?').run(JSON.stringify(state));app.store.db.exec('ALTER TABLE categories DROP COLUMN attempt_policy; PRAGMA user_version=5');const token=app.live.setup(3000).hostToken;await new Promise<void>(r=>app.live.io.close(()=>r()));app.store.db.close();app=createApp(directory);
  assert.equal((app.store.db.prepare('PRAGMA user_version').get() as any).user_version,7);assert.ok(app.store.get(g.id)!.categories.every(c=>c.attemptPolicy==='one'));assert.ok(app.live.hostState().session!.game.categories.every(c=>c.attemptPolicy==='one'));assert.equal(app.live.hostState().session!.buzzerMode,'manual');assert.equal(app.live.hostState().session!.id,state.id);assert.equal(app.live.setup(3000).hostToken,token);assert.equal(app.live.scoring.attempts().length,0);assert.equal(app.live.scoring.ledger().length,0);assert.equal(app.live.hostState().session!.buzzer.open,false);assert.equal(app.store.create('New').categories[0].attemptPolicy,'repeat');
 }finally{await new Promise<void>(r=>app.live.io.close(()=>r()));app.store.db.close();await rm(directory,{recursive:true,force:true});}
});

test('automatic session survives a real backend restart with answer visible, policy frozen and buzzing closed',{timeout:20000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'blueboard-auto-restart-'));let child:ChildProcess|undefined;const sockets:Socket[]=[];
 async function boot(){child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DATA_DIR:directory,PORT:'0'},stdio:['ignore','pipe','pipe']});child.stderr?.on('data',()=>{});return new Promise<string>((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);child!.stdout!.on('data',d=>{output+=d;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});child!.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited ${code}`));});});}
 async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}child=undefined;}
 try{
  let root=await boot();const games=await(await fetch(root+'/api/games')).json();let game=await(await fetch(root+'/api/games/'+games[0].id)).json();assert.equal(game.categories[0].attemptPolicy,'repeat');const setup=await(await fetch(root+'/api/live/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:game.id,buzzerMode:'automatic'})})).json();const sid=setup.session.id,token=setup.hostToken;
  const identity:PlayerIdentity=await(await fetch(root+'/api/player/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sid,name:'Persistent repeat'})})).json();let host=(await connect(root,'host',token)).socket,player=(await connect(root,'player',identity.credential,sid)).socket;sockets.push(host,player);
  const state=async()=>await(await fetch(root+'/api/live/host',{headers:{Authorization:`Bearer ${token}`}})).json();
  async function act(type:ActionName,extra:Partial<HostAction>={}){const s=await state();const cmd={sessionId:sid,expectedRevision:s.session.revision,commandId:crypto.randomUUID(),type,...extra};const r=await host.timeout(3000).emitWithAck('host:action',cmd);assert.equal(r.ok,true,r.error);return cmd;}
  await act('select',{clueId:game.categories[0].clues[0].id});await player.timeout(3000).emitWithAck('player:buzz',{sessionId:sid,windowId:(await state()).session.buzzer.windowId});const a=(await state()).attempt;const correct=await act('judge-correct',{attemptId:a.id});assert.equal((await state()).session.revealed,true);
  // Saved definitions may change, but the live policy is frozen.
  game.categories[0].attemptPolicy='one';const saved=await fetch(root+'/api/games/'+game.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(game)});assert.equal(saved.status,200);
  await stop();root=await boot();let s=await state();assert.equal(s.session.revealed,true);assert.equal(s.session.paused,true);assert.equal(s.session.buzzer.open,false);assert.equal(s.session.buzzerMode,'automatic');assert.equal(s.session.game.categories[0].attemptPolicy,'repeat');assert.equal(s.players[0].score,200);assert.equal(s.ledger.length,1);assert.equal(s.attempt.id,a.id);assert.equal(s.attempt.timer.state,'stopped');const pub=await(await fetch(root+'/api/live')).json();assert.equal(pub.session.game.categories[0].clues[0].answer,game.categories[0].clues[0].answer);
  host=(await connect(root,'host',token)).socket;player=(await connect(root,'player',identity.credential,sid)).socket;sockets.push(host,player);assert.equal((await host.timeout(3000).emitWithAck('host:action',correct)).ok,true);assert.equal((await state()).ledger.length,1);await act('resume');assert.equal((await state()).session.buzzer.open,false);await act('board');await act('select',{clueId:game.categories[0].clues[1].id});assert.equal((await state()).session.buzzer.open,true);await player.timeout(3000).emitWithAck('player:buzz',{sessionId:sid,windowId:(await state()).session.buzzer.windowId});const pending=(await state()).attempt;await stop();root=await boot();s=await state();assert.equal(s.session.buzzer.open,false);assert.equal(s.attempt.id,pending.id);assert.equal(s.attempt.timer.state,'paused');assert.equal(s.players[0].score,200);assert.equal(s.ledger.length,1);
 }finally{sockets.forEach(s=>s.disconnect());await stop();await rm(directory,{recursive:true,force:true});}
});
