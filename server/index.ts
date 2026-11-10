import { createApp } from './app.js';
import { networkOrigins } from './live.js';
const {server,store,live}=createApp(process.env.DATA_DIR);
const port=Number(process.env.PORT || 3000);
server.listen(port,process.env.HOST || '0.0.0.0',()=>{
  const actualPort=(server.address() as {port:number}).port;
  console.log(`Blueboard is ready: http://localhost:${actualPort}`);
  console.log('Local Wi-Fi addresses (use the private host link shown in the library):');
  for(const origin of networkOrigins(actualPort).slice(1))console.log(`  ${origin}/display`);
  console.log('Library and editor: localhost only. Games and media stay on this Mac. Press Control-C to stop.');
});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
  live.io.close(()=>{store.db.close();process.exit(0);});
});
