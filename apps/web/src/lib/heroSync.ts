// Keeping the room's record of a phone's hero equal to the hero the phone shows. The room only learns the hero from
// room.join; a phone that changes it afterwards (or resumes a saved seat) sends room.hero { hero } in the lobby.

export interface HeroSyncState {
  /** the room phase from room.status */
  phase: string | undefined;
  /** the hero the room has for this seat (room.status), if it has said */
  seatHero: string | undefined;
  /** the hero the phone shows and wants */
  wanted: string;
  online: boolean;
  /** this phone holds a seat */
  seated: boolean;
  /** the hero already sent and not yet confirmed, so a refusal is not retried in a loop */
  lastSent?: string;
}

/** The hero to send now, or null when nothing is needed (not seated, not in the lobby, already equal or sent). */
export function heroToSend(s: HeroSyncState): string | null {
  if (!s.seated || !s.online || s.phase !== "lobby") return null;
  if (!s.wanted || s.wanted === s.seatHero || s.wanted === s.lastSent) return null;
  return s.wanted;
}

/** Whatever has send(type, payload): the room transport. */
export interface Sender {
  send(type: string, payload: unknown): void;
}

/** Sends the hero when one is due; returns what was sent (for lastSent) or null. */
export function syncHero(transport: Sender | null, s: HeroSyncState): string | null {
  const hero = heroToSend(s);
  if (!hero || !transport) return null;
  transport.send("room.hero", { hero });
  return hero;
}
