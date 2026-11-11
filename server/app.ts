import express from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { z } from 'zod';
import { gameInput } from '../shared/model.js';
import { openStore } from './db.js';
import { createServer } from 'node:http';
import { attachLive } from './live.js';
import { localOnly, localRequest, sameOrigin } from './access.js';

export function createApp(directory=resolve('data'), options:{now?:()=>number}={}) {
  const store=openStore(directory);
  const app=express();
  const server=createServer(app);
  const live=attachLive(store,server,options.now);
  app.disable('x-powered-by');
  app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');next();});
  // Same-origin writes also block cross-site form submissions to this local service.
  app.use('/api',(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if (!sameOrigin(req) || req.get('sec-fetch-site')==='cross-site') return res.status(403).json({error:'Open the app directly on the game server origin.'});
    next();
  });
  app.use(express.json({limit:'8mb'}));
  app.get('/api/live/setup',localOnly,(req,res)=>res.json(live.setup(req.socket.localPort!)));
  app.post('/api/live/start',localOnly,(req,res)=>{const {gameId,timerSeconds}=z.object({gameId:z.uuid(),timerSeconds:z.number().int().min(1).max(120).nullable().default(10)}).parse(req.body);live.start(gameId,timerSeconds);res.status(201).json(live.setup(req.socket.localPort!));});
  app.post('/api/live/end',localOnly,(req,res)=>{if(!live.authorized(req.get('authorization')?.replace(/^Bearer /,'')))return res.status(401).json({error:'A valid host credential is required to end the game.'});live.endLocal();res.status(204).end();});
  app.get('/api/live',(_req,res)=>res.json(live.publicState()));
  app.get('/api/live/host',(req,res)=>{
    if(!live.authorized(req.get('authorization')?.replace(/^Bearer /,'')))return res.status(401).json({error:'A valid private host link is required.'});
    res.json(live.hostState());
  });
  app.post('/api/player/join',(req,res)=>res.status(201).json(live.players.join(req.body)));
  app.get('/api/player/session/:id',(req,res)=>res.json(live.players.view(req.params.id)));
  app.use('/api/games',localOnly);
  app.post('/api/media',localOnly);
  app.get('/api/games',(_req,res)=>res.json(store.list()));
  app.post('/api/games',(req,res)=>{const p=z.object({title:z.string().trim().min(1).max(200),description:z.string().max(2000).default('')}).parse(req.body);res.status(201).json(store.create(p.title,p.description));});
  app.get('/api/games/:id',(req,res)=>{const game=store.get(req.params.id);if(!game)return res.status(404).json({error:'Game not found.'});res.json(game);});
  app.put('/api/games/:id',(req,res)=>{const old=store.get(req.params.id);if(!old)return res.status(404).json({error:'Game not found.'});const input=gameInput.parse(req.body);res.json(store.write({...old,...input,updatedAt:new Date().toISOString()}));});
  app.delete('/api/games/:id',(req,res)=>{if(!store.remove(req.params.id).changes)return res.status(404).json({error:'Game not found.'});res.status(204).end();});
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1,fields:0}}).single('file');
  app.post('/api/media',upload,async(req,res)=>{
    const f=req.file;
    if(!f)return res.status(400).json({error:'Choose an image or audio file.'});
    const type=await fileTypeFromBuffer(f.buffer).catch(()=>undefined);
    const formats:Record<string,{kind:'image'|'audio'; extensions:string[];max:number}>={
      'image/jpeg':{kind:'image',extensions:['.jpg','.jpeg'],max:10},'image/png':{kind:'image',extensions:['.png'],max:10},'image/webp':{kind:'image',extensions:['.webp'],max:10},'audio/mpeg':{kind:'audio',extensions:['.mp3'],max:20},'audio/wav':{kind:'audio',extensions:['.wav'],max:20},'audio/x-wav':{kind:'audio',extensions:['.wav'],max:20}
    };
    const format=type && formats[type.mime];
    if(!type || !format || !format.extensions.includes(extname(f.originalname).toLowerCase()))return res.status(400).json({error:'Upload a JPEG, PNG, WebP, MP3, or WAV file whose content matches its extension.'});
    if(f.size>format.max*1024*1024)return res.status(413).json({error:`${format.kind==='image'?'Images':'Audio clips'} must be ${format.max} MB or smaller.`});
    const id=crypto.randomUUID(), filename=`${id}.${type.ext}`;
    await writeFile(join(directory,'uploads',filename),f.buffer,{flag:'wx'});
    const media={id,kind:format.kind,name:f.originalname.slice(0,255),mime:type.mime,size:f.size};
    try {store.db.prepare('INSERT INTO media VALUES (?, ?, ?, ?, ?, ?)').run(id,media.kind,media.name,media.mime,media.size,filename);} catch(error){await unlink(join(directory,'uploads',filename));throw error;}
    res.status(201).json(media);
  });
  app.get('/api/media/:id',(req,res)=>{if(!localRequest(req)&&!live.currentMedia(req.params.id))return res.status(403).json({error:'This media is not part of the active session.'});const m=store.media(req.params.id);if(!m)return res.status(404).json({error:'Attachment not found.'});res.setHeader('Content-Type',m.mime);res.setHeader('Cache-Control','private, no-store');res.sendFile(resolve(directory,'uploads',m.filename));});
  app.use('/api',(_req,res)=>res.status(404).json({error:'API route not found.'}));
  app.get('/',(req,res,next)=>{if(!localRequest(req))return res.redirect('/display');next();});
  app.use(express.static(resolve('dist')));
  app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')));
  app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    if(error instanceof z.ZodError)return res.status(400).json({error:error.issues[0]?.message || 'Check the game details.'});
    if(error instanceof multer.MulterError)return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({error:error.code==='LIMIT_FILE_SIZE'?'Files must be 20 MB or smaller (images: 10 MB).':'Upload one file at a time, using the file field.'});
    const status=error.status || 500;
    if(status===500)console.error(error);
    res.status(status).json({error:status===500?'Could not complete the request. Check the server terminal and try again.':error.message});
  });
  return {app,store,server,live};
}
