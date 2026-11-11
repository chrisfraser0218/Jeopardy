import { randomUUID } from 'node:crypto';
import { readFile,writeFile,unlink } from 'node:fs/promises';
import { join,extname } from 'node:path';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { fileTypeFromBuffer } from 'file-type';
import { manifestSchema,transferLimits as limits,type Manifest } from '../shared/transfer.js';
import { gameInput,enabledClues,isReady,type Game } from '../shared/model.js';
import type { openStore } from './db.js';
function fail(message:string):never{throw Object.assign(new Error(message),{status:400});}
export function allClues(g:any):any[]{return [...g.categories.flatMap((c:any)=>c.clues),...(g.doubleJeopardy?.categories.flatMap((c:any)=>c.clues)||[]),...(g.finalJeopardy?[g.finalJeopardy.clue]:[])];}
export async function zipFiles(files:Map<string,Buffer>){const zip=new yazl.ZipFile();for(const [name,data] of files)zip.addBuffer(data,name);const chunks:Buffer[]=[];const done=new Promise<Buffer>((resolve,reject)=>{zip.outputStream.on('data',d=>chunks.push(d));zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));zip.outputStream.on('error',reject);});zip.end();return done;}
export function unzip(buffer:Buffer):Promise<Map<string,Buffer>>{
 if(buffer.length>limits.archive)fail('Package exceeds the 64 MB archive limit.');
 return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true,decodeStrings:true},(error,zip)=>{
  if(error||!zip)return reject(Object.assign(Error('Invalid or corrupt ZIP package.'),{status:400}));
  const files=new Map<string,Buffer>(),seen=new Set<string>();let total=0,count=0,failed=false;
  const abort=(e:unknown)=>{if(failed)return;failed=true;zip.close();reject(Object.assign(Error(e instanceof Error?e.message:'Invalid ZIP package.'),{status:400}));};
  zip.on('error',abort);zip.on('end',()=>{if(!failed)resolve(files);});
  zip.on('entry',(entry:yauzl.Entry)=>{
   try{
    const name=entry.fileName,mode=(entry.externalFileAttributes>>>16)&0xffff;
    if(++count>limits.fileCount)fail('Package has too many entries (maximum 130).');
    if(seen.has(name.toLowerCase()))fail('Duplicate archive paths are forbidden.');seen.add(name.toLowerCase());
    if(name!=='manifest.json'&&!/^media\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(jpg|jpeg|png|webp|mp3|wav)$/.test(name))fail('Unsafe or unsupported archive path. Only manifest.json and media files are allowed.');
    if(name.includes('..')||(mode&0xf000)===0xa000||((mode&0xf000)!==0&&(mode&0xf000)!==0x8000))fail('Symlinks and nonregular files are forbidden.');
    if(entry.generalPurposeBitFlag&1)fail('Encrypted archives are unsupported.');
    const max=name==='manifest.json'?limits.manifest:20*1024*1024;
    total+=entry.uncompressedSize;if(entry.uncompressedSize>max||total>limits.expanded)fail('Expanded package or individual file exceeds its limit.');
    zip.openReadStream(entry,(err,stream)=>{if(err||!stream)return abort(err||Error('Cannot read archive file.'));const chunks:Buffer[]=[];let size=0;stream.on('data',d=>{size+=d.length;if(size>max){stream.destroy(Error('Expanded file exceeds its limit.'));return;}chunks.push(d);});stream.on('error',abort);stream.on('end',()=>{if(!failed){files.set(name,Buffer.concat(chunks));zip.readEntry();}});});
   }catch(e){abort(e);}
  });zip.readEntry();
 }));
}
async function mediaType(data:Buffer,path:string){
 const type=await fileTypeFromBuffer(data).catch(()=>undefined);const formats:Record<string,{kind:'image'|'audio';ext:string[];max:number}>={'image/jpeg':{kind:'image',ext:['.jpg','.jpeg'],max:10},'image/png':{kind:'image',ext:['.png'],max:10},'image/webp':{kind:'image',ext:['.webp'],max:10},'audio/mpeg':{kind:'audio',ext:['.mp3'],max:20},'audio/wav':{kind:'audio',ext:['.wav'],max:20},'audio/x-wav':{kind:'audio',ext:['.wav'],max:20}};
 const format=type&&formats[type.mime];if(!type||!format||!format.ext.includes(extname(path).toLowerCase()))fail(`Media contents do not match a supported file type: ${path}`);if(data.length>format.max*1024*1024)fail(`${path} exceeds the ${format.max} MB limit.`);return {mime:type.mime,kind:format.kind,ext:type.ext};
}
export function transferService(store:ReturnType<typeof openStore>,directory:string){
 let processing=false;
 const pending=new Map<string,{manifest:Manifest;files:Map<string,Buffer>;expires:number}>();
 function cleanup(){for(const [id,p] of pending)if(p.expires<Date.now())pending.delete(id);}
 function remap(m:Manifest,ids:Map<string,string>):Game{
  const g=structuredClone(m.game) as any;const clue=(q:any)=>{q.id=randomUUID();q.imageId=q.image?ids.get(q.image):null;q.audioId=q.audio?ids.get(q.audio):null;delete q.image;delete q.audio;};
  for(const board of [g.categories,...(g.doubleJeopardy?[g.doubleJeopardy.categories]:[])])for(const c of board){c.id=randomUUID();c.clues.forEach(clue);}if(g.finalJeopardy)clue(g.finalJeopardy.clue);
  return {...gameInput.parse({...g,revision:1}),id:randomUUID(),updatedAt:new Date().toISOString(),sample:false};
 }
 async function preview(data:Buffer,kind:'json'|'zip'){
  if(processing)fail('Another import is being validated. Wait for it to finish.');processing=true;try{
  cleanup();if(pending.size>=3)fail('Finish or cancel a pending import before opening another.');
  let files:Map<string,Buffer>;if(kind==='zip')files=await unzip(data);else{if(data.length>limits.manifest)fail('JSON exceeds the 2 MB manifest limit.');files=new Map([['manifest.json',data]]);}
  const raw=files.get('manifest.json');if(!raw)fail('The ZIP must contain manifest.json at its root.');if(raw.length>limits.manifest)fail('Manifest exceeds 2 MB.');let parsed:unknown;try{parsed=JSON.parse(raw.toString('utf8'));}catch{fail('The manifest is not valid JSON.');}
  if((parsed as any)?.version!==1)fail('Unsupported game format version. This app accepts version 1.');const manifest=manifestSchema.parse(parsed);
  if(kind==='json'&&manifest.media.length)fail('This game needs attachments. Import a ZIP containing manifest.json and its media files.');
  const declared=new Map(manifest.media.map(m=>[m.path,m]));if(declared.size!==manifest.media.length)fail('Duplicate media references are forbidden.');
  const refs=new Map<string,'image'|'audio'>();for(const q of allClues(manifest.game))for(const field of ['image','audio'] as const)if(q[field]){if(refs.has(q[field])&&refs.get(q[field])!==field)fail('A file cannot be both image and audio.');refs.set(q[field],field);}
  if(refs.size!==declared.size||[...declared.keys()].some(p=>!refs.has(p)))fail('Declare exactly the media referenced by this game.');
  for(const [path,kind] of refs){if(!declared.has(path)||!files.has(path))fail(`Missing referenced media: ${path}`);if((await mediaType(files.get(path)!,path)).kind!==kind)fail(`Wrong media kind: ${path}`);}
  if([...files.keys()].some(p=>p!=='manifest.json'&&!refs.has(p)))fail('The archive contains unreferenced files.');
  const game=remap(manifest,new Map([...refs.keys()].map(p=>[p,randomUUID()])));const total=enabledClues(game).length,ready=enabledClues(game).filter(isReady).length;
  const warnings:string[]=[];if(ready<total||[game.categories,...(game.doubleJeopardy?.enabled?[game.doubleJeopardy.categories]:[])].some(b=>b.some(c=>!c.name.trim()))||game.finalJeopardy?.enabled&&!game.finalJeopardy.category.trim())warnings.push('Incomplete game: imports as a draft. Complete enabled clues and category names before starting.');
  const token=randomUUID();pending.set(token,{manifest,files,expires:Date.now()+10*60*1000});return {token,title:game.title,rounds:['First board',...(game.doubleJeopardy?.enabled?['Double Jeopardy']:[]),...(game.finalJeopardy?.enabled?['Final Jeopardy']:[])],categories:[...game.categories.map(c=>c.name),...(game.doubleJeopardy?.enabled?game.doubleJeopardy.categories.map(c=>c.name):[]),...(game.finalJeopardy?.enabled?[game.finalJeopardy.category]:[])],clueCount:allClues(game).length,mediaCount:refs.size,warnings};
  }finally{processing=false;}
 }
 async function commit(token:string){
  cleanup();const p=pending.get(token);if(!p)fail('Import preview expired or was already used. Preview the file again.');pending.delete(token);
  const created:string[]=[],ids=new Map<string,string>();
  try{
   const media=[];for(const item of p.manifest.media){const bytes=p.files.get(item.path)!,type=await mediaType(bytes,item.path),id=randomUUID(),filename=`${id}.${type.ext}`;ids.set(item.path,id);try{await writeFile(join(directory,'uploads',filename),bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')await unlink(join(directory,'uploads',filename)).catch(()=>{});throw error;}created.push(filename);media.push({id,filename,name:item.name,attribution:item.attribution||'',...type,size:bytes.length});}
   const game=remap(p.manifest,ids);store.db.exec('BEGIN IMMEDIATE');try{for(const m of media)store.db.prepare('INSERT INTO media (id,kind,name,mime,size,filename,attribution) VALUES (?,?,?,?,?,?,?)').run(m.id,m.kind,m.name,m.mime,m.size,m.filename,m.attribution);store.write(game,true,true);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}return store.get(game.id)!;
  }catch(e){await Promise.all(created.map(f=>unlink(join(directory,'uploads',f)).catch(()=>{})));throw e;}
 }
 async function exportGame(id:string,kind:'json'|'zip'){
  const game=store.get(id);if(!game)throw Object.assign(Error('Game not found.'),{status:404});const g=structuredClone(game) as any;delete g.id;delete g.revision;delete g.updatedAt;delete g.sample;
  const media:Manifest['media']=[],files=new Map<string,Buffer>(),paths=new Map<string,string>();let expanded=0;
  for(const q of allClues(g)){delete q.id;for(const [field,key] of [['image','imageId'],['audio','audioId']] as const){const id=q[key];q[field]=null;delete q[key];if(!id)continue;let path=paths.get(id);if(!path){const m=store.media(id);if(!m)fail('Missing attachment metadata. Replace the attachment before exporting.');path=`media/${m.filename}`;let bytes:Buffer;try{bytes=await readFile(join(directory,'uploads',m.filename));}catch{fail(`Missing attachment file: ${m.name}. Replace it before exporting.`);}await mediaType(bytes,path);expanded+=bytes.length;if(expanded>limits.expanded- limits.manifest)fail('Game attachments exceed the 256 MB package limit.');files.set(path,bytes);paths.set(id,path);media.push({path,name:m.name,...(m.attribution?{attribution:m.attribution}:{})});}q[field]=path;}}
  for(const board of [g.categories,...(g.doubleJeopardy?[g.doubleJeopardy.categories]:[])])for(const c of board)delete c.id;
  const manifest=manifestSchema.parse({format:'jeopardy-game',version:1,game:g,media});
  if(kind==='json'&&media.length)fail('JSON does not include attachments. Choose ZIP to preserve all images and audio.');const json=Buffer.from(JSON.stringify(manifest,null,2));if(json.length>limits.manifest)fail('Manifest exceeds the 2 MB limit.');files.set('manifest.json',json);const result=kind==='json'?json:await zipFiles(files);if(kind==='zip'&&result.length>limits.archive)fail('Compressed package exceeds 64 MB.');return result;
 }
 return {preview,commit,exportGame,cancel:(token:string)=>pending.delete(token)};
}
