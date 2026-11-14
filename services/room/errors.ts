export const messages = {
  INVALID_SCHEMA: 'Invalid message shape or parameter. Check actions.available for the current action domain.',
  ILLEGAL_ACTION: 'This action is not legal for this seat or match phase.',
  LATE_INPUT: 'Input tick is outside the window. Submit for the next tick from the latest state.view.',
  STALE_TURN: 'The turn or room epoch changed. Refresh from the latest state.view and room.status.',
  VERSION_MISMATCH: 'The game or simulation version does not match.',
  HASH_MISMATCH: 'The content or state hash does not match the pinned version.',
  RATE_LIMITED: 'Too many requests. Wait before retrying.',
  ROOM_FULL: 'All supported player seats are occupied.',
  AUTH_EXPIRED: 'The seat token is invalid, expired, already connected, or belongs to another room.',
  TRANSPORT_UNAVAILABLE: 'The service could not complete the request. Retry after reconnecting.',
  PATCH_REJECTED: 'The patch must contain only allowed numeric replacements for a retained content version.'
};
