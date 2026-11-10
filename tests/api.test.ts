import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import type { Game, Media } from '../shared/model.js';
import { png, wav } from './fixtures.js';

test('library CRUD, draft validation, media lifecycle, and transactional saves', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'blueboard-api-'));
  const {app,store}=createApp(dir);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address() as {port:number};const root=`http://127.0.0.1:${address.port}`;
  async function request(path:string, method='GET', body?:unknown){return fetch(root+'/api'+path,{method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});}
  async function upload(bytes:Uint8Array,name:string,type:string){const form=new FormData();form.append('file',new Blob([new Uint8Array(bytes)],{type}),name);return request('/media','POST',form);}
  try {
    const initial=await(await request('/games')).json();assert.equal(initial.length,1);assert.equal(initial[0].sample,true);assert.equal(initial[0].ready,30);
    const response=await request('/games','POST',{title:'Test draft',description:'Local only'});assert.equal(response.status,201);
    let game:Game=await response.json();const id=game.id;
    assert.equal(game.categories.length,6);assert.deepEqual(game.categories[0].clues.map(q=>q.value),[200,400,600,800,1000]);
    assert.equal(new Set(game.categories.flatMap(c=>[c.id,...c.clues.map(q=>q.id)])).size,36);
    assert.equal((await request(`/games/${id}`,'PUT',game)).status,200,'incomplete drafts save');
    game=await(await request(`/games/${id}`)).json();const stale=structuredClone(game);
    game.title='Edited draft';game.categories[0].name='Picture and sound';let clue=game.categories[0].clues[0];clue.value=450;clue.text='A combined clue';clue.answer='An answer';
    let r=await upload(png,'photo.png','image/png');assert.equal(r.status,201);const image:Media=await r.json();assert.equal(image.kind,'image');
    for (const [file,mime,kind] of [['pixel.jpg','image/jpeg','image'],['pixel.webp','image/webp','image'],['silence.mp3','audio/mpeg','audio']]) {
      const bytes=await readFile(new URL('./fixtures/'+file,import.meta.url));
      const result=await upload(bytes,file,mime);assert.equal(result.status,201,`${file} accepted`);const media:Media=await result.json();assert.equal(media.kind,kind);assert.deepEqual(Buffer.from(await(await request(`/media/${media.id}`)).arrayBuffer()),bytes);
    }
    r=await upload(wav(),'tone.wav','audio/wav');assert.equal(r.status,201);const audio:Media=await r.json();assert.equal(audio.kind,'audio');
    clue.imageId=image.id;clue.audioId=audio.id;
    r=await request(`/games/${id}`,'PUT',game);assert.equal(r.status,200);game=await r.json();
    assert.equal((await request(`/games/${id}`,'PUT',stale)).status,409,'stale edits do not overwrite');
    assert.equal((await(await request('/games')).json()).find((g:any)=>g.id===id).ready,1);
    assert.deepEqual(Buffer.from(await(await request(`/media/${image.id}`)).arrayBuffer()),png);
    const range=await fetch(root+`/api/media/${audio.id}`,{headers:{Range:'bytes=0-15'}});assert.equal(range.status,206,'audio seeking supported');assert.equal((await range.arrayBuffer()).byteLength,16);
    const replacement:Media=await(await upload(png,'replacement.png','image/png')).json();
    const unsaved=structuredClone(game);unsaved.categories[0].clues[0].imageId=replacement.id;unsaved.categories[0].clues[0].audioId=null;
    const savedBefore=await(await request(`/games/${id}`)).json();assert.equal(savedBefore.categories[0].clues[0].imageId,image.id);assert.equal(savedBefore.categories[0].clues[0].audioId,audio.id);
    assert.equal((await request(`/media/${image.id}`)).status,200);assert.equal((await request(`/media/${audio.id}`)).status,200);
    r=await request(`/games/${id}`,'PUT',unsaved);assert.equal(r.status,200);game=await r.json();assert.equal(game.categories[0].clues[0].imageId,replacement.id);assert.equal(game.categories[0].clues[0].audioId,null);
    game.categories[0].clues[0].imageId=null;game=await(await request(`/games/${id}`,'PUT',game)).json();assert.equal(game.categories[0].clues[0].imageId,null);
    assert.equal((await request(`/media/${image.id}`)).status,200,'replaced files are retained');
    const invalid=structuredClone(game);invalid.categories[0].clues[0].imageId=crypto.randomUUID();invalid.title='Must roll back';assert.equal((await request(`/games/${id}`,'PUT',invalid)).status,400);assert.equal((await(await request(`/games/${id}`)).json()).title,'Edited draft');
    const wrongKind=structuredClone(game);wrongKind.categories[0].clues[0].imageId=audio.id;assert.equal((await request(`/games/${id}`,'PUT',wrongKind)).status,400);
    const duplicate=structuredClone(game);duplicate.categories[0].clues[0].order=1;assert.equal((await request(`/games/${id}`,'PUT',duplicate)).status,400);
    const noAnswer=structuredClone(game);delete (noAnswer.categories[0].clues[0] as any).answer;assert.equal((await request(`/games/${id}`,'PUT',noAnswer)).status,400);
    assert.equal((await request('/games','POST',{title:' '})).status,400);
    assert.equal((await upload(Buffer.from('not an image'),'fake.png','image/png')).status,400);
    assert.equal((await upload(png,'fake.mp3','audio/mpeg')).status,400);
    assert.equal((await upload(png,'script.svg','image/svg+xml')).status,400);
    assert.equal((await upload(Buffer.concat([png,Buffer.alloc(10*1024*1024)]),'huge.png','image/png')).status,413);
    assert.equal((await upload(Buffer.alloc(21*1024*1024),'huge.wav','audio/wav')).status,413);
    const hostile=await fetch(root+'/api/games',{method:'POST',headers:{Origin:'https://hostile.example','Content-Type':'application/json'},body:JSON.stringify({title:'No'})});assert.equal(hostile.status,403);
    assert.equal((await request('/media/..%2F..%2Fpackage.json')).status,404);
    const shell=await fetch(root);assert.equal(shell.status,200);assert.match(await shell.text(),/Blueboard/);
    assert.equal((await request(`/games/${id}`,'DELETE')).status,204);assert.equal((await request(`/games/${id}`)).status,404);assert.equal((await request(`/games/${id}`,'DELETE')).status,404);
    assert.equal((await request(`/media/${audio.id}`)).status,200,'game deletion does not unexpectedly delete files');
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM categories WHERE game_id=?').get(id) as any).n,0);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));store.db.close();await rm(dir,{recursive:true,force:true});}
});

