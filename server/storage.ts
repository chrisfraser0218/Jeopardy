import { openSync,closeSync,writeFileSync,readFileSync,unlinkSync,mkdirSync,existsSync,realpathSync } from 'node:fs';
import { join,resolve } from 'node:path';
export function lockData(directory:string){
 mkdirSync(directory,{recursive:true});const path=join(realpathSync(directory),'.hosting-lock');
 for(let i=0;i<2;i++)try{const fd=openSync(path,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);return ()=>{try{if(readFileSync(path,'utf8')===String(process.pid))unlinkSync(path);}catch{}};}catch(error){
  if(!existsSync(path))throw error;const pid=Number(readFileSync(path,'utf8'));if(!Number.isInteger(pid)||pid<=0)throw Error('Storage lock is unreadable. Stop other Jeopardy processes and inspect .hosting-lock.');
  try{process.kill(pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH'){unlinkSync(path);continue;}throw e;}throw Error('This data folder is already being hosted by another process. Quit that instance first.');
 }
 throw Error('Could not acquire the data folder lock.');
}
export function developmentDirectory(){const directory=resolve(process.env.DATA_DIR||'data');if(!process.env.JEOPARDY_PACKAGED&&directory.includes('/Library/Application Support/Jeopardy'))throw Error('Development must use its own data folder, not the installed app storage.');return directory;}
