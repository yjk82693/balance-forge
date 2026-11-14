// Clear error results instead of uncaught exceptions. Public entry points either return a value or
// { ok: false, error: { code, message, details? } }. Messages never contain file contents or secrets.
export const ERROR_CODES = [
  'INVALID_INPUT', 'INVALID_JSON', 'IO_ERROR', 'NO_RESULTS', 'MIXED_DATAHASH', 'INVALID_REPORT',
  'INVALID_PATCH', 'PATCH_BASE_MISMATCH', 'PATCH_PATH_MISSING', 'NO_DECISIVE_MATCH', 'DATA_HASH_MISMATCH',
  'REPLAY_MISMATCH', 'SIMULATION_FAILED', 'ENGINE_UNAVAILABLE', 'USAGE', 'INTERNAL',
];

export class AnalysisError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
    this.details = details;
  }
}

export const fail = (code, message, details) => {
  throw new AnalysisError(code, message, details);
};

export const errorResult = (code, message, details) => ({
  ok: false,
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

export function toErrorResult(e) {
  if (e instanceof AnalysisError) return errorResult(e.code, e.message, e.details);
  return errorResult('INTERNAL', String(e?.message ?? e).slice(0, 200)); // a bug, but still a result
}

export const isError = (r) => r !== null && typeof r === 'object' && r.ok === false && typeof r.error?.code === 'string';

/** Wrap a (sync or async) function: returns { ok: true, value } or an error result. Never throws. */
export function safely(fn) {
  return (...args) => {
    try {
      const out = fn(...args);
      if (out && typeof out.then === 'function') {
        return out.then((value) => ({ ok: true, value }), toErrorResult);
      }
      return { ok: true, value: out };
    } catch (e) {
      return toErrorResult(e);
    }
  };
}
