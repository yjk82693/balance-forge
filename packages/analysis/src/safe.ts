// Result-returning API: every function returns { ok: true, value } or { ok: false, error: { code, message } }.
// Use this at boundaries (server routes, CLI). The raw functions throw AnalysisError with the same codes.
import { fail, safely } from './errors.ts';
import { analyze } from './analyzer.ts';
import { judgePatch } from './verdict.ts';
import { addHumanRows } from './human.ts';
import { analyzeCards } from './cards.ts';
import { validatePatch } from './validator.ts';
import { applyPatchToData } from './replay.ts';

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
export { safeStorage } from './storage.ts';
