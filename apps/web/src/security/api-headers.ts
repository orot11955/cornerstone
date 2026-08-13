const BLOCKED_EXACT = new Set(['authorization', 'forwarded'])
const BLOCKED_PREFIXES = ['x-forwarded-', 'x-user-', 'x-role', 'x-auth-']

/** Remove client-spoofable identity and routing headers before the fixed API rewrite. */
export function sanitizeApiRequestHeaders(source: Headers): Headers {
  const headers = new Headers(source)
  for (const name of Array.from(headers.keys())) {
    const normalized = name.toLowerCase()
    if (
      BLOCKED_EXACT.has(normalized) ||
      BLOCKED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ) {
      headers.delete(name)
    }
  }
  return headers
}
