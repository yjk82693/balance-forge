import { createHash } from 'node:crypto';
import type { Json } from './types.ts';
function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character: string) => character.codePointAt(0) as number);
  const rightPoints = Array.from(right, (character: string) => character.codePointAt(0) as number);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}
export function canonicalJson(value: Json): string {
  const ancestors = new Set<object>();
  function encode(item: Json, depth: number): string {
    if (depth > 32) throw Error('INVALID_SCHEMA');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || Object.is(item, -0)) throw Error('INVALID_SCHEMA');
      return String(item);
    }
    if (typeof item !== 'object' || ancestors.has(item)) throw Error('INVALID_SCHEMA');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) throw Error('INVALID_SCHEMA');
    ancestors.add(item);
    const encoded = Array.isArray(item) ? '[' + Array.from(item, (child: Json) => encode(child, depth + 1)).join(
      ',') + ']' : '{' + Object.keys(item).sort(compareCodePoints).map(key => JSON.stringify(key) + ':' + encode(
      (item as { [key: string]: Json })[key], depth + 1)).join(',') + '}';
    ancestors.delete(item);
    return encoded;
  }
  return encode(value, 0);
}
export const hash = (value: Json): string => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
