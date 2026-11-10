import { Server, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import { isReady } from '../shared/model.js';
import type { LiveSession, PublicSession, HostAction, AudioStatus, AudioCommand, Setup } from '../shared/live.js';
import type { openStore } from './db.js';
import { localRequest, sameOrigin } from './access.js';
import { emptyBuzzer, playerService } from './players.js';

const actionSchema = z.object({
  sessionId: z.uuid(), expectedRevision: z.number().int().positive(), commandId: z.uuid(),
  type: z.enum(['select','reopen','reveal','complete','board','end','resume','play','pause','replay','joining-open','joining-close','join-address','qr-show','qr-hide','remove-player','buzz-open','buzz-close','buzz-clear','buzz-exclude','eligibility-reset']), clueId: z.uuid().optional(), playerId:z.uuid().optional(), origin:z.string().max(200).optional()
}).strict();
function fail(message: string, status=400): never { throw Object.assign(new Error(message), {status}); }
export function networkOrigins(port:number) {
  const hosts = Object.values(networkInterfaces()).flat().filter(i=>i && i.family==='IPv4' && !i.internal).map(i=>`http://${i!.address}:${port}`);
  return [`http://localhost:${port}`, ...new Set(hosts)];
}
export function attachLive(store:ReturnType<typeof openStore>, server:HttpServer) {
  let session:LiveSession|null=null;
  let hostToken:string|null=null;
  let commands:string[]=[];
  let audio:AudioStatus={ownerId:null,ready:false,playback:'stopped',error:null};
  const row=store.db.prepare('SELECT * FROM live_session WHERE slot=1').get() as {state:string;host_token:string;commands:string}|undefined;
  if(row){session=JSON.parse(row.state);hostToken=row.host_token;commands=JSON.parse(row.commands);session!.joiningOpen ??= true;session!.showJoinQr ??= true;session!.joinOrigin ??= null;session!.buzzer ??= emptyBuzzer(session!.currentClueId);session!.buzzer.open=false;session!.buzzer.windowId=null;session!.paused=true;session!.revision++;persist();}
  function persist(){
    if(!session){store.db.prepare('DELETE FROM live_session WHERE slot=1').run();return;}
    store.db.prepare('INSERT OR REPLACE INTO live_session VALUES (1, ?, ?, ?)').run(JSON.stringify(session),hostToken!,JSON.stringify(commands));
  }
  // Public transport is built field by field: unrevealed answers never enter a public packet.
  function publicSession():PublicSession|null {
    if(!session)return null;
    const {id,revision,currentClueId,revealed,completed,paused,joiningOpen,showJoinQr,joinOrigin,buzzer}=session;
    return {id,revision,currentClueId,revealed,completed:[...completed],paused,joiningOpen,showJoinQr,joinOrigin:joinOrigin&&joinOrigins().includes(joinOrigin)?joinOrigin:null,buzzer:structuredClone(buzzer),game:{title:session.game.title,categories:session.game.categories.map(c=>({id:c.id,order:c.order,name:c.name,clues:c.clues.map(q=>({id:q.id,order:q.order,value:q.value,text:q.text,imageId:q.imageId,audioId:q.audioId,...(revealed&&currentClueId===q.id?{answer:q.answer}:{})}))}))}};
  }
  function authorized(token:unknown) {
    if(typeof token!=='string'||!hostToken)return false;
    const candidate=Buffer.from(token),expected=Buffer.from(hostToken);
    return candidate.length===expected.length&&timingSafeEqual(candidate,expected);
  }
  const io=new Server(server,{maxHttpBufferSize:16384,pingInterval:3000,pingTimeout:3000,allowRequest:(req,callback)=>callback(null,sameOrigin(req))});
  const joinOrigins=()=>{const address=server.address() as {port:number;address:string}|null;if(address&&['127.0.0.1','::1'].includes(address.address))return [];return networkOrigins(address?.port||Number(process.env.PORT)||3000).slice(1);};
  const players=playerService(store,io,()=>session,persist,broadcast,joinOrigins);
  io.use((socket,next)=>{
    if(!sameOrigin(socket.request))return next(new Error('Open the controller on the game server origin.'));
    const {role,token}=socket.handshake.auth;
    if(!['display','host','player'].includes(role))return next(new Error('Choose a display, authenticated host, or authenticated player connection.'));
    if(role==='player'){try{const player=players.authenticate(socket.handshake.auth.sessionId,token);socket.data.playerId=player.id;socket.data.sessionId=player.session_id;}catch(e){return next(new Error((e as Error).message));}}
    if(role==='host'&&!authorized(token))return next(new Error('Host link is missing, invalid, or expired. Open the current private host link from the MacBook.'));
    socket.data.role=role;
    next();
  });
  function state(privateView=false){return {session:privateView?session:publicSession(),audio:{...audio},players:players.roster(),...(privateView?{joinOrigins:joinOrigins()}:{})};}
  function broadcast(){io.to('display').emit('state',state());io.to('host').emit('state',state(true));players.publish();}
  function stopAudio(release=false){
    if(audio.ownerId)io.to(audio.ownerId).emit('audio:stop');
    audio={...audio,playback:'stopped',error:null,...(release?{ownerId:null,ready:false}:{})};
  }
  function setup(port:number):Setup{return {session:session?{id:session.id,title:session.game.title,paused:session.paused,completed:session.completed.length}:null,hostToken,origins:networkOrigins(port)};}
  function start(gameId:string){
    if(session)fail('A session is already active. Resume or end it before starting a new one.',409);
    const game=store.get(gameId);if(!game)fail('Game not found.',404);
    const missing:string[]=[];
    if(!game.title.trim())missing.push('Add a game title.');
    game.categories.forEach((c,i)=>{
      if(!c.name.trim())missing.push(`Name category ${i+1}.`);
      c.clues.forEach((q,j)=>{if(!isReady(q))missing.push(`Category ${i+1}, clue ${j+1} needs ${!q.answer.trim()?'an answer':''}${!q.answer.trim()&&!q.text.trim()&&!q.imageId&&!q.audioId?' and ':''}${!q.text.trim()&&!q.imageId&&!q.audioId?'text, an image, or audio':''}.`);});
    });
    if(missing.length)fail(`This draft cannot start. ${missing.join(' ')}`);
    session={id:crypto.randomUUID(),game:structuredClone(game),revision:1,currentClueId:null,revealed:false,completed:[],paused:false,joiningOpen:true,showJoinQr:true,joinOrigin:joinOrigins()[0]||null,buzzer:emptyBuzzer()};
    store.db.prepare('DELETE FROM session_players').run();
    hostToken=randomBytes(32).toString('base64url');commands=[];stopAudio(true);persist();broadcast();return session.id;
  }
  function action(input:unknown) {
    const a=actionSchema.parse(input);
    if(!session||a.sessionId!==session.id)fail('This session ended or was replaced. Open the current host link.',409);
    if(commands.includes(a.commandId))return;
    if(a.expectedRevision!==session.revision)fail('The game changed on another screen. Review the current state and try again.',409);
    if(session.paused&&!['resume','end','joining-open','joining-close','join-address','qr-show','qr-hide','remove-player'].includes(a.type))fail('Resume this session before controlling the board.',409);
    const clues=session.game.categories.flatMap(c=>c.clues);
    const current=clues.find(q=>q.id===session!.currentClueId);
    let packet:AudioCommand|undefined;
    if(a.type==='select'||a.type==='reopen') {
      if(current)fail('Return to the board before selecting another clue.');
      const clue=clues.find(q=>q.id===a.clueId);if(!clue)fail('Choose a clue from this session.');
      const complete=session.completed.includes(clue.id);
      if(a.type==='select'&&complete)fail('This clue is complete. Use Reopen explicitly.');
      if(a.type==='reopen'&&!complete)fail('Only completed clues can be reopened.');
      session.buzzer={...emptyBuzzer(clue.id),excludedIds:session.buzzer.clueId===clue.id?session.buzzer.excludedIds:[]};
      stopAudio();session.currentClueId=clue.id;session.revealed=false;session.completed=session.completed.filter(id=>id!==clue.id);
    } else if(a.type==='reveal') {
      if(!current||session.revealed)fail('Select a hidden clue before revealing its answer.');
      session.revealed=true;session.buzzer.open=false;
    } else if(a.type==='board'||a.type==='complete') {
      if(!current)fail('No clue is open.');
      if(a.type==='complete')session.completed.push(current.id);
      session.buzzer.open=false;session.buzzer.winnerId=null;session.buzzer.windowId=null;
      stopAudio();session.currentClueId=null;session.revealed=false;
    } else if(a.type==='resume') {
      if(!session.paused)fail('The session is already running.');
      stopAudio(true);session.paused=false;session.buzzer.open=false;session.buzzer.windowId=null;
    } else if(a.type==='end') {
      stopAudio(true);session=null;hostToken=null;commands=[];players.end();persist();broadcast();
      // An ended credential must not stay subscribed to future sessions.
      const oldHosts=io.sockets.adapter.rooms.get('host');
      const oldIds=oldHosts?[...oldHosts]:[];
      io.in('host').socketsLeave('host');
      setImmediate(()=>oldIds.forEach(id=>io.sockets.sockets.get(id)?.disconnect(true)));return;
    } else if(players.hostAction(a)) {
      // Validated roster, joining, or buzzer control.
    } else if(a.type==='play'||a.type==='pause'||a.type==='replay') {
      if(!current?.audioId)fail('This clue has no audio.');
      if(!audio.ownerId||!audio.ready)fail(audio.error || 'Choose Enable Audio on the MacBook display first.');
      packet={sessionId:session.id,clueId:current.id,revision:session.revision+1,commandId:a.commandId,type:a.type,expiresAt:Date.now()+2000};
    }
    session.revision++;commands.push(a.commandId);commands=commands.slice(-512);persist();broadcast();
    // Transient command delivery only: never included in persisted state or reconnect packets.
    if(packet&&audio.ownerId)io.to(audio.ownerId).emit('audio:command',packet);
  }
  function currentMedia(id:string){return Boolean(session?.game.categories.some(c=>c.clues.some(q=>q.imageId===id||q.audioId===id)));}
  io.on('connection',(socket:Socket)=>{
    if(socket.data.role==='player')players.register(socket);
    else{socket.join(socket.data.role);socket.emit('state',state(socket.data.role==='host'));socket.on('player:buzz',(_input,ack)=>{if(typeof ack==='function')ack({ok:false,error:'Player authorization required.'});});}
    socket.on('host:action',(input,ack)=>{
      if(typeof ack!=='function')return;
      try{if(socket.data.role!=='host'||!authorized(socket.handshake.auth.token))fail('Host authorization required.',403);action(input);ack({ok:true});}
      catch(e){if(socket.data.role!=='player')socket.emit('state',state(socket.data.role==='host'&&authorized(socket.handshake.auth.token)));ack({ok:false,error:e instanceof Error?e.message:'Action failed.'});}
    });
    socket.on('audio:claim',(_input,ack)=>{
      if(typeof ack!=='function')return;
      if(socket.data.role!=='display'||!localRequest(socket.request))return ack({ok:false,error:'Enable audio on the MacBook display opened through localhost.'});
      if(!session||session.paused)return ack({ok:false,error:'Start or resume a session first.'});
      if(audio.ownerId&&audio.ownerId!==socket.id)return ack({ok:false,error:'Another display owns audio. Release Audio there or close that tab before enabling this display.'});
      audio={ownerId:socket.id!,ready:true,playback:'stopped',error:null};broadcast();ack({ok:true});
    });
    socket.on('audio:release',()=>{if(audio.ownerId===socket.id){stopAudio(true);broadcast();}});
    socket.on('audio:status',(input)=>{
      if(audio.ownerId!==socket.id||!session||input?.sessionId!==session.id||input?.revision!==session.revision||input?.clueId!==session.currentClueId)return;
      const parsed=z.object({playback:z.enum(['stopped','playing','paused']),error:z.string().max(400).nullable()}).safeParse(input);
      if(!parsed.success)return;
      audio={...audio,...parsed.data,ready:!parsed.data.error};broadcast();
    });
    socket.on('disconnect',()=>{if(audio.ownerId===socket.id){stopAudio(true);broadcast();}});
  });
  return {io,setup,start,action,players,authorized,currentMedia,publicState:()=>state(),hostState:()=>state(true),endLocal:()=>{if(!session)return;action({sessionId:session.id,expectedRevision:session.revision,commandId:crypto.randomUUID(),type:'end'} satisfies HostAction);}};
}
