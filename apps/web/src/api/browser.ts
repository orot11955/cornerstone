'use client'

import { createBrowserAuthApi } from '@cornerstone/api-client/browser'

/** Browser traffic is intentionally same-origin so cookies and CSRF stay in the browser boundary. */
let browserAuthApi: ReturnType<typeof createBrowserAuthApi> | undefined

export function getBrowserAuthApi() {
  browserAuthApi ??= createBrowserAuthApi({ baseUrl: window.location.origin })
  return browserAuthApi
}
