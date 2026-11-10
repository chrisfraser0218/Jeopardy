import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { openStore } from '../server/db.js';
import type { HostAction, LiveState, Setup, AudioCommand } from '../shared/live.js';
import type { Game } from '../shared/model.js';
import { png, wav } from './fixtures.js';

async function connected(url:string,role='display',token?:string){
  const socket=io(url,{auth:{role,token},forceNew:true,reconnection:false});
  await new Promise<void>((resolve,reject)=>{socket.once('state',()=>resolve());socket.once('connect_error',e=>{socket.disconnect();reject(e);});});return socket;
}
async function result(socket:Socket,action:HostAction):Promise<{ok:boolean;error?:string}>{return socket.timeout(3000).emitWithAck('host:action',action);}
async function until(fn:()=>boolean){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('State did not synchronize');}

test('live session authority, privacy, snapshot isolation, commands, and audio ownership',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'blueboard-live-'));
  const {app,store,server,live}=createApp(directory);server.listen(0,'0.0.0.0');await once(server,'listening');
  const port=(server.address() as {port:number}).port,root=`http://127.0.0.1:${port}`;
  const sockets:Socket[]=[];
  const req=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>fetch(root+'/api'+path,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
  try{
    const draft=store.create('Incomplete');let response=await req('/live/start','POST',{gameId:draft.id});assert.equal(response.status,400);assert.match((await response.json()).error,/Category 1, clue 1/);
    let game=store.get(store.list().find(g=>g.sample)!.id)!;
    const hiddenAnswers=game.categories.flatMap(c=>c.clues.map(q=>q.answer));
    async function upload(buffer:Buffer,name:string){const form=new FormData();form.append('file',new Blob([new Uint8Array(buffer)]),name);return(await(await fetch(root+'/api/media',{method:'POST',body:form})).json()).id as string;}
    game.categories[0].clues[0].imageId=await upload(png,'photo.png');game.categories[0].clues[0].audioId=await upload(wav(),'sound.wav');
    game=store.write(game);
    const unnamed=structuredClone(game);unnamed.categories[0].name='';store.write(unnamed);assert.equal((await req('/live/start','POST',{gameId:game.id})).status,400);game=store.get(game.id)!;game.categories[0].name='Kitchen science';game=store.write(game);
    response=await req('/live/start','POST',{gameId:game.id});assert.equal(response.status,201);const setup:Setup=await response.json();const token=setup.hostToken!;assert.ok(token.length>=43);
    assert.equal((await req('/live/start','POST',{gameId:game.id})).status,409);
    assert.equal((await req('/live/host')).status,401);assert.equal((await req('/live/host','GET',undefined,{Authorization:'Bearer wrong'})).status,401);
    assert.equal((await req('/live/host','GET',undefined,{Authorization:`Bearer ${token}`})).status,200);
    // A hostile Host header is rejected even on a loopback socket (DNS-rebinding defense).
    const hostileStatus=await new Promise<number>(resolve=>{httpRequest(root+'/api/games',{headers:{Host:`192.0.2.1:${port}`}},res=>{res.resume();resolve(res.statusCode!);}).end();});assert.equal(hostileStatus,403);
    const lan=Object.values(networkInterfaces()).flat().find(i=>i?.family==='IPv4'&&!i.internal);
    if(lan){
      const lanRoot=`http://${lan.address}:${port}`;
      for(const path of ['/api/games','/api/live/setup'])assert.equal((await fetch(lanRoot+path)).status,403);
      assert.equal((await fetch(lanRoot+'/api/live/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:game.id})})).status,403);
      assert.equal((await fetch(lanRoot+'/api/media',{method:'POST'})).status,403);
      assert.equal((await fetch(lanRoot+`/api/media/${game.categories[0].clues[0].imageId}`)).status,200);
      const other=await upload(png,'unused.png');assert.equal((await fetch(lanRoot+`/api/media/${other}`)).status,403);
      assert.equal((await fetch(lanRoot+'/api/live/host')).status,401);
    }
    await assert.rejects(connected(root,'host','wrong'),/Host link/);
    const display=await connected(root),host=await connected(root,'host',token),display2=await connected(root);sockets.push(display,host,display2);
    let displayState=live.publicState();display.on('state',(s:LiveState)=>{displayState=s;});
    const packets:AudioCommand[]=[];display.on('audio:command',p=>packets.push(p));
    let stops=0;display.on('audio:stop',()=>stops++);
    const snapshot=()=>live.hostState().session!;
    const command=(type:HostAction['type'],clueId?:string):HostAction=>({type,clueId,sessionId:snapshot().id,expectedRevision:snapshot().revision,commandId:crypto.randomUUID()});
    const first=game.categories[0].clues[0].id,second=game.categories[0].clues[1].id;
    assert.equal((await result(display,command('select',first))).ok,false);
    let publicJSON=JSON.stringify(await(await req('/live')).json());assert.ok(!publicJSON.includes(token));assert.ok(!publicJSON.includes('answer'));
    for(const answer of hiddenAnswers)assert.ok(!publicJSON.includes(`"answer":"${answer}"`));
    // Editing a saved definition cannot affect this session's copied presentation or answers.
    game.categories[0].clues[0].text='EDITOR CHANGE';game.categories[0].clues[0].answer='EDITOR ANSWER';store.write(game);
    assert.notEqual(snapshot().game.categories[0].clues[0].text,'EDITOR CHANGE');assert.notEqual(snapshot().game.categories[0].clues[0].answer,'EDITOR ANSWER');
    assert.equal((await result(host,command('complete'))).ok,false);
    assert.equal((await result(host,command('reopen',first))).ok,false);
    const select=command('select',first);assert.equal((await result(host,select)).ok,true);assert.equal((await result(host,select)).ok,true,'duplicate does not select twice');
    await until(()=>displayState.session?.currentClueId===first);
    const stale=command('reveal');stale.expectedRevision--;assert.equal((await result(host,stale)).ok,false);
    assert.equal((await result(host,command('select',second))).ok,false);
    assert.equal((await result(host,command('play'))).ok,false,'must enable audio first');
    assert.equal((await display.timeout(3000).emitWithAck('audio:claim',{})).ok,true);
    assert.equal((await display2.timeout(3000).emitWithAck('audio:claim',{})).ok,false,'one audio display only');
    const play=command('play');assert.equal((await result(host,play)).ok,true);await until(()=>packets.length===1);assert.equal(packets[0].type,'play');
    assert.equal((await result(host,play)).ok,true);assert.equal(packets.length,1,'audio command deduplicated');
    assert.equal((await result(host,command('pause'))).ok,true);await until(()=>packets.length===2);
    assert.equal((await result(host,command('replay'))).ok,true);await until(()=>packets.length===3);
    assert.equal((await result(host,command('reveal'))).ok,true);await until(()=>displayState.session?.revealed===true);
    const revealed=displayState.session!.game.categories.flatMap(c=>c.clues).filter(q=>'answer'in q);assert.equal(revealed.length,1);assert.equal(revealed[0].answer,hiddenAnswers[0]);
    display.disconnect();await until(()=>live.publicState().audio.ownerId===null);display.connect();await new Promise<void>(resolve=>display.once('connect',()=>resolve()));await until(()=>displayState.session?.revealed===true);assert.equal(packets.length,3,'reconnect never replays audio');
    assert.equal((await display.timeout(3000).emitWithAck('audio:claim',{})).ok,true);
    assert.equal((await result(host,command('complete'))).ok,true);await until(()=>displayState.session?.completed.includes(first)===true);assert.ok(!JSON.stringify(displayState).includes('"answer":'));
    assert.equal((await result(host,command('select',first))).ok,false);
    assert.equal((await result(host,command('reopen',first))).ok,true);assert.equal(snapshot().revealed,false);assert.ok(!snapshot().completed.includes(first));
    assert.equal((await result(host,command('board'))).ok,true);assert.equal(snapshot().currentClueId,null);assert.ok(!snapshot().completed.includes(first));
    assert.equal((await result(host,command('select',second))).ok,true);assert.equal((await result(host,command('complete'))).ok,true);
    await host.timeout(3000).emitWithAck('host:action',{...command('board'),extra:'no'}).then(r=>assert.equal(r.ok,false));
    const ended=new Promise<void>(resolve=>host.once('disconnect',()=>resolve()));live.endLocal();await ended;assert.equal(live.publicState().session,null);assert.equal(live.authorized(token),false);assert.equal((await req('/live/host','GET',undefined,{Authorization:`Bearer ${token}`})).status,401);
    live.start(game.id);assert.equal(snapshot().completed.length,0);assert.equal(snapshot().currentClueId,null);assert.notEqual(live.setup(port).hostToken,token);assert.equal(store.get(game.id)!.categories[0].clues[0].answer,'EDITOR ANSWER');assert.ok(stops>=1);
  }finally{sockets.forEach(s=>s.disconnect());await new Promise<void>(resolve=>live.io.close(()=>resolve()));store.db.close();await rm(directory,{recursive:true,force:true});}
});

test('real server restart preserves snapshot and progress, pauses the session, and stops audio',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'blueboard-live-restart-'));let child:ChildProcess|undefined;const sockets:Socket[]=[];
  async function boot(){child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DATA_DIR:directory,PORT:'0'},stdio:['ignore','pipe','pipe']});child.stderr?.on('data',()=>{});return new Promise<string>((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Server timeout')),10000);child!.stdout!.on('data',d=>{out+=d;const m=out.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`);}});child!.once('exit',c=>{clearTimeout(timer);reject(new Error(`Server exited ${c}`));});});}
  async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}child=undefined;}
  try{
    let root=await boot();const games=await(await fetch(root+'/api/games')).json();let game:Game=await(await fetch(root+`/api/games/${games[0].id}`)).json();
    const form=new FormData();form.append('file',new Blob([new Uint8Array(wav())]),'quiet.wav');const media=await(await fetch(root+'/api/media',{method:'POST',body:form})).json();game.categories[0].clues[1].audioId=media.id;
    await fetch(root+`/api/games/${game.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(game)});
    const setup:Setup=await(await fetch(root+'/api/live/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:game.id})})).json();
    let host=await connected(root,'host',setup.hostToken!);sockets.push(host);const display=await connected(root);sockets.push(display);
    let state:any;host.on('state',s=>{state=s;});state=await(await fetch(root+'/api/live/host',{headers:{Authorization:`Bearer ${setup.hostToken}`}})).json();
    async function send(type:HostAction['type'],clueId?:string){const a={type,clueId,sessionId:state.session.id,expectedRevision:state.session.revision,commandId:crypto.randomUUID()};const r=await result(host,a);assert.equal(r.ok,true,r.error);await until(()=>!state.session||state.session.revision>a.expectedRevision);}
    await send('select',game.categories[0].clues[0].id);await send('complete');await send('select',game.categories[0].clues[1].id);await send('reveal');
    await display.timeout(3000).emitWithAck('audio:claim',{});await send('play');const before=structuredClone(state.session);await stop();
    root=await boot();const recovered=await(await fetch(root+'/api/live/host',{headers:{Authorization:`Bearer ${setup.hostToken}`}})).json();
    assert.deepEqual(recovered.session.game,before.game);assert.deepEqual(recovered.session.completed,before.completed);assert.equal(recovered.session.currentClueId,before.currentClueId);assert.equal(recovered.session.revealed,true);assert.equal(recovered.session.paused,true);assert.equal(recovered.audio.playback,'stopped');assert.equal(recovered.audio.ownerId,null);
    host=await connected(root,'host',setup.hostToken!);sockets.push(host);state=recovered;host.on('state',s=>{state=s;});
    const blocked=await result(host,{type:'board',sessionId:state.session.id,expectedRevision:state.session.revision,commandId:crypto.randomUUID()});assert.equal(blocked.ok,false);
    await send('resume');assert.equal(state.session.paused,false);assert.equal(state.audio.ownerId,null);assert.equal(state.audio.playback,'stopped');
  }finally{sockets.forEach(s=>s.disconnect());await stop();await rm(directory,{recursive:true,force:true});}
});

test('v1 database migration preserves existing definitions and media metadata',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'blueboard-migration-'));
  try{
    const old=openStore(directory);const game=old.get(old.list()[0].id)!;
    old.db.prepare('INSERT INTO media VALUES (?, ?, ?, ?, ?, ?)').run('kept-media','image','kept.png','image/png',100,'kept.png');
    old.db.exec('DROP TABLE session_players; DROP TABLE live_session; PRAGMA user_version=1;');old.db.close();
    const migrated=openStore(directory);
    try{assert.deepEqual(migrated.get(game.id),game);assert.equal(migrated.list().length,1);assert.equal(migrated.media('kept-media')?.name,'kept.png');assert.equal((migrated.db.prepare('PRAGMA user_version').get() as any).user_version,3);}
    finally{migrated.db.close();}
  }finally{await rm(directory,{recursive:true,force:true});}
});
