import { DatabaseSync,backup } from 'node:sqlite';
import { mkdir,copyFile,rm,rename,readFile,writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join,resolve,basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/db.js';
export async function migrateLibrary(source:string,destination:string){
 source=resolve(source);destination=resolve(destination);if(source===destination||existsSync(join(destination,'games.sqlite')))throw Error('Destination already contains a library. Both folders are preserved. Export games from the old library and import them into this one.');
 if(!existsSync(join(source,'games.sqlite')))throw Error('Choose the data folder containing games.sqlite and uploads.');
 const backupDir=join(destination,'backups',`migration-${Date.now()}-${randomUUID()}`),stage=join(destination,`.migration-${randomUUID()}`);await mkdir(backupDir,{recursive:true});await mkdir(stage,{recursive:true});
 let db:DatabaseSync|undefined;
 try{
  db=new DatabaseSync(join(source,'games.sqlite'),{readOnly:true});await backup(db,join(backupDir,'games.sqlite'));db.close();db=undefined;
  const snapshot=new DatabaseSync(join(backupDir,'games.sqlite'),{readOnly:true});try{if((snapshot.prepare('PRAGMA integrity_check').get() as any).integrity_check!=='ok')throw Error('Source database failed its integrity check.');await mkdir(join(backupDir,'uploads'));for(const m of snapshot.prepare('SELECT filename FROM media').all() as {filename:string}[]){if(basename(m.filename)!==m.filename)throw Error('Invalid stored media filename.');await copyFile(join(source,'uploads',m.filename),join(backupDir,'uploads',m.filename));}}finally{snapshot.close();}
  await copyFile(join(backupDir,'games.sqlite'),join(stage,'games.sqlite'));await mkdir(join(stage,'uploads'));const {readdir}=await import('node:fs/promises');for(const f of await readdir(join(backupDir,'uploads')))await copyFile(join(backupDir,'uploads',f),join(stage,'uploads',f));
  const store=openStore(stage);let games=0;try{if(store.db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migrated records failed reference validation.');for(const item of store.list()){const g=store.get(item.id);if(!g||g.categories.length!==6||g.categories.some(c=>c.clues.length!==5))throw Error('A saved game failed validation.');games++;}store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}finally{store.db.close();}
  if(existsSync(join(destination,'games.sqlite')))throw Error('Destination library appeared during migration; nothing was replaced.');
  // Keep the complete consistent backup and the original source. Publish only validated files.
  if(existsSync(join(destination,'uploads')))throw Error('Destination uploads already exist; migration will not replace them.');
  await rename(join(stage,'uploads'),join(destination,'uploads'));try{await copyFile(join(stage,'games.sqlite'),join(destination,'games.sqlite'),1);}catch(e){await rm(join(destination,'uploads'),{recursive:true,force:true});throw e;}
  await writeFile(join(backupDir,'migration.json'),JSON.stringify({source,completedAt:new Date().toISOString(),games},null,2));return {games,backupDir};
 }finally{db?.close();await rm(stage,{recursive:true,force:true});}
}

export async function backupBeforeUpgrade(directory:string){
 if(!existsSync(join(directory,'games.sqlite')))return;
 const source=new DatabaseSync(join(directory,'games.sqlite'),{readOnly:true});
 try{const version=Number((source.prepare('PRAGMA user_version').get() as any).user_version);if(version<=0||version>=7)return;
  const target=join(directory,'backups',`before-v7-${Date.now()}-${randomUUID()}`);await mkdir(join(target,'uploads'),{recursive:true});await backup(source,join(target,'games.sqlite'));
  const snapshot=new DatabaseSync(join(target,'games.sqlite'),{readOnly:true});try{if((snapshot.prepare('PRAGMA integrity_check').get() as any).integrity_check!=='ok')throw Error('Pre-upgrade backup failed integrity validation.');for(const m of snapshot.prepare('SELECT filename FROM media').all() as {filename:string}[]){if(basename(m.filename)!==m.filename)throw Error('Invalid stored media filename.');await copyFile(join(directory,'uploads',m.filename),join(target,'uploads',m.filename));}}finally{snapshot.close();}
  await writeFile(join(target,'backup-complete.json'),JSON.stringify({schemaVersion:version,createdAt:new Date().toISOString()}));return target;
 }finally{source.close();}
}
