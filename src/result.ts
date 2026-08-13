import type { EngineError, Result } from './types.js';

/** Successful domain result. */
export function ok<T>( value: T ): Result<T> {
  return { ok: true, value };
}

/** Failed domain result. */
export function err( error: EngineError ): Result<never> {
  return { ok: false, error };
}
