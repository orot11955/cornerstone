import 'server-only'

import { createApiClient, createAuthApi, type AuthApi } from '@cornerstone/api-client'
import { headers } from 'next/headers'
import { getWebConfig } from '../config/web'
import { parseAuthCookies } from './cookies'

/** Server Components forward only one verified access cookie to the fixed API origin. */
export async function getServerAuthApi(): Promise<AuthApi> {
  const requestHeaders = await headers()
  const access = parseAuthCookies(requestHeaders.get('cookie')).access

  const upstreamHeaders: Record<string, string> = {}
  if (access?.value) upstreamHeaders.cookie = `${access.name}=${encodeURIComponent(access.value)}`
  return createAuthApi(
    createApiClient({
      baseUrl: getWebConfig().internalApiUrl.origin,
      headers: upstreamHeaders,
    }),
  )
}
import 'server-only'
