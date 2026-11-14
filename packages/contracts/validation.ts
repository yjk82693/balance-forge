import type { SchemaNode } from './types.ts';
import { schema } from './schema.ts';
const fail = (): never => {
  throw Error('INVALID_SCHEMA');
};
function validateAlternatives(alternatives: SchemaNode[], value: any, exactlyOne: boolean): void {
  if (!Array.isArray(alternatives) || !alternatives.length) fail();
  let matches = 0;
  for (const alternative of alternatives) {
    try {
      validateSchema(alternative, value);
      matches++;
    } catch (error) {
      if (error.message !== 'INVALID_SCHEMA') throw error;
    }
  }
  if (matches === 0 || exactlyOne && matches !== 1) fail();
}
function validateString(definition: SchemaNode, value: any): void {
  if (typeof value !== 'string') fail();
  const length = Array.from(value).length;
  if (length < (definition.minLength ?? 0) || length > (definition.maxLength ?? Infinity)) fail();
  if (definition.pattern && !new RegExp(definition.pattern).test(value)) fail();
}
function validateArray(definition: SchemaNode, value: any): void {
  if (!Array.isArray(value)) fail();
  if (value.length < (definition.minItems ?? 0) || value.length > (definition.maxItems ?? Infinity)) fail();
  if (definition.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail();
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) fail();
    if (definition.items) validateSchema(definition.items, value[index]);
  }
}
function validateObject(definition: SchemaNode, value: any): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  if (Object.getPrototypeOf(value) !== Object.prototype) fail();
  const keys = Object.keys(value);
  if (keys.length < (definition.minProperties ?? 0) || keys.length > (definition.maxProperties ?? Infinity)) fail();
  for (const key of definition.required ?? []) if (!Object.hasOwn(value, key)) fail();
  for (const key of keys) {
    if (definition.propertyNames) validateSchema(definition.propertyNames, key);
    if (Object.hasOwn(definition.properties ?? {}, key)) {
      validateSchema(definition.properties[key], value[key]);
    } else if (definition.additionalProperties === false) {
      fail();
    } else if (typeof definition.additionalProperties === 'object') {
      validateSchema(definition.additionalProperties, value[key]);
    }
  }
}
export function validateSchema(definition: SchemaNode, value: any): any {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) fail();
  if (definition.$ref) {
    const match = definition.$ref.match(/^#\/\$defs\/([^/]+)$/);
    if (!match || !Object.hasOwn(schema.$defs, match[1])) fail();
    return validateSchema(schema.$defs[match[1]], value);
  }
  if (definition.anyOf) validateAlternatives(definition.anyOf, value, false);
  if (definition.oneOf) validateAlternatives(definition.oneOf, value, true);
  if (Object.hasOwn(definition, 'const') && value !== definition.const) fail();
  if (definition.enum && !definition.enum.includes(value)) fail();
  if (definition.type === 'null' && value !== null) fail();
  if (definition.type === 'integer' && (!Number.isSafeInteger(value) || Object.is(value, -0))) fail();
  if (definition.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) fail();
  if (definition.type === 'boolean' && typeof value !== 'boolean') fail();
  if (typeof value === 'number' && (value < (definition.minimum ?? -Infinity) || value > (
    definition.maximum ?? Infinity))) fail();
  if (definition.type === 'string') validateString(definition, value);
  if (definition.type === 'array') validateArray(definition, value);
  if (definition.type === 'object') validateObject(definition, value);
  return value;
}
export function validate(name: string, value: any): any {
  if (!Object.hasOwn(schema.$defs, name)) fail();
  return validateSchema(schema.$defs[name], value);
}
