import { createApp } from './app.js';
const {app,store}=createApp(process.env.DATA_DIR);
const port=Number(process.env.PORT || 3000);
const server=app.listen(port,process.env.HOST || '127.0.0.1',()=>console.log(`Blueboard is ready: http://localhost:${(server.address() as {port:number}).port}\nYour games and media stay on this Mac. Press Control-C to stop.`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.db.close();process.exit(0);}));
