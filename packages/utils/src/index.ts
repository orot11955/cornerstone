import type { Result } from '@cornerstone/types'

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

export function normalizeText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

export function clamp(value: number, minimum: number, maximum: number): number {
  if (![value, minimum, maximum].every(Number.isFinite)) {
    throw new TypeError('clamp only accepts finite numbers')
  }
  if (minimum > maximum) {
    throw new RangeError('minimum must not exceed maximum')
  }
  return Math.min(maximum, Math.max(minimum, value))
}

export function toIsoInstant(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) throw new RangeError('Invalid date')
  return date.toISOString()
}

export function encodeQuery(
  values: Readonly<Record<string, string | number | boolean | null | undefined>>,
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
    if (value !== undefined && value !== null) query.set(key, String(value))
  }
  return query.toString()
}

export function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}
