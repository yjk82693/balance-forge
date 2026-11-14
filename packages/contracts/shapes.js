// Small schema constructors; all game payloads remain closed and bounded.
export const integer = (minimum = 0, maximum = 2147483647) => ({type:'integer', minimum, maximum});
export const text = (maxLength = 128) => ({type:'string', minLength:1, maxLength});
export const array = (items, maxItems, minItems = 0) => ({type:'array', items, minItems, maxItems});
export const object = (properties, required = Object.keys(properties)) => ({type:'object', additionalProperties:false, properties, required});
export const ref = name => ({$ref:`#/$defs/${name}`});
