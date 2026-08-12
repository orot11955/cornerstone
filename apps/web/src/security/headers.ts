const SAFE_NONCE = /^[A-Za-z0-9+/]+={0,2}$/

export interface ContentSecurityPolicyOptions {
  readonly development?: boolean
}

export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Buffer.from(bytes).toString('base64')
}

export function buildContentSecurityPolicy(
  nonce: string,
  options: ContentSecurityPolicyOptions = {},
): string {
  if (!SAFE_NONCE.test(nonce)) {
    throw new Error('CSP nonce must be base64 encoded')
  }

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(options.development ? ["'unsafe-eval'"] : []),
  ]
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    ...(options.development ? [] : ['upgrade-insecure-requests']),
  ]
  return `${directives.join('; ')};`
}

export const browserSecurityHeaders = {
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const
