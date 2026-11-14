// Types of the room server (type-only module: Node strips it, nothing here exists at run time).
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { WebSocket, WebSocketServer } from 'ws';
import type { Authority } from '../../packages/sim/index.ts';
import type { GameAdapter, MatchResult } from '../../packages/contracts/types.ts';

export type Phase = 'lobby' | 'playing' | 'ended';
/** One WebSocket client of the room server. */
export type Session = {
  id: string; ws: WebSocket; room: Room | null; seat: string | null; count: number; window: number; seq: number;
  [key: string]: any;
};
export type Seat = {
  seat: string; name: string; hero: string; session: Session | null; bot?: boolean; token: string | null;
  expiresAt: number;
};
export type Room = {
  id: string; code: string; gameId: string; phase: Phase; epoch: number; host: Session | null; hostToken: string;
  seats: Seat[]; members: Set<Session>; authority: Authority | null; game: GameAdapter | null; matchId: string | null;
  result: MatchResult | null; accumulator: number; lastTime: number; deadline: number; selectedHash?: string;
  [key: string]: any;
};
/** The envelope every WebSocket message travels in. */
export type Envelope = {
  protocolVersion: string; type: string; roomId: string; sessionId: string; requestId: string; seq: number;
  epoch: number; payload: any;
};
export type RoomServerOptions = {
  storageDir?: string; staticDir?: string; turnTimeoutMs?: number; workers?: number;
  analysisEnv?: Record<string, string>; designDir?: string; sinks?: any; runAuto?: (...args: any[]) => any;
  clock?: () => number;
};
export type HttpRequest = IncomingMessage;
export type HttpResponse = ServerResponse;
export type HttpServer = Server;
export type WsServer = WebSocketServer;
