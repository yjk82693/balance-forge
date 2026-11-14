/** A phone's seat, kept so a reload within the server's 10 s window can take it back (message `reconnect`). */
export interface SavedSeat {
  joinCode: string;
  name: string;
  hero: string;
  /** private token from room.status; the server rotates it on every successful reconnect */
  seatToken: string;
  /** sequence of the last input.ack we saw */
  lastAck: number;
  /** when we last heard from the server (ms since epoch) */
  at: number;
}

const KEY = "bf-seat";
export const RECONNECT_WINDOW_MS = 10_000;

export function saveSeat(seat: SavedSeat) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(seat));
  } catch {
    /* storage blocked: a reload will show the join form again */
  }
}

export function clearSeat() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** The saved seat, but only while the server would still accept it. */
export function loadSeat(now = Date.now()): SavedSeat | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const seat = raw ? (JSON.parse(raw) as SavedSeat) : null;
    if (!seat?.seatToken || now - seat.at >= RECONNECT_WINDOW_MS) return null;
    return seat;
  } catch {
    return null;
  }
}
