const MAX_TOKEN_LENGTH = 4096

/** Only the exact `#token=<encoded>` fragment shape is accepted for action links. */
export function parseActionTokenFragment(fragment: string): string | undefined {
  if (!fragment.startsWith('#token=') || fragment.slice(1).includes('&')) return undefined
  const encoded = fragment.slice('#token='.length)
  if (!encoded || encoded.length > MAX_TOKEN_LENGTH) return undefined
  try {
    const token = decodeURIComponent(encoded)
    if (!token || token.length > MAX_TOKEN_LENGTH || /[\u0000-\u001f\u007f]/.test(token))
      return undefined
    return token
  } catch {
    return undefined
  }
}
