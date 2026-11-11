import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { io, type Socket } from 'socket.io-client';
import type { ActionName, ActionResult, HostAction, LiveState, PlayerIdentity, PlayerState, PublicSession } from '../shared/live';
import './party.css';
import { FinalPlayer, submissionId } from './Rounds';
import { dollars, FinalResults, ResponseClock } from './Scoring';

export function JoinQr({session}:{session:PublicSession}){
  const url=session.joinOrigin?`${session.joinOrigin}/join/${session.id}`:null;
  const [image,setImage]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let active=true;setImage('');setError('');if(url)QRCode.toDataURL(url,{width:224,margin:3,errorCorrectionLevel:'M',color:{dark:'#08172f',light:'#ffffff'}}).then(src=>{if(active)setImage(src);}).catch(()=>{if(active)setError('QR code unavailable. Use the readable player link.');});return()=>{active=false;};},[url]);
  if(!session.showJoinQr)return null;
  return <aside className="join-qr" aria-label="Player joining"><div className="qr-image">{image?<img src={image} alt="Player join QR code"/>:<p>{url?'Generating QR…':'No network address'}</p>}</div><div><p className="eyebrow">INDIVIDUAL PLAYERS · SCAN TO JOIN</p><h2>{session.joiningOpen?'Bring your own buzzer':'Joining is closed'}</h2>{url?<a className="player-join-url" href={url}>{url}</a>:<p className="muted">Connect the MacBook to Wi-Fi, then choose a network address on the host.</p>}<p className="muted">{session.joiningOpen?'Enter your name on your phone. Keep this page open during play.':'Existing players can keep using their buzzers. Ask the host to reopen joining.'}</p>{error&&<p role="alert" className="error">{error}</p>}</div></aside>;
}
export function PartyRoster({state,host=false}:{state:LiveState;host?:boolean}){
  const winner=state.players.find(p=>p.id===state.session?.buzzer.winnerId);
  return <section className="party-roster" aria-label="Player roster"><div className="roster-heading"><strong>Players <span>{state.players.length}</span></strong>{state.session?.currentClueId&&<span>{state.session.buzzer.open?'Buzzing open':winner?'Winning buzz accepted':'Buzzing closed'}</span>}</div><ul>{state.players.map(p=><li key={p.id} className={winner?.id===p.id?'roster-winner':''}><span>{p.name}</span><strong className="roster-score">{dollars(p.score)}</strong>{host&&<small>{p.connected?'Connected':'Disconnected'}</small>}</li>)}</ul>{!state.players.length&&<p className="muted">No players yet. Scan the player QR code to join.</p>}{winner&&state.session?.currentClueId&&<div className="buzz-winner" role="status"><span>FIRST BUZZ</span><strong>{winner.name}</strong><small>The clue stays open. The host controls what happens next.</small></div>}</section>;
}
export function PartyControls({state,connected,busy,send}:{state:LiveState;connected:boolean;busy:boolean;send:(type:ActionName,extra?:Partial<HostAction>)=>void}){
  const session=state.session!;const buzzer=session.buzzer,live=connected&&!busy,canBuzz=live&&!session.paused&&!session.finished&&!session.dailyDouble&&session.round!=='final'&&Boolean(session.currentClueId)&&!session.completed.includes(session.currentClueId!)&&!session.revealed;
  const winner=state.players.find(p=>p.id===buzzer.winnerId),eligiblePlayers=state.players.filter(p=>!buzzer.excludedIds.includes(p.id)),eligible=eligiblePlayers.filter(p=>p.connected);
  return <section className="party-controls"><div className="party-controls-heading"><h2>Players & buzzers</h2><span className="pill">{session.joiningOpen?'Joining open':'Joining closed'}</span></div>
    <div className="buzzer-controls"><h3>{session.round==='final'?'Normal buzzing disabled for Final Jeopardy':session.dailyDouble?'Only the Daily Double player participates':!session.currentClueId?'Select a clue to use buzzers':session.completed.includes(session.currentClueId)?'Clue resolved — return to the board':session.revealed?'Buzzing disabled — answer revealed':buzzer.open?'Buzzing is open':winner?`First buzz: ${winner.name}`:'Buzzing is closed'}</h3><p className="muted">{eligible.length} eligible and connected · {buzzer.excludedIds.length} excluded for this clue.</p>{eligible.length===0&&session.currentClueId&&!session.completed.includes(session.currentClueId)&&<p className="control-help">{state.players.length===0?'No players have joined yet.':eligiblePlayers.length===0?'All remaining players have attempted or been excluded. Finish Without Winner, or explicitly reset eligibility as a correction.':'Eligible players are disconnected. Wait for reconnection or Finish Without Winner.'}</p>}<div className="party-actions"><button className="gold" disabled={!canBuzz||buzzer.open||Boolean(winner)||eligible.length===0} onClick={()=>send('buzz-open')}>Open buzzing</button><button className="secondary" disabled={!canBuzz||!buzzer.open} onClick={()=>send('buzz-close')}>Close buzzing</button><button className="secondary" disabled={!canBuzz||!winner} onClick={()=>send('buzz-clear')}>Clear accidental buzz & reopen</button><button className="exclude-button" disabled={!canBuzz||!winner} onClick={()=>send('buzz-exclude')}>Exclude winner & reopen</button><button className="subtle" disabled={!canBuzz} onClick={()=>{if(window.confirm('Reset eligibility for this clue? This clears the winner and all exclusions, and closes buzzing. You must open buzzing again.'))send('eligibility-reset');}}>Reset clue eligibility…</button></div><p className="control-help">Clearing an accidental buzz keeps that player eligible. Excluding a winner locks them out for the rest of this clue. Eligibility resets when you move to another clue. These buzzer controls do not change scores; use Incorrect to record an incorrect response.</p></div>
<div className="party-actions"><button className="secondary" disabled={!live||session.round!=='first'||state.progress.resolved===state.progress.total} onClick={()=>send(session.joiningOpen?'joining-close':'joining-open')}>{session.joiningOpen?'Close joining':'Open joining'}</button><button className="secondary" disabled={!live} onClick={()=>send(session.showJoinQr?'qr-hide':'qr-show')}>{session.showJoinQr?'Hide player QR':'Show player QR'}</button></div><label>Player QR network address<select aria-label="Player QR network address" value={session.joinOrigin||''} disabled={!live} onChange={e=>send('join-address',{origin:e.target.value})}><option value="" disabled>Choose a Wi-Fi address (never localhost)</option>{session.joinOrigin&&!state.joinOrigins?.includes(session.joinOrigin)&&<option value={session.joinOrigin} disabled>Previous address — choose a current address</option>}{state.joinOrigins?.map(origin=><option key={origin} value={origin}>{origin}</option>)}</select></label>{!state.joinOrigins?.length&&<p className="muted">No LAN address detected. Connect this MacBook to Wi-Fi and refresh the host.</p>}{session.joinOrigin&&<label>Public player join link<input readOnly value={`${session.joinOrigin}/join/${session.id}`} onFocus={e=>e.target.select()}/></label>}
    <PartyRoster state={state} host/>
    {state.players.length>0&&<ul className="host-player-list">{state.players.map(p=><li key={p.id}><div><strong>{p.name}</strong><span>{p.connected?'Connected':'Disconnected'}{buzzer.excludedIds.includes(p.id)?' · Ineligible for this clue':''}</span></div><button className="subtle danger" disabled={!live||session.round==='final'} aria-label={`Remove player ${p.name}`} onClick={()=>{if(window.confirm(`Remove ${p.name}? Their credential will be invalidated for this session.`))send('remove-player',{playerId:p.id});}}>Remove</button></li>)}</ul>}

  </section>;
}
async function playerRequest<T>(path:string,options:RequestInit={}):Promise<T>{
  let response:Response;
  try{response=await fetch(`/api/player${path}`,{...options,headers:{'Content-Type':'application/json'}});}catch{throw new Error('Cannot reach the MacBook. Check Wi-Fi and keep its server running.');}
  if(!response.ok)throw new Error((await response.json()).error);return response.json();
}
export function PlayerPage({sessionId}:{sessionId:string}){
  const key=`blueboard-player:${sessionId}`;
  const [identity,setIdentity]=useState<PlayerIdentity|null>(()=>{try{const stored=JSON.parse(localStorage.getItem(key)||'null');return stored?.sessionId===sessionId&&typeof stored?.credential==='string'&&typeof stored?.player?.id==='string'&&typeof stored?.player?.name==='string'?stored:null;}catch{return null;}});
  const [state,setState]=useState<PlayerState|null>(null),[name,setName]=useState(''),[error,setError]=useState(''),[storageNote,setStorageNote]=useState(''),[joining,setJoining]=useState(false),[connection,setConnection]=useState('Connecting…'),[terminal,setTerminal]=useState(false),[pending,setPending]=useState(false);
  const socketRef=useRef<Socket|null>(null),stateRef=useRef<PlayerState|null>(null),pendingRef=useRef(false),terminalRef=useRef(false);
  useEffect(()=>{
    if(identity)return;
    let active=true;
    const load=()=>playerRequest<PlayerState>(`/session/${sessionId}`).then(s=>{if(active){setState(s);setConnection('Connected');setError('');}}).catch(e=>{if(active){setError(e.message);setConnection('Disconnected');}});
    void load();const timer=setInterval(load,2500);return()=>{active=false;clearInterval(timer);};
  },[identity,sessionId]);
  useEffect(()=>{
    if(!identity)return;
    terminalRef.current=false;setTerminal(false);setConnection('Connecting…');
    const socket=io({auth:{role:'player',sessionId,token:identity.credential},reconnectionDelay:500,reconnectionDelayMax:2000});socketRef.current=socket;
    socket.on('connect',()=>{setConnection('Connected');setError('');pendingRef.current=false;setPending(false);});
    socket.on('player:state',(next:PlayerState)=>{
      if(next.buzzer.windowId!==stateRef.current?.buzzer.windowId||!next.buzzer.open){pendingRef.current=false;setPending(false);}
      stateRef.current=next;setState(next);
    });
    socket.on('player:invalid',(message:{error:string})=>{terminalRef.current=true;setTerminal(true);setError(message.error);setConnection('Session unavailable');socket.disconnect();});
    socket.on('disconnect',()=>{pendingRef.current=false;setPending(false);if(!terminalRef.current)setConnection('Disconnected — reconnecting…');});
    socket.io.on('reconnect_attempt',()=>{if(!terminalRef.current)setConnection('Reconnecting…');});
    socket.on('connect_error',(e:Error)=>{const invalid=/removed|credential|expired|session ended/i.test(e.message);setError(invalid?e.message:'Cannot reach the MacBook. Check Wi-Fi and keep its server running. Reconnecting…');setConnection('Disconnected');if(invalid){terminalRef.current=true;setTerminal(true);socket.disconnect();}});
    return()=>{socket.disconnect();socketRef.current=null;};
  },[identity,sessionId]);
  async function join(e:React.FormEvent){e.preventDefault();if(joining)return;setJoining(true);setError('');try{const result=await playerRequest<PlayerIdentity>('/join',{method:'POST',body:JSON.stringify({sessionId,name})});try{localStorage.setItem(key,JSON.stringify(result));}catch{setStorageNote('Browser storage is unavailable. Keep this tab open; refreshing may lose your player credential.');}setIdentity(result);}catch(e){setError((e as Error).message);}finally{setJoining(false);}}
  const self=state?.self,excluded=Boolean(self&&state?.buzzer.excludedIds.includes(self.id)),winner=state?.players.find(p=>p.id===state.buzzer.winnerId),connected=connection==='Connected';
  const canBuzz=Boolean(identity&&self&&connected&&!terminal&&state?.activeTab&&!state.paused&&!state.finished&&!state.dailyDouble&&state.round!=='final'&&state.currentClueId&&!state.revealed&&!excluded&&state.buzzer.open&&!winner&&!pending);
  let status='Waiting for a clue',detail='Keep this page open. Your host will select a clue.';
  if(terminal){status='Buzzer unavailable';detail=error;}
  else if(!connected){status=connection;detail='Buzzing is disabled. No tap will be sent or replayed when the connection returns.';}
  else if(identity&&!self){status='Restoring your player…';detail='Waiting for the server to confirm your identity.';}
  else if(identity&&!state?.activeTab){status='Another tab is your active buzzer';detail='Use that tab, or close it to activate this one. Extra tabs do not provide extra attempts.';}
  else if(state?.finished){status='Game finished';detail='Buzzing has ended. Final standings are shown below.';}
  else if(state?.paused){status='Session paused';detail='The host must resume. Buzzing stays closed until explicitly opened.';}
  else if(state?.dailyDouble){status=state.dailyDouble.playerId===self?.id?'Your Daily Double':'Daily Double — one player only';detail=state.dailyDouble.revealed?'The selected player responds aloud. Normal buzzing is disabled.':'Wait for the host to confirm the player and wager.';}
  else if(state?.currentClueId){
    if(excluded){status='Ineligible for this clue';detail='The host excluded you for this clue. You can play again on another clue.';}
    else if(winner?.id===self?.id){status='You buzzed first';detail='The host has your buzz. Wait for their next action.';}
    else if(winner){status='Another player buzzed first';detail=`${winner.name} has the first buzz. Wait for the host.`;}
    else if(state.revealed){status='Buzzing closed';detail='The answer has been revealed.';}
    else if(state.buzzer.open){status=pending?'Sending your buzz…':'Buzzing open';detail='Tap once. The first valid arrival at the server wins.';}
    else{status='Buzzing closed';detail='Wait for the host to open buzzing. Early taps are never queued.';}
  }
  function buzz(){
    const socket=socketRef.current,s=stateRef.current;if(!canBuzz||!socket?.connected||!s?.buzzer.windowId||pendingRef.current)return;
    pendingRef.current=true;setPending(true);setError('');
    // Volatile + connected guard: never buffer or retry a tap across a reconnect.
    socket.timeout(3500).volatile.emit('player:buzz',{sessionId,windowId:s.buzzer.windowId},(err:Error|null,result:ActionResult)=>{pendingRef.current=false;setPending(false);if(err||!result?.ok)setError(result?.error||'No buzz confirmation received. Check the current state; your tap will not be retried.');});
  }
  async function submitFinal(payload:Record<string,unknown>):Promise<ActionResult>{
    const socket=socketRef.current,s=stateRef.current;if(!socket?.connected||!s?.final)return {ok:false,error:'Connect to the current Final stage first.'};
    return new Promise(resolve=>socket.timeout(4000).volatile.emit('player:final',{...payload,sessionId,finalId:s.final!.id,commandId:submissionId()},(err:Error|null,result:ActionResult)=>resolve(err?{ok:false,error:'No confirmation received. Check the saved state before retrying.'}:result)));
  }
  return <main className="player-page"><header><p className="eyebrow">BLUEBOARD · YOUR PHONE BUZZER</p><span className="player-connection" role="status">{connection}</span></header><h1>{state?.title||'Join game night'}</h1>{!identity?(state?.finished&&state.results?<FinalResults results={state.results}/>:<form onSubmit={join} className="player-join-form"><p>Play as yourself. One name, one buzzer.</p><label>Your name<input value={name} onChange={e=>setName(e.target.value)} maxLength={24} autoComplete="nickname" autoFocus required placeholder="Name or nickname"/></label><button className="gold" disabled={joining||!connected||!state?.joiningOpen}>{joining?'Joining…':'Join game'}</button>{state&&!state.joiningOpen&&<p role="status">Joining is closed. Ask the host to open joining.</p>}<p className="muted">Names must be unique in this session. Keep using this browser to retain your player.</p></form>):<><div className="player-name"><span>PLAYING AS</span><strong>{identity.player.name}</strong></div><p className="player-score">{dollars(self?.score||0)}</p>{state?.finished&&state.results&&<FinalResults results={state.results}/>}{state?.round==='final'?<FinalPlayer key={state.final!.id} state={state} connected={connected} send={submitFinal}/>:<section className={`phone-buzzer ${canBuzz?'is-open':''} ${winner?.id===self?.id&&self?'is-winner':''}`}><h2 aria-live="polite">{status}</h2><p>{detail}</p>{state?.attempt?.playerId===self?.id&&<ResponseClock attempt={state?.attempt||null} serverNow={state?.serverNow||Date.now()}/>}<button className="buzz-button" onClick={buzz} disabled={!canBuzz} aria-label="Buzz" aria-describedby="buzz-help">{pending?'SENDING…':winner?.id===self?.id&&self?'FIRST!':canBuzz?'BUZZ':'WAIT'}<span>{canBuzz?'Tap once':'Not accepting taps'}</span></button><p id="buzz-help">Use one active tab. Server arrival order decides the first buzz.</p></section>}</>}{error&&<p className="error-banner" role="alert">{error}</p>}{storageNote&&<p role="status" className="muted">{storageNote}</p>}<footer>Same Wi-Fi. Friendly competition.</footer></main>;
}
