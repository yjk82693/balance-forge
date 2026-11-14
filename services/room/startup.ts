import { createRoomServer } from './server.ts';
function startupMessage(error, host, port) {
  if (error?.code === 'EADDRINUSE') {
    return `Port ${port} is already in use. Stop the other server or set PORT to a free port.`;
  }
  if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    return `Cannot listen on ${host}:${port} (${error.code}). Check local listener permissions.`;
  }
  const code = error?.code ?? (/^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'unexpected error');
  return `Room server could not start (${code}). Check its configuration and data directory.`;
}
function attachShutdown(runtime, server) {
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) runtime.on(signal, async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => {
      runtime.stderr.write('Room server shutdown exceeded 3 seconds; forcing exit.\n');
      runtime.exit(1);
    }, 3000);
    try {
      await server.close();
    } catch {
      runtime.stderr.write('Room server could not finish shutdown cleanly.\n');
      runtime.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  });
}

// Injecting runtime and the factory keeps startup failures testable without opening sockets or writing live data.
export async function runCli({
  runtime = process,
  createServer = createRoomServer
} = {}) {
  const rawPort = runtime.env.PORT ?? '3000',
    port = Number(rawPort),
    host = runtime.env.HOST ?? '0.0.0.0';
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 0 || port > 65535) {
    runtime.stderr.write('Invalid PORT: choose an integer from 0 to 65535.\n');
    runtime.exitCode = 1;
    return null;
  }
  let server;
  try {
    server = createServer();
    const address = await server.listen(port, host);
    runtime.stdout.write(`Room server listening on http://localhost:${address.port} (LAN: use this computer's IP)\n`);
  } catch (error) {
    if (server) {
      try {
        await server.close();
      } catch {/* Preserve the original startup error. */}
    }
    runtime.stderr.write(startupMessage(error, host, port) + '\n');
    runtime.exitCode = 1;
    return null;
  }
  runtime.exitCode = 0;
  attachShutdown(runtime, server);
  return server;
}
