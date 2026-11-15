import { useSyncExternalStore } from "react";
import type { ActionInput, Envelope, Observation, RoomStatusPayload } from "./contract";
import { InputPipeline } from "./input.ts";
import { CONTROL_ACTION, NO_CONTROL, controlParams, withButton, type RunnerControl } from "./runnerInput.ts";
import { createTransport, type ConnStatus, type Transport } from "../mock/transport";

/**
 * The player seat of PC mode: this browser tab joins the room it also hosts (a second connection as a controller), so a
 * person can play on the laptop without a phone. It lives outside React, so it survives the move from lobby to arena.
 * Same messages as the phone: room.join, reconnect, input.submit.
 */
export interface PcState {
  status: ConnStatus | "off";
  seat: string | null;
  joinCode: string | null;
  gameId: string;
  hero: string;
  /** the latest state.view of this seat (Hero Cards: the hand, which the big screen's view does not carry) */
  observation: Observation<unknown> | null;
}

class PcSession {
  private transport: Transport | null = null;
  private pipeline: InputPipeline | null = null;
  private token: string | null = null;
  private tick = 0;
  private control: RunnerControl = NO_CONTROL;
  private want: { code: string; hero: string; gameId: string } | null = null;
  private listeners = new Set<() => void>();
  state: PcState = { status: "off", seat: null, joinCode: null, gameId: "", hero: "", observation: null };

  subscribe = (l: () => void) => (this.listeners.add(l), () => this.listeners.delete(l));
  private set(patch: Partial<PcState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Take a seat in the room with this code (once; asking again for the same room and hero changes nothing). */
  join(gameId: string, code: string, hero: string) {
    const same = this.want?.code === code && this.want.hero === hero && this.want.gameId === gameId;
    if (same && this.transport) return;
    if (this.transport && this.want?.code !== code) this.leave();
    this.want = { code, hero, gameId };
    this.set({ gameId, joinCode: code, hero });
    if (!this.transport) this.open(gameId);
    else if (this.state.status === "online") this.sendJoin();
  }

  private open(gameId: string) {
    const t = createTransport("controller", { gameId });
    this.transport = t;
    t.onStatus((status) => {
      this.set({ status });
      if (status === "online") this.sendJoin();
      if (status === "lost") setTimeout(() => this.transport === t && t.reconnect(), 800);
    });
    t.subscribe((env) => this.onMessage(env));
  }

  private sendJoin() {
    const w = this.want;
    if (!w || !this.transport) return;
    if (this.state.seat && this.token) this.transport.send("reconnect", { joinCode: w.code, seatToken: this.token });
    else this.transport.send("room.join", { joinCode: w.code, name: "Player", hero: w.hero });
  }

  private onMessage(env: Envelope) {
    if (env.type === "room.status") {
      const p = env.payload as RoomStatusPayload;
      if (p.you && p.you !== this.state.seat) {
        this.pipeline?.dispose();
        const send = (input: ActionInput) => this.transport?.send("input.submit", input);
        this.pipeline = new InputPipeline(p.you, () => this.tick + 1, send);
        this.set({ seat: p.you });
      }
      if (p.seatToken) this.token = p.seatToken;
    } else if (env.type === "state.view") {
      const o = (env.payload as { observation?: Observation<unknown> })?.observation;
      if (typeof o?.tick === "number") {
        this.tick = o.tick;
        this.set({ observation: o });
      }
    }
  }

  /** Runner: a held button changed (the "control" action, only when the state changes). */
  press(button: keyof RunnerControl, down: boolean) {
    const next = withButton(this.control, button, down);
    if (!next || !this.pipeline) return;
    this.control = next;
    this.pipeline.action(CONTROL_ACTION, controlParams(next));
  }

  /** Any ActionInput of this seat (Hero Cards plays and end-turn go through here). */
  send(input: ActionInput) {
    this.transport?.send("input.submit", input);
  }

  /** Hero Arena: the keyboard's stick, and a button. */
  move(x: number, y: number) {
    this.pipeline?.setMove("keyboard", x, y);
  }
  button(action: "melee" | "projectile" | "guard") {
    this.pipeline?.press(action);
  }

  leave() {
    this.pipeline?.dispose();
    this.pipeline = null;
    this.transport?.close();
    this.transport = null;
    this.token = null;
    this.want = null;
    this.control = NO_CONTROL;
    this.set({ status: "off", seat: null, joinCode: null, observation: null });
  }
}

export const pcSession = new PcSession();

export function usePcSession(): PcState {
  return useSyncExternalStore(pcSession.subscribe, () => pcSession.state);
}
