import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ActionName, ActionResult, AudioCommand, LiveState, PublicClue, Setup } from '../shared/live';
import './live.css';
import { JoinQr, PartyControls, PartyRoster } from './Party';

// getRandomValues works on local HTTP Wi-Fi origins where randomUUID is unavailable.
function commandId(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function silentAudio(){const bytes=new Uint8Array(44+1600),view=new DataView(bytes.buffer);const text=(offset:number,s:string)=>[...s].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));text(0,'RIFF');view.setUint32(4,bytes.length-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,1600,true);return URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));}
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
async function request<T>(path:string,options:RequestInit={}):Promise<T>{
  const res=await fetch(`/api/live${path}`,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  if(!res.ok)throw new Error((await res.json()).error);
  return res.status===204?undefined as T:res.json();
}
export async function startLive(gameId:string){await request('/start',{method:'POST',body:JSON.stringify({gameId})});window.dispatchEvent(new Event('session-change'));}
export function SessionSetup(){
  const [setup,setSetup]=useState<Setup|null>(null),[origin,setOrigin]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{
    let active=true;
    const load=()=>request<Setup>('/setup').then(value=>{if(active){setSetup(value);setOrigin(o=>o||value.origins[1]||value.origins[0]);}}).catch(e=>{if(active)setError(e.message);});
    void load();const timer=setInterval(load,3000);window.addEventListener('session-change',load);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('session-change',load);};
  },[]);
  async function copy(value:string){try{await navigator.clipboard.writeText(value);setNotice('Link copied.');}catch{setNotice('Select the link field and copy it manually.');}}
  if(!setup)return <p role="status" className="muted">{error||'Checking live session…'}</p>;
  const display=`${origin}/display`,host=`${origin}/host#${setup.hostToken}`;
  return <section className="session-setup"><div className="section-heading"><div><p className="eyebrow">LOCAL GAME NIGHT · PHASE 3</p><h2>{setup.session?setup.session.title:'Ready for the big screen'}</h2><p className="muted">{setup.session?`${setup.session.paused?'Paused after restart — resume from the host.':'Session running'} · ${setup.session.completed}/30 clues complete`:'Start a complete saved game below. Saved definitions stay separate from live progress.'}</p></div><a className="secondary link-button" href="/display" target="_blank" rel="noreferrer">Open display ↗</a></div>
    <p className="connection-help">MacBook: <strong>{setup.origins[0]}</strong>{setup.origins.length>1?' · Wi-Fi addresses available below.':' · No Wi-Fi address detected. Connect this Mac to Wi-Fi and refresh.'}</p>
    {setup.session&&<><label>iPad / network address<select value={origin} onChange={e=>setOrigin(e.target.value)}>{setup.origins.map(o=><option key={o}>{o}</option>)}</select></label><div className="session-links"><label>Display link<input aria-label="Display link" readOnly value={display}/></label><button className="secondary" onClick={()=>void copy(display)}>Copy display link</button><label>Private host link<input aria-label="Private host link" readOnly value={host}/></label><button className="secondary" onClick={()=>void copy(host)}>Copy host link</button></div><div className="session-options"><a className="gold link-button" href={`/host#${setup.hostToken}`} target="_blank" rel="noreferrer">{setup.session.paused?'Open host to resume':'Open host on this Mac'} ↗</a><button className="subtle danger" onClick={async()=>{if(!window.confirm('End this live session? Its progress will be cleared. Your saved game will remain unchanged.'))return;try{await request('/end',{method:'POST'});window.dispatchEvent(new Event('session-change'));setError('');}catch(e){setError((e as Error).message);}}}>End session</button></div><p className="muted">Keep the host link private: anyone with it can see answers and control this session. Paste it into the iPad browser. Use a Wi-Fi address, not localhost, on the iPad.</p></>}
    {!setup.session&&setup.origins.length>1&&<p className="muted">Wi-Fi: {setup.origins.slice(1).join(' · ')}</p>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
  </section>;
}
function ClueImage({id}:{id:string}){const [failed,setFailed]=useState(false);return failed?<p className="error" role="alert">Image unavailable. Ask the host to return to the board or use another clue.</p>:<img className="live-image" src={`/api/media/${id}`} alt="Clue image" onError={()=>setFailed(true)}/>;}
export function LivePage({host=false}:{host?:boolean}){
  const [state,setState]=useState<LiveState|null>(null),[connection,setConnection]=useState('Connecting…'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[unlocked,setUnlocked]=useState(false),[reopen,setReopen]=useState<string|null>(null);
  const socketRef=useRef<Socket|null>(null),audioRef=useRef<HTMLAudioElement|null>(null),unlockedRef=useRef(false),stateRef=useRef<LiveState|null>(null),audioEpoch=useRef(0);
  const [token]=useState(()=>{
    if(!host)return '';
    const credential=window.location.hash.slice(1);
    if(credential){sessionStorage.setItem('blueboard-host',credential);history.replaceState(null,'',window.location.pathname);return credential;}
    return sessionStorage.getItem('blueboard-host')||'';
  });
  function stop(){audioEpoch.current++;const audio=audioRef.current;if(audio){audio.pause();audio.currentTime=0;}}
  function report(playback:'playing'|'paused'|'stopped',message:string|null=null){const session=stateRef.current?.session;if(session&&socketRef.current?.connected)socketRef.current.emit('audio:status',{sessionId:session.id,revision:session.revision,clueId:session.currentClueId,playback,error:message});}
  useEffect(()=>{
    const socket=io({auth:{role:host?'host':'display',...(host?{token}:{})},reconnectionDelay:500,reconnectionDelayMax:2000});socketRef.current=socket;
    socket.on('connect',()=>{setConnection('Connected');setError('');});
    socket.on('disconnect',(reason:string)=>{setConnection(reason==='io server disconnect'?'Session ended':'Disconnected — reconnecting…');stop();unlockedRef.current=false;setUnlocked(false);setBusy(false);});
    socket.io.on('reconnect_attempt',()=>setConnection('Reconnecting…'));
    socket.on('connect_error',(e:Error)=>{setConnection('Disconnected');setError(host?e.message:'Cannot reach the MacBook. Check Wi-Fi and the server.');stop();});
    socket.on('state',(next:LiveState)=>{
      const previous=stateRef.current;
      if(previous?.session?.id!==next.session?.id||previous?.session?.currentClueId!==next.session?.currentClueId||next.session?.paused||!next.session)stop();
      if(!host&&next.audio.ownerId!==socket.id){stop();unlockedRef.current=false;setUnlocked(false);}
      stateRef.current=next;setState(next);
    });
    socket.on('audio:stop',stop);
    socket.on('audio:command',async(command:AudioCommand)=>{
      const current=stateRef.current,session=current?.session;
      if(host||!socket.connected||!unlockedRef.current||current?.audio.ownerId!==socket.id||!session||session.paused||session.id!==command.sessionId||session.currentClueId!==command.clueId||session.revision!==command.revision||Date.now()>command.expiresAt)return;
      const audio=audioRef.current;if(!audio)return;
      const epoch=++audioEpoch.current;
      try{
        if(command.type==='pause'){audio.pause();report('paused');return;}
        if(command.type==='replay')audio.currentTime=0;
        await audio.play();
        if(epoch!==audioEpoch.current||!socket.connected||stateRef.current?.audio.ownerId!==socket.id){audio.pause();return;}
        report('playing');
      }catch{unlockedRef.current=false;setUnlocked(false);report('stopped','Playback was blocked or the file could not play. On the MacBook, Enable Audio again and check the file.');}
    });
    return()=>{stop();socket.disconnect();socketRef.current=null;};
  },[host,token]);
  const session=state?.session;
  const category=session?.game.categories.find(c=>c.clues.some(q=>q.id===session.currentClueId));
  const clue=category?.clues.find(q=>q.id===session?.currentClueId);
  // Keep one audio element for the life of the page: the user gesture unlocks this same element.
  useEffect(()=>{
    if(host)return;
    const audio=audioRef.current;if(!audio)return;
    stop();audio.removeAttribute('src');
    if(clue?.audioId)audio.src=`/api/media/${clue.audioId}`;
    audio.load();
  },[clue?.audioId,host]);
  async function enableAudio(){
    const socket=socketRef.current;if(!socket?.connected||!session||session.paused)return;
    setError('');
    let silentUrl:string|undefined;
    try{
      const audio=audioRef.current!;
      if(!clue?.audioId){silentUrl=silentAudio();audio.src=silentUrl;}
      audio.muted=true;await audio.play();audio.pause();audio.currentTime=0;audio.muted=false;
      if(!clue?.audioId){audio.removeAttribute('src');audio.load();}
      if(!socket.connected||stateRef.current?.session?.id!==session.id)throw new Error('Connection changed.');
      socket.timeout(4000).volatile.emit('audio:claim',{},(err:Error|null,result:ActionResult)=>{
        if(err||!result?.ok){setError(result?.error||'Audio setup timed out. Try again.');return;}
        unlockedRef.current=true;setUnlocked(true);
      });
    }catch{if(audioRef.current)audioRef.current.muted=false;setError('Audio could not be enabled. Select an audio clue and try Enable Audio again in this display.');}
    finally{if(silentUrl)URL.revokeObjectURL(silentUrl);}
  }
  async function action(type:ActionName,clueId?:string,extra:Partial<import('../shared/live').HostAction>={}){
    const socket=socketRef.current;
    if(!socket?.connected||!session||busy)return;
    setBusy(true);setError('');
    socket.timeout(4000).volatile.emit('host:action',{...extra,type,clueId,sessionId:session.id,expectedRevision:session.revision,commandId:commandId()},(err:Error|null,result:ActionResult)=>{
      setBusy(false);if((err||!result?.ok)&&stateRef.current?.session)setError(result?.error||'No confirmation received. Review the synchronized board before trying again.');
    });
  }
  const connected=connection==='Connected',canAct=connected&&!busy&&session&&!session.paused;
  const audioReady=canAct&&clue?.audioId&&state?.audio.ready;
  return <div className={host?'live-shell host-shell':'live-shell display-shell'}><header className="live-header"><div><p className="eyebrow">BLUEBOARD · {host?'PRIVATE HOST':'BOARD DISPLAY'}</p><h1>{session?.game.title||'Game night'}</h1></div><div className="live-utilities"><span role="status" className={`live-connection ${connected?'online':''}`}>{connection}</span>{!host&&<button className="secondary" onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else document.documentElement.requestFullscreen().catch(()=>setError('Fullscreen is unavailable in this browser. Try its View menu.'));}}>Fullscreen</button>}</div></header>
    {error&&<p className="error-banner" role="alert">{error}</p>}
    {!state&&<div className="live-empty"><h2>{host&&!token?'Private host link required':'Connecting to your MacBook…'}</h2><p className="muted">{host?'Open the private host link from the MacBook library.':'Keep the game server running on the MacBook.'}</p></div>}
    {state&&!session&&<div className="live-empty"><h2>{host?'Session ended':'Waiting for a game'}</h2><p className="muted">Start a complete saved game from the library on the MacBook.</p>{!host&&<a href="/" className="secondary link-button">MacBook library</a>}</div>}
    {session&&<>{session.paused&&<div className="pause-notice"><strong>Session paused after server restart</strong><p>Progress is saved. Audio is stopped.</p>{host&&<button className="gold" disabled={!connected||busy} onClick={()=>void action('resume')}>Resume session</button>}</div>}
      {host&&<div className="host-status"><span>{session.completed.length}/30 complete · {clue?'Clue open':session.completed.length===30?'All clues complete':'Board ready'}</span><button className="subtle danger" disabled={!connected||busy} onClick={()=>{if(window.confirm('End this session and clear its live progress? The saved game will remain unchanged.'))void action('end');}}>End session</button></div>}
      {!host&&<><JoinQr session={session}/><PartyRoster state={state}/></>}
      {clue?<section className="live-clue"><p className="eyebrow">{category?.name} · {money(clue.value)}</p>{clue.text&&<p className="live-clue-text">{clue.text}</p>}{clue.imageId&&<ClueImage key={clue.imageId} id={clue.imageId}/>} {clue.audioId&&<p className="audio-indicator">♫ Audio clue · {state.audio.playback}</p>}
        {(host||session.revealed)&&<div className="live-answer"><p className="eyebrow">{host?'Host answer · '+(session.revealed?'visible on display':'hidden on display'):'Correct answer'}</p><p>{clue.answer}</p></div>}
        {host&&<div className="host-controls"><button className="gold" disabled={!canAct||session.revealed} onClick={()=>void action('reveal')}>{session.revealed?'Answer revealed':'Reveal answer on display'}</button><button className="complete-button" disabled={!canAct} onClick={()=>void action('complete')}>Mark complete & return</button><button className="secondary" disabled={!canAct} onClick={()=>void action('board')}>Return without completing</button>{clue.audioId&&<div className="host-audio"><p>Sound plays only on the designated MacBook display.</p><div>{(['play','pause','replay'] as const).map(type=><button className="secondary" key={type} disabled={!audioReady} onClick={()=>void action(type)}>{type==='play'?'Play audio':type==='pause'?'Pause audio':'Replay audio'}</button>)}</div></div>}</div>}
      </section>:<div className="live-board" aria-label={host?'Host board':'Game board'}>{session.game.categories.map(c=><section className="live-category" key={c.id}><h2>{c.name}</h2>{c.clues.map(q=>{const complete=session.completed.includes(q.id);return host?<button key={q.id} className={`live-tile ${complete?'used':''}`} disabled={!canAct} aria-label={`${complete?'Reopen':'Select'} ${c.name} ${money(q.value)}`} onClick={()=>complete?setReopen(q.id):void action('select',q.id)}>{complete?<><span>✓</span><small>Reopen {money(q.value)}</small></>:money(q.value)}</button>:<div key={q.id} className={`live-tile ${complete?'used':''}`} aria-label={`${c.name} ${money(q.value)} ${complete?'complete':'available'}`}>{complete?'—':money(q.value)}</div>;})}</section>)}</div>}
      {host&&<PartyControls state={state} connected={connected} busy={busy} send={(type,extra)=>void action(type,undefined,extra)}/>}
      {host&&<section className="audio-readiness" role="status"><strong>Display audio: </strong>{state.audio.error||(!state.audio.ownerId?'Not enabled — tap Enable Audio on the MacBook display.':state.audio.ready?`Ready · ${state.audio.playback}`:'Waiting for display audio.')}</section>}
    </>}
    {!host&&<div className="display-audio"><audio ref={audioRef} preload="metadata" onEnded={()=>report('stopped')} onError={()=>{if(clue?.audioId)report('stopped','Audio file could not load or decode. Try another file in a future game; return to the board to continue.');}}/>{unlocked?<><span>Audio enabled on this display</span><button className="subtle" onClick={()=>{stop();unlockedRef.current=false;setUnlocked(false);socketRef.current?.emit('audio:release');}}>Release Audio</button></>:<button className="secondary" disabled={!connected||!session||session.paused} onClick={()=>void enableAudio()}>Enable Audio</button>}<p>Enable sound once on the MacBook. Other display tabs stay silent.</p></div>}
    {reopen&&<ReopenDialog clue={session?.game.categories.flatMap(c=>c.clues).find(q=>q.id===reopen)} onCancel={()=>setReopen(null)} onConfirm={()=>{const id=reopen;setReopen(null);void action('reopen',id);}}/>}
  </div>;
}
function ReopenDialog({clue,onCancel,onConfirm}:{clue?:PublicClue;onCancel:()=>void;onConfirm:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog className="modal" ref={ref} onCancel={onCancel}><h2>Reopen {money(clue?.value||0)} clue?</h2><p className="muted">It will become available again and open with its answer hidden.</p><div className="modal-actions"><button className="secondary" onClick={onCancel}>Cancel</button><button className="gold" onClick={onConfirm}>Reopen clue</button></div></dialog>;
}
