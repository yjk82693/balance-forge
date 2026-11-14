import type { SchemaNode } from './types.ts';
// Small schema constructors; all game payloads remain closed and bounded.
export const integer = (minimum = 0, maximum = 2147483647): SchemaNode => ({
  type: 'integer',
  minimum,
  maximum
});
export const text = (maxLength = 128): SchemaNode => ({
  type: 'string',
  minLength: 1,
  maxLength
});
export const array = (items: SchemaNode, maxItems: number, minItems = 0): SchemaNode => ({
  type: 'array',
  items,
  minItems,
  maxItems
});
export const object = (properties: Record<string, SchemaNode>,
  required: string[] = Object.keys(properties)): SchemaNode => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required
});
export const ref = (name: string): SchemaNode => ({
  $ref: `#/$defs/${name}`
});
