import { createHash } from 'node:crypto';
function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, character => character.codePointAt(0));
  const rightPoints = Array.from(right, character => character.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}
export function canonicalJson(value) {
  const ancestors = new Set();
  function encode(item, depth) {
    if (depth > 32) throw Error('INVALID_SCHEMA');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || Object.is(item, -0)) throw Error('INVALID_SCHEMA');
      return String(item);
    }
    if (typeof item !== 'object' || ancestors.has(item)) throw Error('INVALID_SCHEMA');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) throw Error('INVALID_SCHEMA');
    ancestors.add(item);
    const encoded = Array.isArray(item) ? '[' + Array.from(item, child => encode(child, depth + 1)).join(
      ',') + ']' : '{' + Object.keys(item).sort(compareCodePoints).map(key => JSON.stringify(key) + ':' + encode(item[
      key], depth + 1)).join(',') + '}';
    ancestors.delete(item);
    return encoded;
  }
  return encode(value, 0);
}
export const hash = value => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
