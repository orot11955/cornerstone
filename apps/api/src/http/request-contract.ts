import { createHash } from 'node:crypto';

const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,128}$/;
const STRONG_ETAG = /^"(0|[1-9]\d*)"$/;

export function validateIdempotencyKey(value: string): string {
  if (!IDEMPOTENCY_KEY.test(value)) {
    throw new TypeError(
      'Idempotency-Key must contain 1 to 128 visible ASCII characters',
    );
  }
  return value;
}

export function hashCanonicalPayload(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value, new WeakSet()))
    .digest('hex');
}

export function formatStrongEtag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new RangeError('version must be a non-negative safe integer');
  }
  return `"${version}"`;
}

export function parseStrongEtag(value: string): number {
  const match = value.match(STRONG_ETAG);
  const version = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(version)) {
    throw new TypeError('If-Match must contain one strong numeric ETag');
  }
  return version;
}

function canonicalJson(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('Payload contains a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    assertAcyclic(value, ancestors);
    const result = `[${value.map((item) => canonicalJson(item, ancestors)).join(',')}]`;
    ancestors.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    assertAcyclic(value, ancestors);
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    const result = `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalJson(item, ancestors)}`,
      )
      .join(',')}}`;
    ancestors.delete(value);
    return result;
  }
  throw new TypeError('Payload contains a non-JSON value');
}

function assertAcyclic(value: object, ancestors: WeakSet<object>): void {
  if (ancestors.has(value))
    throw new TypeError('Payload contains a circular reference');
  ancestors.add(value);
}
