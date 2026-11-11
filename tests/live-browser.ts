import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { png, wav } from './fixtures.js';
import type { Setup } from '../shared/live.js';

test('independent board and host browsers synchronize, protect answers, control one audio display, and recover connections', {timeout:60000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'blueboard-live-browser-'));
  const {store,server,live}=createApp(directory);server.listen(0,'0.0.0.0');await once(server,'listening');
  const port=(server.address() as {port:number}).port,root=`http://127.0.0.1:${port}`;
  const lan=Object.values(networkInterfaces()).flat().find(i=>i?.family==='IPv4'&&!i.internal),hostRoot=lan?`http://${lan.address}:${port}`:root;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const boardContext=await browser.newContext({viewport:{width:1440,height:1000}}),hostContext=await browser.newContext({viewport:{width:820,height:1180}}),otherContext=await browser.newContext();
  const board=await boardContext.newPage(),host=await hostContext.newPage(),other=await otherContext.newPage();const errors:string[]=[];
  for(const page of [board,host,other])page.on('pageerror',e=>errors.push(e.message));
  async function current(){return live.hostState().session;}
  try{
    let game=store.get(store.list()[0].id)!;
    async function upload(buffer:Buffer,name:string){const form=new FormData();form.append('file',new Blob([new Uint8Array(buffer)]),name);return(await(await fetch(root+'/api/media',{method:'POST',body:form})).json()).id as string;}
    game.categories[0].clues[0].imageId=await upload(png,'visual.png');game.categories[0].clues[0].audioId=await upload(wav(),'sound.wav');game=store.write(game);
    await other.goto(root);await other.getByRole('button',{name:'Start Game',exact:true}).click();await other.getByLabel('Private host link').waitFor();
    const setup:Setup=await(await fetch(root+'/api/live/setup')).json();
    await board.goto(root+'/display');await board.getByRole('status').filter({hasText:'Connected'}).waitFor();
    await board.getByRole('button',{name:'Fullscreen',exact:true}).click();await board.waitForFunction(()=>Boolean(document.fullscreenElement));
    await board.getByRole('button',{name:'Fullscreen',exact:true}).click();await board.waitForFunction(()=>!document.fullscreenElement);
    await board.getByRole('button',{name:'Enable Audio',exact:true}).click();await board.getByText('Audio enabled on this display',{exact:true}).waitFor();
    await host.goto(hostRoot+`/host#${setup.hostToken}`);await host.getByRole('status').filter({hasText:'Connected',hasNotText:'Display audio'}).waitFor();
    assert.equal(new URL(host.url()).hash,'','host credential removed from address bar');
    assert.equal(await host.locator('audio').count(),0,'no host audio element');
    // LAN HTTP is not a secure context; controller UUIDs must still work there.
    if(lan)assert.equal(await host.evaluate(()=>window.isSecureContext),false);
    await host.getByRole('button',{name:'Select Kitchen science $200',exact:true}).click();
    await board.getByText(game.categories[0].clues[0].text,{exact:true}).waitFor();
    assert.equal(await board.locator('.live-answer').count(),0);await host.locator('.live-answer').waitFor();assert.equal(await host.locator('.live-answer').count(),1);
    await board.waitForFunction(()=>{const img=document.querySelector('.live-image') as HTMLImageElement;return img?.complete&&img.naturalWidth>0;});
    await board.waitForFunction(()=>{const a=document.querySelector('audio');return a&&a.readyState>=1;});
    assert.equal(await board.locator('audio').evaluate((a:HTMLAudioElement)=>a.paused),true);
    await board.locator('audio').evaluate((a:HTMLAudioElement)=>{const original=a.play.bind(a);(a as any).restorePlay=()=>{a.play=original;};a.play=()=>Promise.reject(new Error('Test playback restriction'));});
    await host.getByRole('button',{name:'Play audio',exact:true}).click();
    await host.getByRole('status').filter({hasText:'Playback was blocked'}).waitFor();assert.equal(await host.getByRole('button',{name:'Play audio',exact:true}).isDisabled(),true);
    await board.locator('audio').evaluate((a:HTMLAudioElement)=>(a as any).restorePlay());
    await board.getByRole('button',{name:'Enable Audio',exact:true}).click();await board.getByText('Audio enabled on this display',{exact:true}).waitFor();
    // Keep the play promise pending, then reject it after a newer pause command.
    await board.locator('audio').evaluate((a:HTMLAudioElement)=>{const original=a.play.bind(a);(a as any).restoreDelayedPlay=()=>{a.play=original;};a.play=async()=>{await original();await new Promise<void>((_resolve,reject)=>{(a as any).rejectLatePlay=reject;});};});
    await host.getByRole('button',{name:'Play audio',exact:true}).click();await board.waitForFunction(()=>!document.querySelector('audio')!.paused);
    await board.waitForFunction(()=>typeof (document.querySelector('audio') as any).rejectLatePlay==='function');
    await host.getByRole('button',{name:'Pause audio',exact:true}).click();await board.waitForFunction(()=>document.querySelector('audio')!.paused);
    await board.locator('audio').evaluate((a:HTMLAudioElement)=>{(a as any).rejectLatePlay(new Error('Late rejection after intentional pause'));(a as any).restoreDelayedPlay();});
    await host.getByRole('status').filter({hasText:'Ready · paused'}).waitFor();
    await host.getByRole('button',{name:'Replay audio',exact:true}).click();await board.waitForFunction(()=>!document.querySelector('audio')!.paused);
    await mkdir('artifacts',{recursive:true});await board.screenshot({path:'artifacts/live-display-clue.png',fullPage:true});await host.screenshot({path:'artifacts/live-host-portrait.png',fullPage:true});
    // A second tab cannot acquire audio, and never plays it.
    await other.goto(root+'/display');await other.getByRole('button',{name:'Enable Audio',exact:true}).click();await other.getByRole('alert').filter({hasText:'Another display owns audio'}).waitFor();assert.equal(await other.locator('audio').evaluate((a:HTMLAudioElement)=>a.paused),true);
    await host.getByRole('button',{name:'Reveal answer on display',exact:true}).click();await board.locator('.live-answer').getByText(game.categories[0].clues[0].answer,{exact:true}).waitFor();
    await board.reload();await board.locator('.live-answer').waitFor();assert.equal(await board.locator('audio').evaluate((a:HTMLAudioElement)=>a.paused),true);await board.getByRole('button',{name:'Enable Audio',exact:true}).waitFor();
    await host.reload();await host.getByRole('button',{name:'Answer revealed',exact:true}).waitFor();
    await host.getByRole('button',{name:'Return to board',exact:true}).click();await board.getByLabel('Kitchen science $200 complete',{exact:true}).waitFor();assert.equal(await board.locator('audio').evaluate((a:HTMLAudioElement)=>a.paused),true);
    await host.getByRole('button',{name:'Reopen Kitchen science $200',exact:true}).click();await host.getByRole('button',{name:'Reopen clue',exact:true}).click();await board.locator('.live-clue-text').waitFor();assert.equal(await board.locator('.live-answer').count(),0);
    await board.getByRole('button',{name:'Enable Audio',exact:true}).click();await board.getByText('Audio enabled on this display',{exact:true}).waitFor();
    await host.getByRole('button',{name:'Replay audio',exact:true}).click();await board.waitForFunction(()=>!document.querySelector('audio')!.paused);
    await host.getByRole('button',{name:'Return without completing',exact:true}).click();await board.getByLabel('Kitchen science $200 available',{exact:true}).waitFor();assert.equal(await board.locator('audio').evaluate((a:HTMLAudioElement)=>a.paused),true);
    await boardContext.setOffline(true);await board.getByRole('status').filter({hasText:/Disconnected|Reconnecting/}).waitFor();
    await host.getByRole('button',{name:'Select Kitchen science $400',exact:true}).click();
    await boardContext.setOffline(false);await board.getByText(game.categories[0].clues[1].text,{exact:true}).waitFor();assert.equal(await board.locator('.live-answer').count(),0);
    await hostContext.setOffline(true);await host.getByRole('status').filter({hasText:/Disconnected|Reconnecting/}).first().waitFor();assert.equal(await host.getByRole('button',{name:'Reveal answer on display',exact:true}).isDisabled(),true);
    await hostContext.setOffline(false);await host.getByRole('button',{name:'Reveal answer on display',exact:true}).waitFor();await host.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Reveal answer on display'&&!b.disabled));
    await host.getByRole('button',{name:'Return without completing',exact:true}).click();await host.getByLabel('Host board',{exact:true}).waitFor();
    await host.setViewportSize({width:1180,height:820});await host.screenshot({path:'artifacts/live-host-landscape.png',fullPage:true});assert.equal(await host.evaluate(()=>document.body.scrollWidth<=innerWidth),true);
    await board.screenshot({path:'artifacts/live-display-board.png',fullPage:true});
    await other.goto(hostRoot+'/host#invalid');await other.getByRole('alert').filter({hasText:'Host link'}).waitFor();assert.equal(await other.locator('.live-answer').count(),0);
    host.once('dialog',d=>d.dismiss());await host.getByRole('button',{name:'End session',exact:true}).click();assert.ok(await current());
    host.once('dialog',d=>d.accept());await host.getByRole('button',{name:'End session',exact:true}).click();await board.getByRole('heading',{name:'Final standings',exact:true}).waitFor();assert.equal((await current())!.finished,true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise<void>(resolve=>live.io.close(()=>resolve()));store.db.close();await rm(directory,{recursive:true,force:true});}
});
