import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import type { ActionName, HostAction, PlayerIdentity, PlayerState } from '../shared/live.js';

async function socketAt(root:string,role:string,token?:string,sessionId?:string){
  const socket=io(root,{auth:{role,token,sessionId},forceNew:true,reconnection:false});
  let snapshot:any;
  await new Promise<void>((resolve,reject)=>{socket.once(role==='player'?'player:state':'state',s=>{snapshot=s;resolve();});socket.once('connect_error',e=>{socket.disconnect();reject(e);});});
  return {socket,snapshot};
}
async function waitFor(fn:()=>boolean){for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Player state did not synchronize.');}

test('joining, private identity, concurrent winners, eligibility, removal, and session expiry', {timeout:30000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'blueboard-players-'));
  const {store,live,server}=createApp(directory);server.listen(0,'0.0.0.0');await once(server,'listening');
  const root=`http://127.0.0.1:${(server.address() as {port:number}).port}`,sockets:Socket[]=[];
  try{
    const game=store.list()[0];live.start(game.id);const setup=live.setup((server.address() as {port:number}).port),sid=setup.session!.id;
    const host=(await socketAt(root,'host',setup.hostToken!)).socket;sockets.push(host);
    const command=(type:ActionName,extra:Partial<HostAction>={})=>({sessionId:sid,expectedRevision:live.hostState().session!.revision,commandId:crypto.randomUUID(),type,...extra});
    async function act(type:ActionName,extra:Partial<HostAction>={}){const r=await host.timeout(3000).emitWithAck('host:action',command(type,extra));assert.equal(r.ok,true,r.error);}
    async function joinName(name:string,sessionId=sid){return fetch(root+'/api/player/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,name})});}
    assert.equal((await joinName('   ')).status,400);assert.equal((await joinName('a'.repeat(25))).status,400);assert.equal((await joinName('bad\nname')).status,400);
    const alice:PlayerIdentity=await(await joinName('  Alice  ')).json();assert.equal(alice.player.name,'Alice');assert.ok(alice.credential.length>=43);
    assert.equal((await joinName(' ALICE ')).status,409);assert.equal((await joinName('alice')).status,409);
    const bob:PlayerIdentity=await(await joinName('Bob')).json();const literal:PlayerIdentity=await(await joinName('<b>Eve</b>')).json();
    const players=[alice,bob,literal];for(let i=0;i<5;i++)players.push(await(await joinName(`Racer ${i+1}`)).json());
    const identities=players.map(p=>p.credential);
    const stored=JSON.stringify(store.db.prepare('SELECT * FROM session_players').all());for(const credential of identities)assert.ok(!stored.includes(credential),'only hashes are stored');
    const publicJSON=JSON.stringify(live.publicState());assert.ok(!publicJSON.includes(setup.hostToken!));for(const credential of identities)assert.ok(!publicJSON.includes(credential));
    await assert.rejects(socketAt(root,'player','Alice',sid),/credential/);await assert.rejects(socketAt(root,'player',alice.credential,crypto.randomUUID()),/expired/);
    const playerSockets:Socket[]=[];const states:PlayerState[]=[];
    for(const identity of players){const c=await socketAt(root,'player',identity.credential,sid);sockets.push(c.socket);playerSockets.push(c.socket);states.push(c.snapshot);c.socket.on('player:state',s=>{states[players.indexOf(identity)]=s;});}
    const observer=await socketAt(root,'player',alice.credential,sid);sockets.push(observer.socket);assert.equal(observer.snapshot.activeTab,false);
    for(const origin of ['http://localhost:3000','http://127.0.0.1:3000','http://example.com:3000']){const rejected=await host.timeout(3000).emitWithAck('host:action',command('join-address',{origin}));assert.equal(rejected.ok,false,'QR address must be a detected non-loopback interface');}
    if(live.hostState().joinOrigins?.length)await act('join-address',{origin:live.hostState().joinOrigins![0]});
    await act('joining-close');assert.equal((await joinName('Late arrival')).status,403);
    const reconnect=await socketAt(root,'player',bob.credential,sid);sockets.push(reconnect.socket);assert.equal(reconnect.snapshot.self.id,bob.player.id,'closed joining permits identity restore');
    await act('joining-open');assert.equal((await joinName('Later')).status,201);
    const first=live.hostState().session!.game.categories[0].clues[0].id,second=live.hostState().session!.game.categories[0].clues[1].id;
    let rejected=await host.timeout(3000).emitWithAck('host:action',command('buzz-open'));assert.equal(rejected.ok,false);
    await act('select',{clueId:first});assert.equal(live.publicState().session!.buzzer.open,false);
    const attempt=(socket:Socket,windowId:string,extra:Record<string,unknown>={})=>socket.timeout(3000).emitWithAck('player:buzz',{sessionId:sid,windowId,...extra});
    assert.equal((await attempt(playerSockets[0],crypto.randomUUID())).ok,false,'early attempt rejected');
    const display=(await socketAt(root,'display')).socket;sockets.push(display);assert.equal((await attempt(display,crypto.randomUUID())).ok,false,'display cannot buzz');
    await act('buzz-open');let windowId=live.publicState().session!.buzzer.windowId!;
    assert.equal((await attempt(observer.socket,windowId)).ok,false,'observer tab cannot provide a second buzzer');
    assert.equal((await attempt(playerSockets[0],windowId,{timestamp:0})).ok,false,'client timestamps not accepted');
    const previous=windowId;await act('buzz-close');assert.equal((await attempt(playerSockets[0],previous)).ok,false,'closed taps are rejected, not queued');await act('buzz-open');windowId=live.publicState().session!.buzzer.windowId!;assert.notEqual(windowId,previous);assert.equal(live.publicState().session!.buzzer.winnerId,null);
    assert.equal((await attempt(playerSockets[0],previous)).ok,false,'old window cannot win');
    // Ten rounds of eight clients racing: exactly one successful acknowledgment per window.
    for(let round=0;round<10;round++){
      if(round)await act('buzz-clear');
      windowId=live.publicState().session!.buzzer.windowId!;
      const results=await Promise.all(playerSockets.map(s=>attempt(s,windowId)));
      assert.equal(results.filter(r=>r.ok).length,1,`exactly one winner in race ${round+1}`);
      const winner=live.publicState().session!.buzzer.winnerId;assert.ok(winner);assert.equal(live.publicState().session!.buzzer.open,false);
      assert.equal((await attempt(playerSockets[players.findIndex(p=>p.player.id===winner)],windowId)).ok,false,'repeated taps rejected');
    }
    // Clear is accidental: winner stays eligible. Exclude persists over later windows.
    const cleared=live.publicState().session!.buzzer.winnerId!;await act('buzz-clear');assert.ok(!live.publicState().session!.buzzer.excludedIds.includes(cleared));
    await attempt(playerSockets[0],live.publicState().session!.buzzer.windowId!);await act('buzz-exclude');assert.ok(live.publicState().session!.buzzer.excludedIds.includes(alice.player.id));
    assert.equal((await attempt(playerSockets[0],live.publicState().session!.buzzer.windowId!)).ok,false,'excluded across windows');
    assert.equal((await attempt(playerSockets[1],live.publicState().session!.buzzer.windowId!)).ok,true);await act('buzz-clear');assert.ok(live.publicState().session!.buzzer.excludedIds.includes(alice.player.id));
    await act('buzz-close');await act('buzz-open');assert.ok(live.publicState().session!.buzzer.excludedIds.includes(alice.player.id));
    await act('eligibility-reset');assert.deepEqual(live.publicState().session!.buzzer.excludedIds,[]);assert.equal(live.publicState().session!.buzzer.open,false);
    await act('buzz-open');await attempt(playerSockets[0],live.publicState().session!.buzzer.windowId!);await act('buzz-exclude');await act('board');await act('select',{clueId:first});assert.ok(live.publicState().session!.buzzer.excludedIds.includes(alice.player.id),'same clue keeps exclusions');
    await act('board');await act('select',{clueId:second});assert.deepEqual(live.publicState().session!.buzzer.excludedIds,[],'another clue resets eligibility');
    await act('buzz-open');await act('reveal');assert.equal(live.publicState().session!.buzzer.open,false);assert.equal((await attempt(playerSockets[0],live.publicState().session!.buzzer.windowId!)).ok,false,'answer reveal closes buzzing');
    const playerJSON=JSON.stringify(await(await fetch(root+`/api/player/session/${sid}`)).json());assert.ok(!playerJSON.includes('answer'));assert.ok(!playerJSON.includes(setup.hostToken!));for(const credential of identities)assert.ok(!playerJSON.includes(credential));assert.ok(!JSON.stringify(states).includes('"answer":'));
    const invalid=new Promise<string>(resolve=>playerSockets[0].once('player:invalid',m=>resolve(m.error)));await act('remove-player',{playerId:alice.player.id});assert.match(await invalid,/removed/);await assert.rejects(socketAt(root,'player',alice.credential,sid),/removed/);
    // Observer promotion on original tab disconnect still leaves one attempt per identity/window.
    playerSockets[1].disconnect();let promoted:PlayerState=reconnect.snapshot;reconnect.socket.on('player:state',s=>{promoted=s;});await waitFor(()=>promoted.activeTab);
    await act('board');await act('select',{clueId:first});await act('buzz-open');assert.equal((await attempt(reconnect.socket,live.publicState().session!.buzzer.windowId!)).ok,true);
    await act('complete');assert.equal(live.publicState().session!.buzzer.open,false);
    live.endLocal();assert.equal((await joinName('New')).status,404);await assert.rejects(socketAt(root,'player',bob.credential,sid),/expired/);
    live.start(game.id);assert.equal(live.publicState().players.length,0);assert.equal((await joinName('New',sid)).status,404);await assert.rejects(socketAt(root,'player',bob.credential,live.publicState().session!.id),/invalid/);
  }finally{sockets.forEach(s=>s.disconnect());await new Promise<void>(resolve=>live.io.close(()=>resolve()));store.db.close();await rm(directory,{recursive:true,force:true});}
});

test('real restart preserves credentials, exclusions, and winner while closing buzzing and preserving game progress', {timeout:20000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'blueboard-player-restart-'));let child:ChildProcess|undefined;const sockets:Socket[]=[];
  async function boot(){child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DATA_DIR:directory,PORT:'0'},stdio:['ignore','pipe','pipe']});child.stderr?.on('data',()=>{});return new Promise<string>((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Restart timeout')),10000);child!.stdout!.on('data',d=>{text+=d;const match=text.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});child!.once('exit',c=>{clearTimeout(timer);reject(new Error(`Backend exited ${c}`));});});}
  async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}child=undefined;}
  try{
    let root=await boot();const games=await(await fetch(root+'/api/games')).json();const setup=await(await fetch(root+'/api/live/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:games[0].id})})).json();const sid=setup.session.id,token=setup.hostToken;
    const joinName=async(name:string)=>await(await fetch(root+'/api/player/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sid,name})})).json() as PlayerIdentity;
    const alice=await joinName('Alice'),bob=await joinName('Bob'),removed=await joinName('Removed player');let host=(await socketAt(root,'host',token)).socket;sockets.push(host);const a=(await socketAt(root,'player',alice.credential,sid)).socket,b=(await socketAt(root,'player',bob.credential,sid)).socket;sockets.push(a,b);
    const state=async()=>await(await fetch(root+'/api/live/host',{headers:{Authorization:`Bearer ${token}`}})).json();
    async function act(type:ActionName,extra:Partial<HostAction>={}){const s=(await state()).session;const result=await host.timeout(3000).emitWithAck('host:action',{sessionId:sid,expectedRevision:s.revision,commandId:crypto.randomUUID(),type,...extra});assert.equal(result.ok,true,result.error);}
    await act('remove-player',{playerId:removed.player.id});
    await act('select',{clueId:(await state()).session.game.categories[0].clues[0].id});await act('buzz-open');let windowId=(await state()).session.buzzer.windowId;assert.equal((await a.timeout(3000).emitWithAck('player:buzz',{sessionId:sid,windowId})).ok,true);await act('buzz-exclude');windowId=(await state()).session.buzzer.windowId;assert.equal((await b.timeout(3000).emitWithAck('player:buzz',{sessionId:sid,windowId})).ok,true);
    const before=(await state()).session;await stop();root=await boot();let recovered=await state();assert.equal(recovered.session.paused,true);assert.equal(recovered.session.buzzer.open,false);assert.equal(recovered.session.buzzer.windowId,null);assert.equal(recovered.session.buzzer.winnerId,bob.player.id);assert.deepEqual(recovered.session.buzzer.excludedIds,[alice.player.id]);assert.equal(recovered.session.currentClueId,before.currentClueId);assert.equal(recovered.players.length,2);assert.ok(recovered.players.every((p:any)=>!p.connected));assert.equal(recovered.audio.playback,'stopped');
    await assert.rejects(socketAt(root,'player',removed.credential,sid),/removed/);
    const restored=await socketAt(root,'player',bob.credential,sid);sockets.push(restored.socket);assert.equal(restored.snapshot.self.id,bob.player.id);assert.equal(restored.snapshot.buzzer.open,false);
    host=(await socketAt(root,'host',token)).socket;sockets.push(host);await act('resume');recovered=await state();assert.equal(recovered.session.buzzer.open,false);assert.equal(recovered.session.buzzer.winnerId,bob.player.id);
    assert.equal((await restored.socket.timeout(3000).emitWithAck('player:buzz',{sessionId:sid,windowId})).ok,false,'pre-restart window cannot buzz');
    await act('buzz-clear');const openWindow=(await state()).session.buzzer.windowId;await stop();root=await boot();recovered=await state();assert.equal(recovered.session.buzzer.open,false,'an open window must also close on restart');assert.notEqual(recovered.session.buzzer.windowId,openWindow);assert.deepEqual(recovered.session.buzzer.excludedIds,[alice.player.id]);
  }finally{sockets.forEach(s=>s.disconnect());await stop();await rm(directory,{recursive:true,force:true});}
});

test('Phase 2 active-session migration preserves saved data, credentials, and current clue',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'blueboard-v2-upgrade-'));
  try{
    const old=createApp(directory);const game=old.store.get(old.store.list()[0].id)!;old.live.start(game.id);
    const before=old.live.hostState().session!;old.live.action({sessionId:before.id,expectedRevision:before.revision,commandId:crypto.randomUUID(),type:'select',clueId:game.categories[0].clues[0].id});
    const token=old.live.setup(3000).hostToken;const legacy:any=structuredClone(old.live.hostState().session);
    for(const key of ['joiningOpen','joinOrigin','showJoinQr','buzzer'])delete legacy[key];
    old.store.db.prepare('UPDATE live_session SET state=? WHERE slot=1').run(JSON.stringify(legacy));old.store.db.exec('DROP TABLE session_players; PRAGMA user_version=2;');await new Promise<void>(resolve=>old.live.io.close(()=>resolve()));old.store.db.close();
    const upgraded=createApp(directory);
    try{const current=upgraded.live.hostState().session!;assert.deepEqual(upgraded.store.get(game.id),game);assert.equal(current.id,legacy.id);assert.equal(current.currentClueId,legacy.currentClueId);assert.equal(upgraded.live.setup(3000).hostToken,token);assert.equal(current.paused,true);assert.equal(current.buzzer.open,false);assert.deepEqual(upgraded.live.publicState().players,[]);}
    finally{await new Promise<void>(resolve=>upgraded.live.io.close(()=>resolve()));upgraded.store.db.close();}
  }finally{await rm(directory,{recursive:true,force:true});}
});
