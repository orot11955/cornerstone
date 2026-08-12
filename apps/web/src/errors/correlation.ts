const SAFE_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/

export function resolveCorrelationId(value: string | undefined): string | undefined {
  return value && SAFE_CORRELATION_ID.test(value) ? value : undefined
}
