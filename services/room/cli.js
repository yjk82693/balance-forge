import { createRoomServer } from './server.js';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('INVALID_SCHEMA');
const server = createRoomServer();
const address = await server.listen(port, process.env.HOST ?? '0.0.0.0');
console.log(`Room server listening on http://localhost:${address.port} (LAN: use this computer's IP)`);
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return;
  closing = true;
  await server.close();
  process.exitCode = 0;
});
