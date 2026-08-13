import 'server-only'

import { ApiError, type ApiComponents } from '@cornerstone/api-client'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getServerAuthApi } from '../api/server'
import { parseAuthCookies } from '../api/cookies'
import { getServerQueryClient } from '../query/client'
import { safeReturnPath } from './redirect'

export async function requireAuthenticatedUser(
  returnPath: string,
): Promise<ApiComponents['schemas']['UserResponseDto']> {
  try {
    const client = getServerQueryClient()
    return await client.fetchQuery({
      queryKey: ['auth', 'me'],
      queryFn: async () => (await (await getServerAuthApi()).me({ cache: 'no-store' })).user,
      retry: false,
    })
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) {
      const requestHeaders = await headers()
      const hasRefresh = parseAuthCookies(requestHeaders.get('cookie')).hasRefresh
      const next = encodeURIComponent(safeReturnPath(returnPath))
      redirect(hasRefresh ? `/auth/refresh?next=${next}` : `/login?next=${next}`)
    }
    throw cause
  }
}
