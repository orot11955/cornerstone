import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { browserSecurityHeaders, buildContentSecurityPolicy, createNonce } from './security/headers'
import { sanitizeApiRequestHeaders } from './security/api-headers'

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/v1/')) {
    return NextResponse.next({ request: { headers: sanitizeApiRequestHeaders(request.headers) } })
  }
  const nonce = createNonce()
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce, {
    development: process.env.NODE_ENV === 'development',
  })
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', contentSecurityPolicy)
  for (const [name, value] of Object.entries(browserSecurityHeaders)) {
    response.headers.set(name, value)
  }
  return response
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
