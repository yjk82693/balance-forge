import { validateSchema } from '../../packages/contracts/index.js';
import { integer, text, object } from '../../packages/contracts/shapes.js';
const optionalText = maxLength => ({
  type: 'string',
  maxLength
});
export const envelopeSchema = object({
  protocolVersion: {
    const: '0.1'
  },
  type: text(),
  roomId: optionalText(128),
  sessionId: optionalText(128),
  requestId: optionalText(128),
  seq: integer(),
  epoch: integer(0),
  payload: {
    type: 'object'
  }
});
const id = {
  enum: ['hero_arena', 'hero_cards']
};
export const payloadSchemas = {
  'room.create': object({
    gameId: id
  }, []),
  'room.join': object({
    joinCode: {
      type: 'string',
      pattern: '^[A-Za-z0-9]{4}$'
    },
    name: text(40),
    hero: text(),
    seatToken: {
      type: 'string',
      minLength: 32,
      maxLength: 128
    }
  }, ['joinCode', 'name', 'hero']),
  'reconnect': object({
    joinCode: {
      type: 'string',
      pattern: '^[A-Za-z0-9]{4}$'
    },
    seatToken: {
      type: 'string',
      minLength: 32,
      maxLength: 128
    },
    lastAck: integer()
  }, ['joinCode', 'seatToken']),
  'game.select': object({
    gameId: id,
    dataHash: {
      type: 'string',
      pattern: '^[0-9a-f]{64}$'
    }
  }, ['gameId']),
  'match.start': object({
    gameId: id,
    seed: integer(1, 4294967295),
    maxTicks: integer(1, 1800),
    bot: {
      type: 'boolean'
    }
  }, []),
  'match.reset': object({}),
  'ping': object({})
};
export function assertDepth(value, depth = 0) {
  if (depth > 32) throw Error('INVALID_SCHEMA');
  if (value && typeof value === 'object') for (const item of Object.values(value)) assertDepth(item, depth + 1);
}
export function parseEnvelope(raw) {
  if (Buffer.byteLength(raw) > 65536) throw Error('INVALID_SCHEMA');
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Error('INVALID_SCHEMA');
  }
  assertDepth(value);
  validateSchema(envelopeSchema, value);
  return value;
}
export function validatePayload(type, payload) {
  const schema = Object.hasOwn(payloadSchemas, type) ? payloadSchemas[type] : null;
  if (!schema) throw Error('INVALID_SCHEMA');
  return validateSchema(schema, payload);
}
export const errorCodes = new Set(['INVALID_SCHEMA', 'ILLEGAL_ACTION', 'LATE_INPUT', 'STALE_TURN', 'VERSION_MISMATCH',
  'HASH_MISMATCH', 'RATE_LIMITED', 'ROOM_FULL', 'AUTH_EXPIRED', 'TRANSPORT_UNAVAILABLE', 'PATCH_REJECTED']);
export const errorCode = error => errorCodes.has(error?.message) ? error.message : 'TRANSPORT_UNAVAILABLE';
