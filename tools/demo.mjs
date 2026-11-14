// One command for the whole demo: build the web app if needed, start the room server
// (which serves the web app, the API and /ws on one port), then print the laptop URL
// and a phone QR code. If the live server cannot start, serve the built app in
// recorded mode (?mock=1) so the demo still runs.
//
//   npm run demo                      LAN demo on port 3000
//   PORT=4000 npm run demo            another port
//   PUBLIC_URL=https://x.trycloudflare.com npm run demo
//                                     print the tunnel URL instead of the LAN one
//   npm run demo -- --recorded        skip the live server
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import QRCode from 'qrcode';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'apps/web/dist');
const port = Number(process.env.PORT ?? 3000);
const forceRecorded = process.argv.includes('--recorded');

function newestMtime(dir) {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    newest = Math.max(newest, info.isDirectory() ? newestMtime(path) : info.mtimeMs);
  }
  return newest;
}

function buildWebIfStale() {
  const src = join(root, 'apps/web/src');
  const builtAt = existsSync(join(dist, 'index.html')) ? statSync(join(dist, 'index.html')).mtimeMs : 0;
  if (builtAt > newestMtime(src)) return console.log('web: build is up to date');
  console.log('web: building apps/web ...');
  const build = spawnSync('npm', ['run', 'build', '-w', 'apps/web'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) throw Error('web build failed; fix it or run `npm run build -w apps/web` to see why');
}

function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

async function waitForHealth(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Secrets come from the environment or, on macOS, from Keychain items of the same name.
// They go to the server process only and are never printed; only the names are listed.
const SECRETS = ['GEMINI_API_KEY', 'XAI_API_KEY', 'MONGODB_URI', 'TIGER_DATABASE_URL', 'TIGER_CA_CERT'];

// `security -w` prints a value that contains newlines (a PEM certificate) as hex.
// Decode it only when the hex turns out to be printable text, so ordinary keys stay as they are.
export function fromKeychain(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2) return value;
  const text = Buffer.from(value, 'hex').toString('utf8');
  return /^[\x09\x0a\x0d\x20-\x7e]+$/.test(text) && text.includes('-----BEGIN') ? text : value;
}

function secretEnv() {
  const env = {};
  for (const name of SECRETS) {
    if (process.env[name]) {
      env[name] = process.env[name];
      continue;
    }
    if (process.platform !== 'darwin') continue;
    const found = spawnSync('security', ['find-generic-password', '-s', name, '-w'], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) env[name] = fromKeychain(found.stdout.trim());
  }
  const names = Object.keys(env);
  console.log(`secrets: ${names.length ? names.join(', ') : 'none'} (values never printed)`);
  return env;
}

function startLive() {
  const child = spawn(process.execPath, ['services/room/cli.js'], {
    cwd: root,
    env: {
      ...process.env,
      ...secretEnv(),
      GEMINI_MODEL: process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest',
      PORT: String(port),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return child;
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
};

function startRecorded() {
  // Static files only; the web app runs its in-browser mock and the stored run.
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = resolve(dist, '.' + path);
    if (!file.startsWith(dist + sep) && file !== dist) return res.writeHead(403).end();
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, fail) => server.once('error', fail).listen(port, '0.0.0.0', () => ok(server)));
}

async function printUrls(mode) {
  const base = (process.env.PUBLIC_URL ?? `http://${lanAddress()}:${port}`).replace(/\/$/, '');
  const query = mode === 'recorded' ? '?mock=1' : '';
  const laptop = `${base}/${query}#/lobby`;
  const phone = `${base}/${query}#/play`;
  console.log(`\n=== balance-forge demo · ${mode.toUpperCase()} ===`);
  console.log(`Laptop (open this, not localhost, so the lobby QR points phones here):\n  ${laptop}`);
  console.log(`Dashboard:\n  ${base}/${query}#/dashboard`);
  console.log(`Phones (same Wi-Fi${process.env.PUBLIC_URL ? ' or any network' : ''}):\n  ${phone}\n`);
  console.log(await QRCode.toString(phone, { type: 'terminal', small: true }));
  if (mode === 'recorded') console.log('Recorded mode: stored run and in-browser mock; phones play against the mock.');
  if (!process.env.PUBLIC_URL) {
    console.log(`For phones on other networks: cloudflared tunnel --url http://localhost:${port}`);
    console.log('then rerun with PUBLIC_URL=<the https URL it prints>.');
  }
  console.log('Ctrl+C stops everything.\n');
}

buildWebIfStale();

// A server left running on the port would answer the health check and the demo would show its
// old code instead of this checkout, so refuse to start rather than reuse it.
try {
  await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
  console.error(`port ${port} is already in use by another server. Stop it first, or run with PORT=<other port>.`);
  console.error(`  find it: lsof -nP -iTCP:${port} -sTCP:LISTEN`);
  process.exit(1);
} catch {}

let live = null;
if (!forceRecorded) {
  live = startLive();
  const up = await Promise.race([
    waitForHealth(`http://127.0.0.1:${port}/v1/games`, 8000),
    new Promise((r) => live.once('exit', () => r(false))),
  ]);
  if (up) {
    await printUrls('live');
    live.once('exit', (code) => {
      console.error(`room server exited (${code}); restart with npm run demo, or npm run demo -- --recorded`);
      process.exit(code ?? 1);
    });
  } else {
    console.error('live: room server did not answer in 8 s; switching to recorded mode');
    live.kill();
    await new Promise((r) => (live.exitCode !== null ? r() : live.once('exit', r)));
    live = null;
  }
}

if (!live) {
  await startRecorded();
  await printUrls('recorded');
}

// Stop the room server with us: ask politely, then force it after 3 s so no orphan keeps the port open.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    if (!live || live.exitCode !== null) process.exit(0);
    live.once('exit', () => process.exit(0));
    live.kill('SIGTERM');
    setTimeout(() => {
      live.kill('SIGKILL');
      process.exit(0);
    }, 3000);
  });
}
