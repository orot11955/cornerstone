const ACCESS_COOKIE_NAMES = new Set(['cs_access', '__Host-cs_access'])
const REFRESH_COOKIE_NAMES = new Set(['cs_refresh', '__Host-cs_refresh'])

export interface AuthCookies {
  readonly access?: { readonly name: string; readonly value: string }
  readonly hasRefresh: boolean
}

/** Raw Cookie parsing rejects duplicate, malformed, empty, and invalidly encoded auth cookies. */
export function parseAuthCookies(raw: string | null): AuthCookies {
  if (!raw) return { hasRefresh: false }
  const parsed: Array<{ name: string; value: string }> = []
  for (const entry of raw.split(';').map((part) => part.trim())) {
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    const name = entry.slice(0, separator)
    const value = entry.slice(separator + 1)
    const isAuthCookie = ACCESS_COOKIE_NAMES.has(name) || REFRESH_COOKIE_NAMES.has(name)
    if (!isAuthCookie) continue
    if (!value || /[\s;,]/.test(name)) return { hasRefresh: false }
    try {
      const decoded = decodeURIComponent(value)
      if (!decoded || (value.includes('%') && encodeURIComponent(decoded) !== value)) {
        return { hasRefresh: false }
      }
    } catch {
      return { hasRefresh: false }
    }
    parsed.push({ name, value })
  }
  const access = parsed.filter((entry) => ACCESS_COOKIE_NAMES.has(entry.name))
  const refresh = parsed.filter((entry) => REFRESH_COOKIE_NAMES.has(entry.name))
  return { ...(access.length === 1 ? { access: access[0] } : {}), hasRefresh: refresh.length === 1 }
}
