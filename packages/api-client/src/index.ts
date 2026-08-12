export interface ApiClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: Readonly<Record<string, string>>
}

export type {
  components as ApiComponents,
  operations as ApiOperations,
  paths as ApiPaths,
} from './generated/schema.js'

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  readonly body?: unknown
  readonly query?: Readonly<Record<string, string | number | boolean | null | undefined>>
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly response: Response,
  ) {
    super(`API request failed with status ${status}`)
    this.name = 'ApiError'
  }
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const baseUrl = new URL(options.baseUrl)

  return async function request<T>(
    path: string,
    requestOptions: ApiRequestOptions = {},
  ): Promise<T> {
    const { body, query, ...requestInit } = requestOptions
    const url = new URL(path.replace(/^\//, ''), ensureTrailingSlash(baseUrl))
    for (const [key, value] of Object.entries(query ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }

    const headers = new Headers(options.headers)
    for (const [key, value] of new Headers(requestOptions.headers)) headers.set(key, value)
    if (body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }

    const fetchOptions: RequestInit = {
      ...requestInit,
      headers,
    }
    if (body !== undefined) fetchOptions.body = JSON.stringify(body)

    const response = await fetchImplementation(url, fetchOptions)
    if (!response.ok) throw new ApiError(response.status, response)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url)
  if (!copy.pathname.endsWith('/')) copy.pathname += '/'
  return copy
}
