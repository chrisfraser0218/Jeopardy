import { networkInterfaces } from 'node:os';
import { createServer as probeServer } from 'node:net';
import { createApp } from '../server/app.js';
import { backupBeforeUpgrade } from './migration.js';
import { lockData } from '../server/storage.js';
const parent=(process as any).parentPort;
const release=lockData(process.env.DATA_DIR!);let service:ReturnType<typeof createApp>|undefined,stopping=false;
function notify(data:unknown){parent?.postMessage(data);}
async function shutdown(){if(stopping)return;stopping=true;try{service?.live.prepareShutdown();service?.live.io.close(()=>{service?.store.db.close();release();process.exit(0);});if(!service){release();process.exit(0);}}catch{release();process.exit(1);}}
async function boot(){try{
 await backupBeforeUpgrade(process.env.DATA_DIR!);
 service=createApp(process.env.DATA_DIR);const s=service;
 const listen=(port:number)=>s.server.listen(port,'0.0.0.0');
 s.server.once('error',(e:NodeJS.ErrnoException)=>{if(e.code==='EADDRINUSE')listen(0);else throw e;});
 s.server.once('listening',()=>{notify({type:'ready',port:(s.server.address() as any).port,node:process.versions.node,sqlite:process.versions.sqlite,arch:process.arch});});const preferred=Number(process.env.PORT||3000);
 async function freeOn(host:string){return new Promise<boolean>(resolve=>{const probe=probeServer();probe.once('error',(e:NodeJS.ErrnoException)=>resolve(e.code!=='EADDRINUSE'));probe.listen(preferred,host,()=>probe.close(()=>resolve(true)));});}
 void (async()=>{let available=preferred!==0;const hosts=new Set(['127.0.0.1','::1',...Object.values(networkInterfaces()).flat().filter(i=>i?.family==='IPv4').map(i=>i!.address)]);for(const host of hosts)if(available)available=await freeOn(host);listen(available?preferred:0);})();
 setInterval(()=>notify({type:'hosting',active:Boolean(s.live.setup(0).session&&!s.live.setup(0).session!.finished)}),500).unref();
 parent?.on('message',(event:any)=>{if(event.data?.type==='shutdown')void shutdown();});
 process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
 // If the supervising Electron main process disappears, stop hosting too.
 setInterval(()=>{try{process.kill(Number(process.env.JEOPARDY_PARENT_PID),0);}catch{void shutdown();}},1000).unref();
}catch(error){const code=(error as NodeJS.ErrnoException).code;notify({type:'failed',message:code==='ENOENT'?'A stored data or attachment file is missing. Restore it from a backup before migration; original data was retained.':code==='EACCES'?'Cannot read or write application storage. Check this account’s folder permissions.':'Backend startup failed. Check storage permissions, available disk space, and whether this library needs a newer app.'});release();process.exit(1);}}
void boot();