test('data and media persist through a real backend process restart, and sample is not recreated', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'blueboard-restart-'));
  let child:ChildProcess|undefined;
  async function boot(){
    child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DATA_DIR:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});
    let output='';child.stderr?.on('data',()=>{});
    return new Promise<string>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Backend startup timed out')),10000);
      child!.stdout!.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});
      child!.once('exit',code=>{clearTimeout(timer);reject(new Error(`Backend exited: ${code}`));});
    });
  }
  async function stop(){if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}child=undefined;}
  try {
    let root=await boot();let list=await(await fetch(root+'/api/games')).json();const sampleId=list[0].id;
    await fetch(root+`/api/games/${sampleId}`,{method:'DELETE'});
    let game:Game=await(await fetch(root+'/api/games',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Restart keeper'})})).json();
    const form=new FormData();form.append('file',new Blob([new Uint8Array(wav())],{type:'audio/wav'}),'silence.wav');const audio:Media=await(await fetch(root+'/api/media',{method:'POST',body:form})).json();
    game.categories[2].clues[3].audioId=audio.id;game.categories[2].clues[3].answer='Silence';
    game=await(await fetch(root+`/api/games/${game.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(game)})).json();
    await stop();root=await boot();assert.deepEqual(await(await fetch(root+`/api/games/${game.id}`)).json(),game);assert.deepEqual(Buffer.from(await(await fetch(root+`/api/media/${audio.id}`)).arrayBuffer()),wav());
    list=await(await fetch(root+'/api/games')).json();assert.equal(list.length,1);assert.equal(list[0].sample,false);
    assert.equal((await readFile(join(dir,'games.sqlite'))).subarray(0,15).toString(),'SQLite format 3');
  } finally {await stop();await rm(dir,{recursive:true,force:true});}
});
