// Result-returning API: every function returns { ok: true, value } or { ok: false, error: { code, message } }.
// Use this at boundaries (server routes, CLI). The raw functions throw AnalysisError with the same codes.
import { fail, safely } from './errors.js';
import { analyze } from './analyzer.js';
import { judgePatch } from './verdict.js';
import { addHumanRows } from './human.js';
import { analyzeCards } from './cards.js';
import { validatePatch } from './validator.js';
import { applyPatchToData } from './replay.js';

export const analyzeResults = safely(analyze);
export const judge = safely(judgePatch);
export const withHumanRows = safely(addHumanRows);
export const cards = safely(analyzeCards);
/** { ok: true, value: proposal } when valid, else INVALID_PATCH with the reasons in details. */
export const checkPatch = safely((proposal, options) => {
  const check = validatePatch(proposal, options);
  if (!check.ok) fail('INVALID_PATCH', check.errors[0], check.errors);
  return proposal;
});
export const applyPatch = safely(applyPatchToData);
export { safeStorage } from './storage.js';
