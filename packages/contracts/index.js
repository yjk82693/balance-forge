import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url)));
const compare = (a,b) => { const x=Array.from(a, c=>c.codePointAt(0)), y=Array.from(b,c=>c.codePointAt(0)); for(let i=0;i<Math.min(x.length,y.length);i++) if(x[i]!==y[i]) return x[i]-y[i]; return x.length-y.length; };
export function canonicalJson(value) {
 const seen=new Set();
 function encode(v,depth) {
  if(depth>32) throw Error('INVALID_SCHEMA');
  if(v===null || typeof v==='boolean' || typeof v==='string') return JSON.stringify(v);
  if(typeof v==='number') { if(!Number.isSafeInteger(v)||Object.is(v,-0)) throw Error('INVALID_SCHEMA'); return String(v); }
  if(typeof v!=='object'||seen.has(v)) throw Error('INVALID_SCHEMA');
  if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype) throw Error('INVALID_SCHEMA');
  seen.add(v);
  const result=Array.isArray(v) ? '['+Array.from(v,x=>encode(x,depth+1)).join(',')+']' : '{'+Object.keys(v).sort(compare).map(k=>JSON.stringify(k)+':'+encode(v[k],depth+1)).join(',')+'}';
  seen.delete(v); return result;
 }
 return encode(value,0);
}
export const hash = value => createHash('sha256').update(canonicalJson(value),'utf8').digest('hex');
export function validateSchema(s,v) {
 if(s.anyOf) { for (const candidate of s.anyOf) { try { return validateSchema(candidate,v); } catch {} } throw Error('INVALID_SCHEMA'); }
 if(s.type==='null' && v!==null) throw Error('INVALID_SCHEMA');
 if(s.$ref) return validateSchema(schema.$defs[s.$ref.split('/').at(-1)],v);
 const fail=()=>{throw Error('INVALID_SCHEMA');};
 if('const'in s && v!==s.const) fail();
 if(s.enum&&!s.enum.includes(v)) fail();
 if(s.type==='integer'&&(!Number.isSafeInteger(v)||Object.is(v,-0))) fail();
 if(s.type==='number'&&(typeof v!=='number'||!Number.isFinite(v))) fail();
 if(s.type==='boolean'&&typeof v!=='boolean') fail();
 if(s.type==='string') { if(typeof v!=='string'||Array.from(v).length<(s.minLength??0)||Array.from(v).length>(s.maxLength??Infinity)||(s.pattern&&!new RegExp(s.pattern).test(v))) fail(); }
 if(typeof v==='number'&&(v<(s.minimum??-Infinity)||v>(s.maximum??Infinity))) fail();
 if(s.type==='array') { if(!Array.isArray(v)||v.length<(s.minItems??0)||v.length>(s.maxItems??Infinity)) fail(); if(s.uniqueItems&&new Set(v.map(x=>JSON.stringify(x))).size!==v.length) fail(); v.forEach(x=>validateSchema(s.items,x)); }
 if(s.type==='object') { if(!v||typeof v!=='object'||Array.isArray(v)) fail(); if(Object.keys(v).length>(s.maxProperties??Infinity)) fail(); for(const k of s.required??[]) if(!Object.hasOwn(v,k)) fail(); for(const k of Object.keys(v)) { if(Object.hasOwn(s.properties??{},k)) validateSchema(s.properties[k],v[k]); else if(s.additionalProperties===false) fail(); } }
 return v;
}
export const validate=(name,value)=>validateSchema(schema.$defs[name]??(()=>{throw Error('INVALID_SCHEMA');})(),value);
export { registerGame, validateGamePayload, validateData, validateConfig, validateOutcome, validateFrame, restoreSnapshot, applyPatch, compareIds } from './semantics.js';
