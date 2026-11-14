import { readFileSync } from 'node:fs';
export const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'));
