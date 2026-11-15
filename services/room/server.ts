import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { resolve, relative, extname, sep } from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Authority, xorshift32 } from '../../packages/sim/index.ts';
import { hash, validate, validateSchema } from '../../packages/contracts/index.ts';
import { object } from '../../packages/contracts/shapes.ts';
import { runPlaytest, fullPlaytest, reanalyzePlaytest, PipelineError } from './playtests.ts';
import { DesignStore, DesignError } from './design.ts';
import { createSinks } from '../sinks/index.ts';
import type { MatchResult } from '../../packages/contracts/types.ts';
import type { Envelope, HttpRequest, HttpResponse, HttpServer, Room, RoomServerOptions, Session, WsServer }
  from './types.ts';
import { replayViews } from './replay-views.ts';
import { games, cardAction } from '../runner/match.ts';
import * as tentacleBot from '../../packages/games/tentacle/bot.ts';
import { chooseActionsGentle, deriveBotSeed, gentleBotPolicyVersion } from '../../packages/games/action/bot.ts';
import { Storage } from './storage.ts';
import { createScheduler } from './scheduler.ts';
import { autoPlaytest } from './auto.ts';
import { parseEnvelope, validatePayload, assertDepth, errorCode } from './protocol.ts';
import { messages } from './errors.ts';
const directory = fileURLToPath(new URL('./', import.meta.url));
const defaultStatic = fileURLToPath(new URL('../../apps/web/dist', import.meta.url));
const STEP_MS = 1000 / 60;
const LATE_INPUT_GRACE_TICKS = 30;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};
const httpStatus = code => code === 'RATE_LIMITED' ? 429 : code === 'AUTH_EXPIRED' ?
  403 : code === 'TRANSPORT_UNAVAILABLE' ? 503 : 400;
