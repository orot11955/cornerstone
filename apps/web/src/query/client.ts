import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query'
import { cache } from 'react'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) && !isAuthQuery(query.queryKey),
      },
    },
  })
}

/** React cache scopes this client to the current server request. */
export const getServerQueryClient = cache(createQueryClient)

export function isAuthQuery(queryKey: readonly unknown[]): boolean {
  return queryKey.some(
    (part) => typeof part === 'string' && /(^|:)(auth|user|session)(:|$)/i.test(part),
  )
}
