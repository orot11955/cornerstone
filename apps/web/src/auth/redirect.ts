const ALLOWED_RETURN_PATHS = new Set(['/', '/settings/security'])

export function safeReturnPath(value: string | null | undefined): string {
  if (!value || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return '/'
  try {
    const decoded = decodeURIComponent(value)
    if (decoded !== value || decoded.includes('\\') || decoded.includes('//')) return '/'
  } catch {
    return '/'
  }
  return ALLOWED_RETURN_PATHS.has(value) ? value : '/'
}
