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
import { scoringService } from './scoring.js';
import { roundService } from './rounds.js';
import { boardCategories, boardProgress, currentDefinition } from '../shared/rounds.js';

const actionSchema = z.object({
  sessionId: z.uuid(), expectedRevision: z.number().int().positive(), commandId: z.uuid(),
  type: z.enum(['select','reopen','reveal','complete','board','end','resume','play','pause','replay','joining-open','joining-close','join-address','qr-show','qr-hide','remove-player','buzz-open','buzz-close','buzz-clear','buzz-exclude','eligibility-reset','judge-correct','judge-incorrect','dismiss-attempt','finish-clue','finish-game','timer-pause','timer-resume','score-adjust','judgment-correct','advance-round','skip-round','dd-player','dd-wager','dd-reveal','dd-correct','final-wager','final-zero-missing','final-reveal-clue','final-pause','final-resume','final-close','final-judge','final-reveal-player','final-reveal-answer']), finalId:z.uuid().optional(), attemptId:z.uuid().optional(), amount:z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).optional(), reason:z.string().trim().min(1).max(300).optional(), outcome:z.enum(['correct','incorrect','dismissed']).optional(), clueId: z.uuid().optional(), playerId:z.uuid().optional(), origin:z.string().max(200).optional()
}).strict();
function fail(message: string, status=400): never { throw Object.assign(new Error(message), {status}); }
export function networkOrigins(port:number) {
  const hosts = Object.values(networkInterfaces()).flat().filter(i=>i && i.family==='IPv4' && !i.internal).map(i=>`http://${i!.address}:${port}`);
  return [`http://localhost:${port}`, ...new Set(hosts)];
}
export function attachLive(store:ReturnType<typeof openStore>, server:HttpServer, now:()=>number=Date.now) {
  let session:LiveSession|null=null;
  let hostToken:string|null=null;
  let commands:string[]=[];
  let audio:AudioStatus={ownerId:null,ready:false,playback:'stopped',error:null};
  const row=store.db.prepare('SELECT * FROM live_session WHERE slot=1').get() as {state:string;host_token:string;commands:string}|undefined;
  if(row){
    session=JSON.parse(row.state);hostToken=row.host_token;commands=JSON.parse(row.commands);
    session!.buzzerMode ??= 'manual';session!.joiningOpen ??= true;session!.showJoinQr ??= true;session!.joinOrigin ??= null;session!.buzzer ??= emptyBuzzer(session!.currentClueId);
    if(session!.timerSeconds===undefined)session!.timerSeconds=10;
    session!.round ??= 'first';session!.dailyDouble ??= null;session!.final ??= null;session!.currentAttemptId ??= null;session!.finished ??= false;session!.results ??= null;
    session!.buzzer.open=false;session!.buzzer.windowId=null;session!.paused=!session!.finished;session!.revision++;
  }
  let effects:(()=>void)[]|null=null;
  function afterCommit(fn:()=>void){if(effects)effects.push(fn);else fn();}
  function transaction<T>(fn:()=>T):T{
    const before=structuredClone(session),oldToken=hostToken,oldCommands=[...commands],oldAudio={...audio};
    const queue:(()=>void)[]=[];effects=queue;store.db.exec('BEGIN IMMEDIATE');
    let value:T;
    try{value=fn();persist();store.db.exec('COMMIT');}
    catch(error){store.db.exec('ROLLBACK');session=before;hostToken=oldToken;commands=oldCommands;audio=oldAudio;effects=null;throw error;}
    effects=null;for(const effect of queue)effect();return value;
  }

  function persist(){
    if(!session){store.db.prepare('DELETE FROM live_session WHERE slot=1').run();return;}
    store.db.prepare('INSERT OR REPLACE INTO live_session VALUES (1, ?, ?, ?)').run(JSON.stringify(session),hostToken!,JSON.stringify(commands));
  }
  // Public transport is built field by field: unrevealed answers never enter a public packet.
  function publicSession():PublicSession|null {
    if(!session)return null;
    const {id,revision,currentClueId,revealed,completed,paused,joiningOpen,showJoinQr,joinOrigin,buzzer,timerSeconds,buzzerMode,currentAttemptId,finished,results,round}=session;
    const presentation=currentDefinition(session),visible=Boolean(presentation&&(!session.dailyDouble||session.dailyDouble.revealed)&&(round!=='final'||session.final?.phase!=='wagering'));
    const dailyDouble=session.dailyDouble?{clueId:session.dailyDouble.clueId,playerId:session.dailyDouble.playerId,wager:session.dailyDouble.wager,revealed:session.dailyDouble.revealed}:null;
    const project=(q:import('../shared/model.js').Clue)=>({id:q.id,order:q.order,value:q.value,text:visible&&q.id===currentClueId?q.text:'',imageId:visible&&q.id===currentClueId?q.imageId:null,audioId:visible&&q.id===currentClueId?q.audioId:null,...(revealed&&q.id===currentClueId?{answer:q.answer}:{})});
    return {id,revision,currentClueId,revealed,timerSeconds,buzzerMode,currentAttemptId,finished,round,dailyDouble,final:structuredClone(session.final),results:structuredClone(results),completed:[...completed],paused,joiningOpen,showJoinQr,joinOrigin:joinOrigin&&joinOrigins().includes(joinOrigin)?joinOrigin:null,buzzer:structuredClone(buzzer),game:{title:session.game.title,categories:round==='final'?(visible?[{id:'final',order:0,name:session.game.finalJeopardy!.category,attemptPolicy:'one' as const,clues:[project(presentation!)]}]:[]):boardCategories(session).map(c=>({id:c.id,order:c.order,name:c.name,attemptPolicy:c.attemptPolicy,clues:c.clues.map(project)}))}};

  }
  function authorized(token:unknown) {
    if(typeof token!=='string'||!hostToken)return false;
    const candidate=Buffer.from(token),expected=Buffer.from(hostToken);
    return candidate.length===expected.length&&timingSafeEqual(candidate,expected);
  }
  const io=new Server(server,{maxHttpBufferSize:16384,pingInterval:3000,pingTimeout:3000,allowRequest:(req,callback)=>callback(null,sameOrigin(req))});
  const joinOrigins=()=>{const address=server.address() as {port:number;address:string}|null;if(address&&['127.0.0.1','::1'].includes(address.address))return [];return networkOrigins(address?.port||Number(process.env.PORT)||3000).slice(1);};
  const scoring=scoringService(store,()=>session,transaction,broadcast,now);
  const rounds=roundService(store,()=>session,scoring,transaction,broadcast,now);
  const players=playerService(store,io,()=>session,broadcast,joinOrigins,scoring,transaction,afterCommit,now,rounds);
  if(row)transaction(()=>{scoring.recover();rounds.recover();});
  let timer:ReturnType<typeof setInterval>|undefined;
  server.once('listening',()=>{timer=setInterval(()=>{try{scoring.tick();rounds.tick();}catch(error){console.error('Response timer update failed:',error);}},100);timer.unref();});
  server.once('close',()=>{if(timer)clearInterval(timer);});
  io.use((socket,next)=>{
    if(!sameOrigin(socket.request))return next(new Error('Open the controller on the game server origin.'));
    const {role,token}=socket.handshake.auth;
    if(!['display','host','player'].includes(role))return next(new Error('Choose a display, authenticated host, or authenticated player connection.'));
    if(role==='player'){try{const player=players.authenticate(socket.handshake.auth.sessionId,token);socket.data.playerId=player.id;socket.data.sessionId=player.session_id;}catch(e){return next(new Error((e as Error).message));}}
    if(role==='host'&&!authorized(token))return next(new Error('Host link is missing, invalid, or expired. Open the current private host link from the MacBook.'));
    socket.data.role=role;
    next();
  });
  function state(privateView=false){
    const hostSession=session?{...session,game:{...session.game,categories:session.round==='final'?[{id:'final',order:0,name:session.game.finalJeopardy!.category,attemptPolicy:'one' as const,clues:[session.game.finalJeopardy!.clue]}]:boardCategories(session)}}:null;
    return {session:privateView?hostSession:publicSession(),audio:{...audio},players:players.roster(),attempt:scoring.current(),serverNow:now(),progress:session?boardProgress(session):{resolved:0,total:0,hasNext:false},final:rounds.publicFinal(),...(privateView?{joinOrigins:joinOrigins(),ledger:scoring.ledger(),attempts:scoring.attempts(),allPlayers:players.allPlayers(),finalSubmissions:rounds.privateFinal(),dailyDoubleLimits:session?.dailyDouble?Object.fromEntries(players.roster().map(p=>[p.id,rounds.maxDaily(p.id)])):undefined}:{})};
  }
  function broadcast(){io.to('display').emit('state',state());io.to('host').emit('state',state(true));players.publish();}
  function stopAudio(release=false){
    if(audio.ownerId){const owner=audio.ownerId;afterCommit(()=>io.to(owner).emit('audio:stop'));}
    audio={...audio,playback:'stopped',error:null,...(release?{ownerId:null,ready:false}:{})};
  }
  function setup(port:number):Setup{return {session:session?{id:session.id,title:session.game.title,paused:session.paused,completed:session.completed.length,finished:session.finished}:null,hostToken,origins:networkOrigins(port)};}
  function start(gameId:string,timerSeconds:number|null=10,buzzerMode:'manual'|'automatic'='manual'){
    if(!['manual','automatic'].includes(buzzerMode))fail('Choose Manual or Automatic buzzer activation.');
    if(timerSeconds!==null&&(!Number.isInteger(timerSeconds)||timerSeconds<1||timerSeconds>120))fail('Choose a response timer from 1 to 120 seconds, or disable it.');
    if(session&&!session.finished)fail('A session is already active. Resume or end it before starting a new one.',409);
    const game=store.get(gameId);if(!game)fail('Game not found.',404);
    const missing:string[]=[];
    if(!game.title.trim())missing.push('Add a game title.');
    const boards=[{name:'First board',categories:game.categories},...(game.doubleJeopardy?.enabled?[{name:'Double Jeopardy',categories:game.doubleJeopardy.categories}]:[])];
    for(const board of boards)board.categories.forEach((c,i)=>{
      if(!c.name.trim())missing.push(`Name ${board.name} category ${i+1}.`);
      c.clues.forEach((q,j)=>{if(!isReady(q))missing.push(`Category ${i+1}, clue ${j+1} (${board.name}) needs ${!q.answer.trim()?'an answer':''}${!q.answer.trim()&&!q.text.trim()&&!q.imageId&&!q.audioId?' and ':''}${!q.text.trim()&&!q.imageId&&!q.audioId?'text, an image, or audio':''}.`);});
    });
    if(game.finalJeopardy?.enabled){if(!game.finalJeopardy.category.trim())missing.push('Name the Final Jeopardy category.');if(!isReady(game.finalJeopardy.clue))missing.push('Final Jeopardy needs an answer and text, image, or audio.');}
    for(const board of boards)if(board.categories.flatMap(c=>c.clues).some(q=>q.dailyDouble)&&Math.max(...board.categories.flatMap(c=>c.clues.map(q=>q.value)))<5)missing.push(`${board.name} Daily Doubles require a board maximum of at least $5.`);
    if(missing.length)fail(`This draft cannot start. ${missing.join(' ')}`);
    transaction(()=>{
    if(session){afterCommit(()=>players.end());const ids=[...(io.sockets.adapter.rooms.get('host')||[])];afterCommit(()=>{for(const id of ids){const socket=io.sockets.sockets.get(id);socket?.leave('host');socket?.disconnect(true);}});}
    session={id:crypto.randomUUID(),game:structuredClone(game),revision:1,currentClueId:null,revealed:false,completed:[],paused:false,joiningOpen:true,showJoinQr:true,joinOrigin:joinOrigins()[0]||null,buzzer:emptyBuzzer(),timerSeconds,buzzerMode,currentAttemptId:null,finished:false,results:null,round:'first',dailyDouble:null,final:null};
    hostToken=randomBytes(32).toString('base64url');commands=[];stopAudio(true);});broadcast();return session!.id;
  }
  function action(input:unknown) {
    scoring.tick();rounds.tick();
    const a=actionSchema.parse(input);
    if(!session||a.sessionId!==session.id)fail('This session ended or was replaced. Open the current host link.',409);
    if(commands.includes(a.commandId))return;
    if(a.expectedRevision!==session.revision)fail('The game changed on another screen. Review the current state and try again.',409);
    if(session.finished&&!['score-adjust','judgment-correct'].includes(a.type))fail('This game is finished. Start a fresh session to play again.',409);
    if(session.paused&&!['score-adjust','judgment-correct','resume','end','joining-open','joining-close','join-address','qr-show','qr-hide','remove-player'].includes(a.type))fail('Resume this session before controlling the board.',409);
    transaction(()=>{
    if(session!.round==='final'){if(a.type==='score-adjust'&&!session!.finished)fail('Wait until Final results are revealed before making manual adjustments.');if(a.type==='judgment-correct'&&scoring.attempt(a.attemptId||null)?.kind!=='final'&&!session!.finished)fail('Only already revealed Final judgments can be corrected during Final.');if(['select','reopen','reveal','complete','board','finish-clue','judge-correct','judge-incorrect','dismiss-attempt','timer-pause','timer-resume','remove-player'].includes(a.type))fail('Use the Final Jeopardy controls for this stage.');}
    const clues=boardCategories(session!).flatMap(c=>c.clues);
    const current=currentDefinition(session!);
    let packet:AudioCommand|undefined;
    if(a.type==='select'||a.type==='reopen') {
      if(current)fail('Return to the board before selecting another clue.');
      const clue=clues.find(q=>q.id===a.clueId);if(!clue)fail('Choose a clue from this session.');
      const complete=session!.completed.includes(clue.id);
      if(a.type==='select'&&complete)fail('This clue is complete. Use Reopen explicitly.');
      if(a.type==='reopen'&&!complete)fail('Only completed clues can be reopened.');
      scoring.dismiss('Clue changed');session!.currentAttemptId=null;
      session!.buzzer={...emptyBuzzer(clue.id),excludedIds:session!.buzzer.clueId===clue.id?session!.buzzer.excludedIds:[]};
      stopAudio();session!.currentClueId=clue.id;session!.revealed=false;session!.completed=session!.completed.filter(id=>id!==clue.id);session!.dailyDouble=null;rounds.announceDaily();
      if(session!.buzzerMode==='automatic'&&!session!.dailyDouble)players.openWindow(session!);
    } else if(a.type==='reveal') {
      if(session!.dailyDouble&&!session!.dailyDouble.revealed)fail('Confirm the Daily Double player and wager before revealing the clue.');
      if(!current||session!.revealed)fail('Select a hidden clue before revealing its answer.');
      if(scoring.current()?.status==='pending')fail('Judge or dismiss the accepted response before revealing the answer.');
      session!.revealed=true;session!.buzzer.open=false;scoring.resolve();
    } else if(a.type==='board'||a.type==='complete') {
      if(!current)fail('No clue is open.');
      if(a.type==='board'&&scoring.current()?.status==='pending')fail('Judge or dismiss this attempt before returning to the board.');
      if(a.type==='complete'){scoring.dismiss('Resolved without winner and returned');scoring.resolve();}
      session!.buzzer.open=false;session!.buzzer.winnerId=null;session!.buzzer.windowId=null;
      stopAudio();session!.currentClueId=null;session!.revealed=false;session!.dailyDouble=null;
    } else if(a.type==='resume') {
      if(!session!.paused)fail('The session is already running.');
      stopAudio(true);session!.paused=false;session!.buzzer.open=false;session!.buzzer.windowId=null;
    } else if(a.type==='end'||a.type==='finish-game') {
      if(a.type==='finish-game'&&(boardProgress(session!).resolved!==clues.length||boardProgress(session!).hasNext||session!.round==='final'))fail('Resolve every clue before finishing the full game, or choose End session to finish early.');
      scoring.finish(a.type==='finish-game'?'complete':'early');stopAudio(true);
    } else if(rounds.hostAction(a)) {
      if(['advance-round','skip-round'].includes(a.type))stopAudio();
    } else if(scoring.hostAction(a)) {
      // Judgment, eligibility, fresh window, and display changes commit together.
      if(a.type==='judge-correct')stopAudio();
      if(a.type==='judge-incorrect'&&session!.buzzerMode==='automatic'&&!session!.dailyDouble&&!session!.revealed&&!session!.completed.includes(session!.currentClueId!))players.openWindow(session!);
    } else if(players.hostAction(a)) {
      // Validated roster, joining, or buzzer control.
    } else if(a.type==='play'||a.type==='pause'||a.type==='replay') {
      if((session!.dailyDouble&&!session!.dailyDouble.revealed)||(session!.round==='final'&&session!.final?.phase==='wagering'))fail('Reveal the current special-round clue before playing audio.');
      if(!current?.audioId)fail('This clue has no audio.');
      if(!audio.ownerId||!audio.ready)fail(audio.error || 'Choose Enable Audio on the MacBook display first.');
      packet={sessionId:session!.id,clueId:current.id,revision:session!.revision+1,commandId:a.commandId,type:a.type,expiresAt:Date.now()+2000};
    }
    session!.revision++;commands.push(a.commandId);commands=commands.slice(-512);
    // Transient command delivery only: never included in persisted state or reconnect packets.
    if(packet&&audio.ownerId){const owner=audio.ownerId;afterCommit(()=>queueMicrotask(()=>io.to(owner).emit('audio:command',packet)));}
    });broadcast();
  }
  function currentMedia(id:string){if(!session||(session.dailyDouble&&!session.dailyDouble.revealed)||(session.round==='final'&&session.final?.phase==='wagering'))return false;const q=currentDefinition(session);return Boolean(q&&(q.imageId===id||q.audioId===id));}
  io.on('connection',(socket:Socket)=>{
    if(socket.data.role==='player')players.register(socket);
    else{socket.join(socket.data.role);socket.emit('state',state(socket.data.role==='host'));for(const event of ['player:buzz','player:final'])socket.on(event,(_input,ack)=>{if(typeof ack==='function')ack({ok:false,error:'Player authorization required.'});});}
    socket.on('host:action',(input,ack)=>{
      if(typeof ack!=='function')return;
      try{if(socket.data.role!=='host'||!authorized(socket.handshake.auth.token))fail('Host authorization required.',403);action(input);ack({ok:true});}
      catch(e){if(socket.data.role!=='player')socket.emit('state',state(socket.data.role==='host'&&authorized(socket.handshake.auth.token)));ack({ok:false,error:e instanceof Error?e.message:'Action failed.'});}
    });
    socket.on('audio:claim',(_input,ack)=>{
      if(typeof ack!=='function')return;
      if(socket.data.role!=='display'||!localRequest(socket.request))return ack({ok:false,error:'Enable audio on the MacBook display opened through localhost.'});
      if(!session||session.paused||session.finished)return ack({ok:false,error:'Start or resume a session first.'});
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
  return {io,setup,start,action,players,scoring,rounds,prepareShutdown:()=>{if(!session||session.finished)return;transaction(()=>{scoring.recover();rounds.recover();session!.paused=true;session!.buzzer.open=false;session!.buzzer.windowId=null;session!.revision++;stopAudio(true);});broadcast();},authorized,currentMedia,publicState:()=>state(),hostState:()=>state(true),endLocal:()=>{if(!session||session.finished)return;action({sessionId:session.id,expectedRevision:session.revision,commandId:crypto.randomUUID(),type:'end'} satisfies HostAction);}};
}