function json(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(value));
}
async function readBody(request) {
  if (Number(request.headers['content-length'] ?? 0) > 65536) throw Error('INVALID_SCHEMA');
  const parts = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 65536) throw Error('INVALID_SCHEMA');
    parts.push(chunk);
  }
  let result;
  try {
    result = JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw Error('INVALID_SCHEMA');
  }
  assertDepth(result);
  return result;
}
export class RoomServer {
  declare now: () => number;
  declare pendingRecords: Map<string, any>;
  declare failures: string[];
  declare storage: Storage;
  declare sinks: any;
  // Real-time inputs that arrived when the seat already had one for the coming tick, per room and seat.
  deferred = new WeakMap<Room, Map<string, any[]>>();
  declare staticDir: string;
  declare turnTimeoutMs: number;
  declare workers: number;
  declare analysisEnv: Record<string, string>;
  declare design: DesignStore;
  declare runAuto: ((...args: any[]) => any) | undefined;
  declare rooms: Map<string, Room>;
  declare codes: Map<string, Room>;
  declare sessions: Set<Session>;
  declare tasks: Set<Promise<unknown>>;
  declare runningBatch: boolean;
  declare closed: boolean;
  declare http: HttpServer;
  declare ws: WsServer;
  declare scheduler: ReturnType<typeof createScheduler>;
  declare seedCounter: number | undefined;
  constructor({
    storageDir = directory,
    staticDir = defaultStatic,
    turnTimeoutMs = 15000,
    workers = 2,
    analysisEnv = process.env,
    designDir,
    sinks = createSinks(process.env),
    runAuto,
    clock = () => performance.now()
  }: RoomServerOptions = {}) {
    if (!Number.isInteger(turnTimeoutMs) || turnTimeoutMs < 1) throw Error('INVALID_SCHEMA');
    if (typeof clock !== 'function') throw Error('INVALID_SCHEMA');
    this.now = clock;
    this.pendingRecords = new Map();
    this.failures = [];
    this.storage = new Storage(storageDir);
    this.sinks = sinks; // outside stores (MongoDB, Tiger Data): off without their env vars, never throw
    this.storage.sinks = sinks;
    this.staticDir = resolve(staticDir);
    this.turnTimeoutMs = turnTimeoutMs;
    this.workers = workers;
    this.analysisEnv = analysisEnv;
    this.design = new DesignStore(designDir, join(this.storage.directory, 'data', 'design'));
    if (runAuto !== undefined && typeof runAuto !== 'function') throw Error('INVALID_SCHEMA');
    this.runAuto = runAuto;
    this.rooms = new Map();
    this.codes = new Map();
    this.sessions = new Set();
    this.tasks = new Set();
    this.runningBatch = false;
    this.closed = false;
    this.http = createServer((req, res) => this.handleHttp(req, res).catch(error => {
      const typed = error instanceof PipelineError || error instanceof DesignError;
      const code = typed ? error.code : errorCode(error);
      try {
        if (!res.headersSent) json(res, httpStatus(code), {
          code,
          message: typed ? error.message : messages[code]
        });else res.destroy();
      } catch {
        try {
          res.destroy();
        } catch {}
      }
    }));
    this.http.on('clientError', (_error, socket) => {
      try {
        socket.destroy();
      } catch {}
    });
    this.ws = new WebSocketServer({
      noServer: true,
      maxPayload: 65536,
      perMessageDeflate: false
    });
    this.http.on('upgrade', (request, socket, head) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname !== '/ws') {
          socket.destroy();
          return;
        }
        this.ws.handleUpgrade(request, socket, head, ws => this.connect(ws, url));
      } catch {
        try {
          socket.destroy();
        } catch {}
      }
    });
    this.ws.on('error', error => {
      this.failures.push(errorCode(error));
      if (this.failures.length > 100) this.failures.shift();
    });
    this.scheduler = createScheduler(() => {
      try {
        this.pump();
      } catch (error) {
        this.failures.push(errorCode(error));
        if (this.failures.length > 100) this.failures.shift();
        for (const s of this.sessions) this.send(s, 'error', {
          code: 'TRANSPORT_UNAVAILABLE',
          message: messages.TRANSPORT_UNAVAILABLE,
          requestId: '',
          retryable: true
        });
      }
    });
  }
  createRoom(gameId = 'hero_arena'): Room {
    if (!Object.hasOwn(games, gameId)) throw Error('INVALID_SCHEMA');
    if (this.rooms.size >= 100) throw Error('RATE_LIMITED');
    let code: string;
    do {
      code = Array.from(randomBytes(4), x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
    } while (this.codes.has(code));
    const room: Room = {
      id: randomUUID(),
      code,
      gameId,
      phase: 'lobby',
      epoch: 1,
      host: null,
      hostToken: randomUUID(),
      seats: [],
      members: new Set(),
      authority: null,
      game: null,
      matchId: null,
      result: null,
      accumulator: 0,
      lastTime: 0,
      deadline: 0
    };
    this.rooms.set(room.id, room);
    this.codes.set(code, room);
    return room;
  }
  connect(ws: WebSocket, url: URL): void {
    const session: Session = {
      id: randomUUID(),
      ws,
      room: null,
      seat: null,
      count: 0,
      window: this.now(),
      seq: 0
    };
    if (this.closed || this.sessions.size >= 500) {
      try {
        ws.close(1013, 'Server busy');
      } catch {}
      return;
    }
    this.sessions.add(session);
    ws.on('error', () => {});
    ws.on('message', (raw, isBinary) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      let env;
      try {
        if (isBinary) throw Error('INVALID_SCHEMA');
        env = parseEnvelope(raw.toString('utf8'));
        if (env.sessionId && env.sessionId !== session.id) throw Error('AUTH_EXPIRED');
        if (session.room && !['room.join', 'room.create', 'reconnect'].includes(env.type)) {
          if (env.roomId !== session.room.id) throw Error('AUTH_EXPIRED');
          if (env.epoch !== session.room.epoch) throw Error('STALE_TURN');
        }
        this.receive(session, env);
      } catch (error) {
        this.send(session, 'error', {
          code: errorCode(error),
          message: messages[errorCode(error)],
          requestId: env?.requestId ?? '',
          retryable: ['LATE_INPUT', 'RATE_LIMITED', 'STALE_TURN'].includes(errorCode(error))
        }, env);
      }
    });
    ws.on('close', () => this.disconnect(session));
    try {
      const roomId = url.searchParams.get('roomId'),
        joinCode = url.searchParams.get('joinCode');
      if (roomId || joinCode) {
        const room = roomId ? this.rooms.get(roomId) : this.codes.get(joinCode.toUpperCase());
        if (!room) throw Error('AUTH_EXPIRED');
        const token = url.searchParams.get('hostToken');
        if (token && token !== room.hostToken) throw Error('AUTH_EXPIRED');
        if (token) {
          if (room.host) throw Error('ILLEGAL_ACTION');
          room.host = session;
        }
        this.attach(session, room);
        this.status(room);
        if (room.authority) this.view(session);
      } else if (url.searchParams.get('role') === 'display') {
        const room = this.createRoom(url.searchParams.get('gameId') ?? 'hero_arena');
        room.host = session;
        this.attach(session, room);
        this.status(room);
      } else this.send(session, 'room.status', {
        joinCode: '',
        gameId: null,
        playableHeroes: [],
        phase: 'lobby',
        seats: []
      });
    } catch (error) {
      this.send(session, 'error', {
        code: errorCode(error),
        message: messages[errorCode(error)],
        requestId: '',
        retryable: false
      });
    }
  }
  attach(session: Session, room: Room): void {
    session.room = room;
    room.members.add(session);
  }
  send(session: Session, type: string, payload: unknown, request?: { requestId?: string } | null, seq?: number): void {
    if (session.ws.readyState !== WebSocket.OPEN) return;
    try {
      if (session.ws.bufferedAmount > 1048576) {
        session.ws.close(1013, 'Slow consumer');
        return;
      }
      session.ws.send(JSON.stringify({
        protocolVersion: '0.1',
        type,
        roomId: session.room?.id ?? '',
        sessionId: session.id,
        requestId: request?.requestId ?? '',
        seq: seq ?? session.seq++,
        epoch: session.room?.epoch ?? 1,
        payload
      }), error => {
        if (error) {
          try {
            session.ws.terminate();
          } catch {}
        }
      });
    } catch {
      try {
        session.ws.terminate();
      } catch {}
    }
  }
  playableHeroes(room: Pick<Room, 'gameId' | 'selectedHash'>): string[] {
    const {
      data
    } = this.storage.get(room.gameId, room.selectedHash);
    if (room.gameId === 'tentacle_run') return ['sepia']; // solo game: the seat always plays Sepia
    if (room.gameId === 'hero_arena') return data.characters.map(character => character.id);
    const decks = data.gameRules.decks.map(deck => deck.id);
    return decks.includes('standard') ? games.hero_arena.data.characters.map(character => character.id) : decks;
  }
  status(room: Room, request?: Envelope | null): void {
    for (const s of room.members) this.send(s, 'room.status', {
      joinCode: room.code,
      phase: room.phase,
      gameId: room.gameId,
      playableHeroes: this.playableHeroes(room),
      seats: room.seats.map(({
        seat,
        name,
        hero,
        session,
        bot
      }) => ({
        seat,
        name,
        hero,
        connected: !!session || !!bot,
        ...(bot ? {
          bot: true
        } : {})
      })),
      ...(s.seat ? {
        you: s.seat,
        seatToken: room.seats.find(seat => seat.seat === s.seat)?.token
      } : {})
    }, request);
  }
  host(session: Session): Room {
    if (!session.room || session.room.host !== session) throw Error('AUTH_EXPIRED');
    return session.room;
  }
  receive(session: Session, env: Envelope): any {
    if (env.type === 'input.submit') return this.input(session, env);
    validatePayload(env.type, env.payload);
    if (env.type === 'ping') {
      this.send(session, 'pong', {}, env);
      return;
    }
    if (env.type === 'room.create') {
      if (session.room) throw Error('ILLEGAL_ACTION');
      const room = this.createRoom(env.payload.gameId);
      room.host = session;
      this.attach(session, room);
      this.status(room, env);
      return;
    }
    if (env.type === 'room.hero') {
      const room = session.room,
        seat = room?.seats.find(s => s.seat === session.seat);
      if (!room || !seat) throw Error('AUTH_EXPIRED');
      if (room.phase !== 'lobby') throw Error('ILLEGAL_ACTION');
      if (room.gameId !== 'tentacle_run' && !this.playableHeroes(room).includes(env.payload.hero)) {
        throw Error('INVALID_SCHEMA');
      }
      seat.hero = room.gameId === 'tentacle_run' ? 'sepia' : env.payload.hero;
      this.status(room, env);
      return;
    }
    if (env.type === 'reconnect') return this.resume(session, env);
    if (env.type === 'room.join') {
      if (env.payload.seatToken) return this.resume(session, env);
      const room = this.codes.get(env.payload.joinCode.toUpperCase());
      if (!room) throw Error('AUTH_EXPIRED');
      if (!env.payload.name.trim()) throw Error('INVALID_SCHEMA');
      this.expireSeats(room, this.now());
      if (session.room && session.room !== room) throw Error('ILLEGAL_ACTION');
      if (room.phase !== 'lobby') throw Error('ILLEGAL_ACTION');
      // Tentacle Run is solo with Sepia: any hero a phone picked still joins, and plays Sepia
      if (room.gameId !== 'tentacle_run' && !this.playableHeroes(room).includes(env.payload.hero)) {
        throw Error('INVALID_SCHEMA');
      }
      if (room.gameId === 'tentacle_run') env.payload.hero = 'sepia';
      if (session.seat) {
        const seat = room.seats.find(s => s.seat === session.seat);
        seat.name = env.payload.name.trim();
        seat.hero = env.payload.hero;
      } else {
        if (room.seats.length >= games[room.gameId].describe().maxPlayers) throw Error('ROOM_FULL');
        const seat = ['p1', 'p2', 'p3', 'p4'].find(id => !room.seats.some(s => s.seat === id));
        room.seats.push({
          seat,
          name: env.payload.name.trim(),
          hero: env.payload.hero,
          session,
          token: randomBytes(32).toString('base64url'),
          expiresAt: 0
        });
        session.seat = seat;
      }
      this.attach(session, room);
      this.status(room, env);
      return;
    }
    const room = this.host(session);
    if (env.type === 'game.select') {
      if (room.phase !== 'lobby') throw Error('ILLEGAL_ACTION');
      this.storage.get(env.payload.gameId, env.payload.dataHash);
      room.gameId = env.payload.gameId;
      room.selectedHash = env.payload.dataHash;
      this.status(room, env);
      return;
    }
    if (env.type === 'match.start') return this.start(room, env.payload, env);
    if (env.type === 'match.reset') {
      if (room.phase === 'playing') this.finish(room, 'ILLEGAL_ACTION');
      room.phase = 'lobby';
      room.authority = null;
      room.game = null;
      room.result = null;
      room.matchId = null;
      room.epoch++;
      room.seats = room.seats.filter(s => s.session);
      room.accumulator = 0;
      this.status(room, env);
    }
  }
  /**
   * A new seed for every match that does not name one: a counter mixed with the clock, so two matches never start the
   * same way (the bot's draws follow the seed). The seed is recorded in the config, so replays stay exact.
   */
  freshSeed(): number {
    this.seedCounter = (this.seedCounter ?? 0) + 1;
    const clock = xorshift32(Date.now() % 4294967291 + 1);
    return xorshift32(((clock ^ Math.imul(this.seedCounter, 0x9e3779b1)) >>> 0) || 1);
  }
  start(room: Room, options: any, request?: Envelope): void {
    if (room.phase !== 'lobby') throw Error('ILLEGAL_ACTION');
    const gameId = options.gameId ?? room.gameId,
      game = games[gameId];
    const {
      data
    } = this.storage.get(gameId, gameId === room.gameId ? room.selectedHash : undefined);
    let seats = room.seats.filter(seat => seat.session);
    if (options.bot && seats.length === 1 && gameId === 'tentacle_run' && options.versus === true) {
      // runner versus a bot: the phone is p1 and the server plays p2 (Sepia, the gentle runner bot)
      for (const session of this.sessions) if (session.seat === seats[0].seat) session.seat = 'p1';
      seats[0].seat = 'p1';
      seats = [...seats, { seat: 'p2', name: 'Scripted bot', hero: 'sepia', session: null, bot: true, token: null,
        expiresAt: 0 }];
    } else if (options.bot && seats.length === 1) {
      const available = this.playableHeroes({
        gameId,
        selectedHash: gameId === room.gameId ? room.selectedHash : undefined
      });
      seats = [...seats, {
        seat: ['p1', 'p2'].find(id => id !== seats[0].seat),
        name: 'Scripted bot',
        hero: available.find(id => id !== seats[0].hero) ?? available[0],
        session: null,
        bot: true,
        token: null,
        expiresAt: 0
      }];
    }
    const solo = gameId === 'tentacle_run';
    const versus = solo && options.versus === true; // two phones race one course, both Sepia, seats stay p1/p2
    if (seats.length !== (solo && !versus ? 1 : 2)) throw Error('ILLEGAL_ACTION');
    if (versus) for (const s of seats) s.hero = 'sepia';
    else if (solo) { // the game's one seat is always p1
      for (const session of this.sessions) if (session.seat === seats[0].seat) session.seat = 'p1';
      seats[0].seat = 'p1';
      seats[0].hero = 'sepia';
    }
    const players = seats.map(s => s.seat).sort();
    const config = game.makeConfig(data, options.seed ?? this.freshSeed(), players);
    config.options = {
      assignments: Object.fromEntries(seats.map(s => [s.seat, gameId === 'hero_arena' || solo ?
        s.hero : data.gameRules.decks.some(d => d.id === s.hero) ? s.hero : 'standard']))
    };
    if (options.maxTicks !== undefined) config.maxTicks = options.maxTicks;
    const authority = new Authority(game.adapter, config, data);
    room.seats = seats;
    authority.holdMoves = new Set(room.seats.filter(s => !s.bot).map(s => s.seat));
    room.authority = authority;
    room.game = game;
    if (gameId !== room.gameId) room.selectedHash = undefined;
    room.gameId = gameId;
    room.phase = 'playing';
    room.result = null;
    room.matchId = `human-${randomUUID()}`;
    room.epoch++;
    room.lastTime = this.now();
    room.accumulator = 0;
    room.deadline = room.lastTime + this.turnTimeoutMs;
    this.status(room, request);
    for (const s of room.members) this.send(s, 'match.started', {
      config
    }, request);
    this.views(room);
  }
  input(session: Session, env: Envelope): void {
    const room = session.room;
    if (!room?.authority || !session.seat || room.seats.find(s =>
      s.seat === session.seat)?.session !== session) throw Error('ILLEGAL_ACTION');
    validate('ActionInput', env.payload);
    if (env.payload.playerId !== session.seat) throw Error('ILLEGAL_ACTION');
    const now = this.now();
    if (now - session.window >= 1000) {
      session.window = now;
      session.count = 0;
    }
    if (++session.count > 120) throw Error('RATE_LIMITED');
    const authority = room.authority,
      key = JSON.stringify([session.seat, env.payload.seq]);
    if (room.phase !== 'playing' && !authority.receipts.has(key)) throw Error('ILLEGAL_ACTION');
    // Real-time games: a phone's input aims at the tick after the last view it saw, so it lands a few ticks late over
    // a real network. Up to half a second late, it is applied on the next tick instead of being dropped.
    const next = authority.state.tick + 1, late = next - env.payload.tick;
    const input = authority.config.mode !== 'turn' && late > 0 && late <= LATE_INPUT_GRACE_TICKS ?
      { ...env.payload, tick: next } : env.payload;
    const previous = authority.receipts.has(key);
    // Real-time: a press and its release can reach the server inside one tick; the second would be RATE_LIMITED and
    // lost (a jump that stays held). It waits for the next tick instead.
    const waiting = this.deferredOf(room), deferred = waiting.get(session.seat) ?? [];
    if (authority.config.mode !== 'turn' && !previous && (deferred.length || this.queuedThisTick(authority, input))) {
      waiting.set(session.seat, [...deferred, input]);
      return;
    }
    const receipt = authority.submit(input);
    this.send(session, 'input.ack', receipt, env, env.payload.seq);
    if (authority.config.mode === 'turn' && !previous) this.advance(room);
  }
  queuedThisTick(authority: any, input: any): boolean {
    const queued = authority.pending.get(input.playerId) ?? [];
    const category = (a: any) => authority.holdsMoves() && a.actionId === 'move' ? 'move' : 'attack';
    return queued.some((a: any) => category(a) === category(input));
  }
  deferredOf(room: Room): Map<string, any[]> {
    let waiting = this.deferred.get(room);
    if (!waiting) this.deferred.set(room, waiting = new Map());
    return waiting;
  }
  drainDeferred(room: Room): void {
    const authority = room.authority, waiting = this.deferredOf(room);
    for (const [seat, list] of [...waiting]) {
      if (!room.seats.some(s => s.seat === seat) || !list.length) continue;
      const [first, ...rest] = list;
      try {
        authority.submit({ ...first, tick: authority.state.tick + 1 });
      } catch {
        // a stale or illegal input is dropped, as it would have been on arrival
      }
      if (rest.length) waiting.set(seat, rest);
      else waiting.delete(seat);
    }
  }
  view(session: Session, events: any[] = []): void {
    const room = session.room,
      authority = room.authority,
      viewerId = session.seat ?? 'display';
    if (!authority) return;
    const observation = room.game.observe(authority.state, viewerId);
    this.send(session, 'state.view', {
      observation,
      tick: observation.tick,
      turnId: authority.state.turnId,
      epoch: room.epoch,
      viewHash: hash(observation),
      events: events.filter(event => event.audience.length === 0 || event.audience.includes(viewerId))
    });
    this.send(session, 'actions.available', {
      playerId: viewerId,
      tick: observation.tick,
      turnId: authority.state.turnId,
      actions: room.game.legalActions(observation)
    });
  }
  views(room: Room, events: any[] = []): void {
    for (const session of room.members) this.view(session, events);
  }
  submitBots(room: Room, systemInputs: any[]): void {
    if (systemInputs.length) return;
    const authority = room.authority,
      state = authority.state;
    for (const seat of room.seats) {
      if (!seat.bot) continue;
      if (authority.config.gameId === 'tentacle_run') { // the runner's gentle bot: inputs only, like the arena's
        const view = room.game.observe(state, seat.seat);
        const seed = deriveBotSeed(authority.config.seed, authority.config.players.indexOf(seat.seat));
        for (const input of tentacleBot.chooseActionsGentle(view, state.tick * 2, seed)) authority.submit(input);
        continue;
      }
      const inputs = authority.config.mode === 'turn' ? state.payload.activePlayer === seat.seat ? [cardAction(
        room.game, state, state.tick)] : [] : chooseActionsGentle(room.game.observe(state, seat.seat), state.tick * 2,
        deriveBotSeed(authority.config.seed, authority.config.players.indexOf(seat.seat)));
      for (const input of inputs) authority.submit(input);
    }
  }
  advance(room: Room, systemInputs: any[] = []): void {
    if (room.phase !== 'playing') return;
    try {
      const turn = room.authority.state.turnId;
      this.submitBots(room, systemInputs);
      const result = room.authority.advance(systemInputs);
      this.drainDeferred(room);
      if (room.authority.state.turnId !== turn) room.deadline = this.now() + this.turnTimeoutMs;
      this.views(room, result.events);
      if (room.game.outcome(room.authority.state).status !== 'running') this.finish(room);
    } catch (error) {
      this.finish(room, errorCode(error));
    }
  }
  finish(room: Room, failure?: string): void {
    if (room.phase !== 'playing') return;
    const a = room.authority;
    const statistics = structuredClone(room.game.statistics(a.state));
    // A terminal step may succeed before view delivery fails; invalid matches earn no result credit.
    if (failure) {
      for (const player of statistics.players) {
        player.wins = 0;
        player.draws = 0;
      }
    }
    const result = {
      matchId: room.matchId,
      config: a.config,
      outcome: failure ? {
        status: 'running',
        winners: [],
        reason: 'invalid_match'
      } : room.game.outcome(a.state),
      statistics,
      finalStateHash: room.game.hash(a.state),
      valid: !failure,
      errorCode: failure ?? '',
      ...(room.seats.some(seat => seat.bot) ? {
        botSeats: room.seats.filter(seat => seat.bot).map(seat => seat.seat),
        // Hero Arena's room bot is the gentle policy; Hero Cards plays its first legal card (no policy version)
        ...(room.game.describe().mode === 'turn' ? {} : { botPolicyVersion: room.gameId === 'tentacle_run' ?
          tentacleBot.gentleBotPolicyVersion : gentleBotPolicyVersion })
      } : {})
    } as MatchResult;
    const recording = {
      matchId: room.matchId,
      seed: a.config.seed,
      config: a.config,
      frames: a.frames,
      finalStateHash: result.finalStateHash,
      ...(result.botSeats ? {
        botSeats: result.botSeats
      } : {})
    };
    room.result = result;
    room.phase = 'ended';
    this.pendingRecords.set(result.matchId, {
      room,
      result,
      recording,
      retryAt: 0
    });
    this.flushRecord(result.matchId);
  }
  flushRecord(matchId: string): void {
    const entry = this.pendingRecords.get(matchId);
    if (!entry) return;
    try {
      this.storage.record(entry.result, entry.recording);
      this.pendingRecords.delete(matchId);
      if (entry.room.matchId === matchId) {
        for (const s of entry.room.members) this.send(s, 'match.ended', {
          result: entry.result
        });
        this.status(entry.room);
      }
    } catch {
      entry.retryAt = this.now() + 1000;
      for (const s of entry.room.members) this.send(s, 'error', {
        code: 'TRANSPORT_UNAVAILABLE',
        message: 'Match finished; saving results is delayed and will be retried.',
        requestId: '',
        retryable: true
      });
    }
  }
  expireSeats(room: Room, now: number): void {
    for (const seat of room.seats) if (!seat.session && seat.expiresAt && now >= seat.expiresAt) {
      seat.token = null;
      seat.expiresAt = 0;
    }
    if (room.phase === 'lobby') room.seats = room.seats.filter(s => s.session || s.expiresAt > now);
  }
  resume(session: Session, env: Envelope): void {
    const room = this.codes.get(env.payload.joinCode.toUpperCase()),
      now = this.now();
    if (!room || session.room && session.room !== room || session.seat) throw Error('AUTH_EXPIRED');
    this.expireSeats(room, now);
    const seat = room.seats.find(s => s.token === env.payload.seatToken);
    if (!seat || seat.session || !seat.expiresAt || now >= seat.expiresAt) throw Error('AUTH_EXPIRED');
    seat.session = session;
    seat.expiresAt = 0;
    seat.token = randomBytes(32).toString('base64url');
    session.seat = seat.seat;
    this.attach(session, room);
    this.status(room, env);
    if (room.authority) {
      this.send(session, 'match.started', {
        config: room.authority.config
      }, env);
      this.view(session);
      const receipt = room.authority.receipts.get(JSON.stringify([seat.seat, env.payload.lastAck]));
      if (receipt) this.send(session, 'input.ack', receipt, env, receipt.seq);
      if (room.result && !this.pendingRecords.has(room.result.matchId)) this.send(session, 'match.ended', {
        result: room.result
      }, env);
    }
  }
  pump(): void {
    if (this.closed) return;
    const now = this.now();
    for (const [matchId, entry] of this.pendingRecords) if (now >= entry.retryAt) this.flushRecord(matchId);
    for (const room of this.rooms.values()) {
      this.expireSeats(room, now);
      if (room.phase !== 'playing') continue;
      if (room.authority.config.mode === 'turn') {
        if (room.seats.some(seat => seat.bot && seat.seat === room.authority.state.payload.activePlayer)) {
          this.advance(room);
          continue;
        }
        if (now >= room.deadline) this.advance(room, [{
          kind: 'system.timeout',
          playerId: room.authority.state.payload.activePlayer,
          turnId: room.authority.state.turnId
        }]);
      } else {
        room.accumulator += now - room.lastTime;
        room.lastTime = now;
        let steps = 0;
        while (room.accumulator >= STEP_MS && room.phase === 'playing' && steps++ < 120) {
          room.accumulator -= STEP_MS;
          this.advance(room);
        }
      }
    }
  }
  disconnect(session: Session): void {
    this.sessions.delete(session);
    const room = session.room;
    if (!room) return;
    room.members.delete(session);
    const seat = room.seats.find(s => s.session === session);
    if (seat) {
      room.authority?.release(seat.seat); // a held stick must not keep a disconnected phone's hero walking
      seat.session = null;
      seat.expiresAt = !this.closed && room.phase === 'playing' ? this.now() + 10000 : 0;
      if (!seat.expiresAt) seat.token = null;
    }
    session.room = null;
    session.seat = null;
    this.expireSeats(room, this.now());
    if (room.host === session) room.host = null;
    this.status(room);
  }
  // The version history plus the server-wide current version ("Make current" needs it).
  versionList(gameId: string) {
    return { versions: this.storage.versionStore.list(gameId), currentHash: this.storage.get(gameId).dataHash };
  }
  async handleHttp(request: HttpRequest, response: HttpResponse): Promise<void> {
    let url;
    try {
      url = new URL(request.url, 'http://localhost');
    } catch {
      throw Error('INVALID_SCHEMA');
    }
    const path = url.pathname;
    if (request.method === 'GET' && path === '/v1/games') {
      json(response, 200, Object.values(games).map(g => g.describe()));
      return;
    }
    if (request.method === 'POST' && path === '/v1/rooms') {
      const body = await readBody(request);
      validatePayload('room.create', body);
      const room = this.createRoom(body.gameId);
      json(response, 201, {
        roomId: room.id,
        joinCode: room.code,
        hostToken: room.hostToken,
        epoch: room.epoch
      });
      return;
    }
    const viewsRoute = path.match(/^\/v1\/replay\/([A-Za-z0-9_-]{1,128})\/views$/);
    if (request.method === 'GET' && viewsRoute) {
      const everyText = url.searchParams.get('every');
      if (everyText !== null && !/^[0-9]+$/.test(everyText)) throw Error('INVALID_SCHEMA');
      const result = replayViews(this.storage, viewsRoute[1], {
        dataHash: url.searchParams.get('dataHash') ?? undefined,
        every: everyText === null ? 6 : Number(everyText)
      });
      json(response, result ? 200 : 404, result ?? {
        code: 'INVALID_SCHEMA'
      });
      return;
    }
    const replayRoute = path.match(/^\/v1\/replay\/([A-Za-z0-9_-]{1,128})$/);
    if (request.method === 'GET' && replayRoute) {
      const recording = this.storage.getReplay(replayRoute[1]);
      json(response, recording ? 200 : 404, recording ?? {
        code: 'INVALID_SCHEMA'
      });
      return;
    }
    const versionsRoute = path.match(
      /^\/v1\/versions\/(hero_arena|hero_cards|tentacle_run)(?:\/([0-9a-f]{64})(\/approve)?)?$/);
    if (versionsRoute) {
      const [, gameId, dataHash, approve] = versionsRoute;
      const versions = this.storage.versionStore;
      if (request.method === 'GET' && !approve) {
        const record = dataHash ? versions.get(gameId, dataHash) : null;
        if (!dataHash) json(response, 200, this.versionList(gameId));
        else json(response, record ? 200 : 404, record ? { ...record, diff: record.changes } : {
          code: 'HASH_MISMATCH'
        });
        return;
      }
      if (request.method === 'POST' && approve) {
        validateSchema(object({}), await readBody(request));
        const record = versions.approve(gameId, dataHash);
        json(response, record ? 200 : 404, record ?? { code: 'HASH_MISMATCH' });
        return;
      }
    }
    if (request.method === 'GET' && path === '/v1/sinks') {
      // Names and counts only: never a connection string or an error text that could carry one.
      const status = Object.fromEntries(Object.entries(this.sinks.status).map(([name, item]) => [name,
        { written: (item as any).written, failed: (item as any).failed }]));
      json(response, 200, { enabled: this.sinks.enabled, status });
      return;
    }
    const humansRoute = path.match(/^\/v1\/humans\/(hero_arena|hero_cards|tentacle_run)$/);
    if (request.method === 'GET' && humansRoute) { // the human rows of one game, for the live dashboard
      const gameId = humansRoute[1];
      const { addHumanRows } = await import('../../packages/analysis/src/human.ts');
      const results = this.storage.humans.filter(result => (result?.config?.gameId ?? gameId) === gameId);
      const report: any = addHumanRows({ rows: [] }, structuredClone(results));
      json(response, 200, { gameId, humanMatches: report.humanMatches ?? 0, rows: report.rows });
      return;
    }
    const trendRoute = path.match(/^\/v1\/trend\/(hero_arena|hero_cards|tentacle_run)$/);
    if (request.method === 'GET' && trendRoute) {
      const matchup = url.searchParams.get('matchup') ?? '';
      if (!/^[a-z_]{1,32} vs [a-z_]{1,32}$/.test(matchup)) throw Error('INVALID_SCHEMA');
      const trend = await this.sinks.trend(matchup).catch(() => null);
      json(response, trend ? 200 : 404, trend ? { gameId: trendRoute[1], matchup, points: trend } :
        { code: 'TRANSPORT_UNAVAILABLE', message: 'The trend needs Tiger Data (TIGER_DATABASE_URL).' });
      return;
    }
    const designRoute = path.match(/^\/v1\/design\/(hero_arena|hero_cards|tentacle_run)\/intent$/);
    if (designRoute && ['GET', 'PUT'].includes(request.method)) {
      const gameId = designRoute[1];
      const intent = request.method === 'GET' ? await this.design.get(gameId) :
        await this.design.put(gameId, await readBody(request));
      json(response, 200, { gameId, ...intent });
      return;
    }
    if (request.method === 'POST' && path === '/v1/playtest/reanalyze') {
      // Analysis only (no simulation, no batch lock): fast enough to answer a button press on the result screen.
      json(response, 200, await reanalyzePlaytest(this, await readBody(request)));
      return;
    }
    const selectRoute = path.match(/^\/v1\/data\/(hero_arena|hero_cards|tentacle_run)\/select$/);
    if (request.method === 'POST' && selectRoute) {
      const body = await readBody(request);
      validateSchema(object({ dataHash: { type: 'string', pattern: '^[0-9a-f]{64}$' } }), body);
      this.storage.select(selectRoute[1], body.dataHash);
      json(response, 200, this.versionList(selectRoute[1]));
      return;
    }
    const dataRoute = path.match(/^\/v1\/data\/(hero_arena|hero_cards|tentacle_run)(\/apply-patch)?$/);
    if (dataRoute) {
      if (request.method === 'GET' && !dataRoute[2]) {
        json(response, 200, this.storage.get(dataRoute[1], url.searchParams.get('dataHash') ?? undefined));
        return;
      }
      if (request.method === 'POST' && dataRoute[2]) {
        const body = await readBody(request);
        validateSchema(object({
          proposal: {
            $ref: '#/$defs/PatchProposal'
          }
        }), body);
        json(response, 200, this.storage.patch(dataRoute[1], body.proposal));
        return;
      }
    }
    if (request.method === 'POST' && ['/v1/playtest/run', '/v1/playtest/full', '/v1/playtest/auto'].includes(path)) {
      const body = await readBody(request);
      if (this.runningBatch) throw Error('RATE_LIMITED');
      this.runningBatch = true;
      const execute = path.endsWith('/auto') ? autoPlaytest : path.endsWith('/full') ? fullPlaytest : runPlaytest;
      const task = execute(this, body);
      this.tasks.add(task);
      try {
        json(response, 200, await task);
      } finally {
        this.tasks.delete(task);
        this.runningBatch = false;
      }
      return;
    }
    const resultRoute = path.match(
      /^\/v1\/playtest\/results\/([0-9a-f-]{36}(?:-(?:baseline|holdout|diagnose|auto))?)\.json$/);
    if (request.method === 'GET' && resultRoute) {
      try {
        const data = await readFile(join(this.storage.directory, 'playtests', `${resultRoute[1]}.json`));
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8'
        });
        response.end(data);
      } catch (error) {
        if (error.code === 'ENOENT') json(response, 404, {
          code: 'INVALID_SCHEMA'
        });else throw error;
      }
      return;
    }
    if (path.startsWith('/v1/')) {
      json(response, 404, {
        code: 'INVALID_SCHEMA'
      });
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      json(response, 405, {
        code: 'INVALID_SCHEMA'
      });
      return;
    }
    await this.serveStatic(url, response, request.method === 'HEAD');
  }
  async serveStatic(url: URL, response: HttpResponse, head: boolean): Promise<void> {
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      throw Error('INVALID_SCHEMA');
    }
    if (pathname.includes('\0') || pathname.includes('\\')) throw Error('INVALID_SCHEMA');
    let root;
    try {
      root = await realpath(this.staticDir);
    } catch {
      json(response, 503, {
        code: 'TRANSPORT_UNAVAILABLE'
      });
      return;
    }
    let target = resolve(root, `.${pathname}`);
    const inside = path => {
      const rel = relative(root, path);
      return rel === '' || !rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep);
    };
    if (!inside(target)) throw Error('AUTH_EXPIRED');
    try {
      try {
        if ((await stat(target)).isDirectory()) target = join(target, 'index.html');
      } catch (error) {
        if (error.code === 'ENOENT' && !extname(pathname)) target = join(root, 'index.html');else throw error;
      }
      target = await realpath(target);
      if (!inside(target)) throw Error('AUTH_EXPIRED');
      const bytes = await readFile(target);
      response.writeHead(200, {
        'content-type': types[extname(target)] ?? 'application/octet-stream'
      });
      response.end(head ? undefined : bytes);
    } catch (error) {
      if (error.code === 'ENOENT') json(response, 404, {
        code: 'INVALID_SCHEMA'
      });else throw error;
    }
  }
  listen(port = 3000, host = '0.0.0.0'): Promise<ReturnType<HttpServer['address']>> {
    return new Promise((resolve, reject) => {
      const failed = error => {
        this.http.off('listening', ready);
        reject(error);
      };
      const ready = () => {
        this.http.off('error', failed);
        resolve(this.http.address());
      };
      this.http.once('error', failed);
      this.http.once('listening', ready);
      this.http.listen(port, host);
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    this.scheduler.stop();
    for (const room of this.rooms.values()) if (room.phase === 'playing') this.finish(room, 'TRANSPORT_UNAVAILABLE');
    for (const session of [...this.sessions]) {
      try {
        session.ws.terminate();
      } catch {}
    }
    for (const matchId of [...this.pendingRecords.keys()]) this.flushRecord(matchId);
    // Drop keep-alive and in-flight HTTP connections first: http.close() waits for them, and one idle connection
    // would hold the process open until the shutdown deadline in startup.js forces an exit.
    this.http.closeAllConnections();
    await Promise.allSettled([...this.tasks]);
    await new Promise<void>(resolve => this.ws.close(() => resolve()));
    await this.sinks.close().catch(() => {});
    if (this.http.listening) await new Promise<void>((resolve, reject) => this.http.close(error => error ? reject(
      error) : resolve()));
  }
}
export const createRoomServer = options => new RoomServer(options);
