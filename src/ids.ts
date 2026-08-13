const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is an 8-4-4-4-12 hex UUID. */
export function isUuid( value: string ): boolean {
  return UUID_RE.test( value );
}

/** Lowercase a UUID. Callers must already know it is valid. */
export function normalizeUuid( value: string ): string {
  return value.toLowerCase();
}
