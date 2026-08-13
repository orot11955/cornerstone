import type { components, operations } from './generated/schema.js'

const DEFAULT_TIMEOUT_MS = 10_000

export interface ApiClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly timeoutMs?: number
}

export type {
  components as ApiComponents,
  operations as ApiOperations,
  paths as ApiPaths,
} from './generated/schema.js'

export interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'redirect'> {
  readonly body?: unknown
  readonly query?: Readonly<Record<string, string | number | boolean | null | undefined>>
  /** Requests are always made with manual redirect handling. */
  readonly redirect?: never
  /** Overrides the client timeout for this request. Set to 0 to disable it. */
  readonly timeoutMs?: number
}

export type ApiRequest = <T>(path: string, options?: ApiRequestOptions) => Promise<T>

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly response: Response,
  ) {
    super(`API request failed with status ${status}`)
    this.name = 'ApiError'
  }
}

export function createApiClient(options: ApiClientOptions): ApiRequest {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const baseUrl = parseBaseUrl(options.baseUrl)
  const defaultTimeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  return async function request<T>(
    path: string,
    requestOptions: ApiRequestOptions = {},
  ): Promise<T> {
    if (Reflect.has(requestOptions, 'redirect')) {
      throw new TypeError('API requests must use manual redirect handling')
    }

    const { body, query, timeoutMs, signal, ...requestInit } = requestOptions
    const url = resolveApiPath(baseUrl, path)
    for (const [key, value] of Object.entries(query ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }

    const headers = new Headers(options.headers)
    for (const [key, value] of new Headers(requestOptions.headers)) headers.set(key, value)
    if (body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }

    const timeout = validateTimeout(timeoutMs ?? defaultTimeoutMs)
    const timeoutController = timeout > 0 ? new AbortController() : undefined
    const timeoutId = timeoutController
      ? setTimeout(() => timeoutController.abort(), timeout)
      : undefined
    const requestSignal = mergeAbortSignals(signal ?? undefined, timeoutController?.signal)

    try {
      const fetchOptions: RequestInit = {
        ...requestInit,
        headers,
        redirect: 'manual',
        ...(requestSignal ? { signal: requestSignal } : {}),
      }
      if (body !== undefined) fetchOptions.body = JSON.stringify(body)

      const response = await fetchImplementation(url, fetchOptions)
      if (!response.ok) throw new ApiError(response.status, response)
      if (response.status === 204) return undefined as T
      return (await response.json()) as T
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }
}

export interface AuthMutationOptions extends Omit<
  ApiRequestOptions,
  'body' | 'headers' | 'method'
> {
  readonly csrfToken: string
  readonly headers?: HeadersInit
}

export interface AuthApi {
  csrf(options?: ApiRequestOptions): Promise<components['schemas']['CsrfResponseDto']>
  me(options?: ApiRequestOptions): Promise<components['schemas']['AuthenticatedUserResponseDto']>
  sessions(options?: ApiRequestOptions): Promise<components['schemas']['SessionListResponseDto']>
  login(
    input: operations['login']['requestBody']['content']['application/json'],
    options: AuthMutationOptions,
  ): Promise<components['schemas']['AuthenticatedUserResponseDto']>
  logout(options: AuthMutationOptions): Promise<void>
  changePassword(
    input: operations['changePassword']['requestBody']['content']['application/json'],
    options: AuthMutationOptions,
  ): Promise<void>
  forgotPassword(
    input: operations['requestPasswordReset']['requestBody']['content']['application/json'],
    options: AuthMutationOptions,
  ): Promise<components['schemas']['AcceptedResponseDto']>
  resetPassword(
    input: operations['resetPassword']['requestBody']['content']['application/json'],
    options: AuthMutationOptions,
  ): Promise<void>
  confirmRecentAuthentication(
    input: operations['confirmRecentAuthentication']['requestBody']['content']['application/json'],
    options: AuthMutationOptions,
  ): Promise<void>
  refresh(options: AuthMutationOptions): Promise<components['schemas']['RefreshResponseDto']>
  register(
    input: operations['register']['requestBody']['content']['application/json'],
    options: AuthMutationOptions,
  ): Promise<components['schemas']['AcceptedResponseDto']>
  revokeAllSessions(options: AuthMutationOptions): Promise<void>
  revokeSession(sessionId: string, options: AuthMutationOptions): Promise<void>
  resendVerification(
    input: operations['resendVerification']['requestBody']['content']['application/json'],
    options: AuthMutationOptions,
  ): Promise<components['schemas']['AcceptedResponseDto']>
  verifyEmail(
    input: operations['verifyEmail']['requestBody']['content']['application/json'],
    options: AuthMutationOptions,
  ): Promise<components['schemas']['AcceptedResponseDto']>
}

export function createAuthApi(request: ApiRequest): AuthApi {
  return {
    csrf: (options) => request('/api/v1/auth/csrf', { ...options, method: 'GET' }),
    me: (options) => request('/api/v1/auth/me', { ...options, method: 'GET' }),
    sessions: (options) => request('/api/v1/auth/sessions', { ...options, method: 'GET' }),
    login: (input, options) => request('/api/v1/auth/login', mutation('POST', input, options)),
    logout: (options) => request('/api/v1/auth/logout', mutation('POST', undefined, options)),
    changePassword: (input, options) =>
      request('/api/v1/auth/password/change', mutation('POST', input, options)),
    forgotPassword: (input, options) =>
      request('/api/v1/auth/password/forgot', mutation('POST', input, options)),
    resetPassword: (input, options) =>
      request('/api/v1/auth/password/reset', mutation('POST', input, options)),
    confirmRecentAuthentication: (input, options) =>
      request('/api/v1/auth/recent-auth', mutation('POST', input, options)),
    refresh: (options) => request('/api/v1/auth/refresh', mutation('POST', undefined, options)),
    register: (input, options) =>
      request('/api/v1/auth/register', mutation('POST', input, options)),
    revokeAllSessions: (options) =>
      request('/api/v1/auth/sessions', mutation('DELETE', undefined, options)),
    revokeSession: (sessionId, options) => {
      if (!isSafeSessionId(sessionId))
        throw new TypeError('sessionId must be one safe path segment')
      return request(`/api/v1/auth/sessions/${sessionId}`, mutation('DELETE', undefined, options))
    },
    resendVerification: (input, options) =>
      request('/api/v1/auth/verification/resend', mutation('POST', input, options)),
    verifyEmail: (input, options) =>
      request('/api/v1/auth/verify-email', mutation('POST', input, options)),
  }
}

function mutation(
  method: 'POST' | 'DELETE',
  body: unknown,
  options: AuthMutationOptions,
): ApiRequestOptions {
  const headers = new Headers(options.headers)
  headers.set('x-csrf-token', options.csrfToken)
  return { ...options, method, body, headers }
}

function parseBaseUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('baseUrl must be an absolute HTTP(S) URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
    throw new TypeError('baseUrl must be an absolute HTTP(S) URL without query or hash')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function resolveApiPath(baseUrl: URL, path: string): URL {
  if (
    !path ||
    path.includes('\\') ||
    path.includes('?') ||
    path.includes('#') ||
    path.startsWith('//')
  ) {
    throw new TypeError('API path must be a relative path without query, hash, or backslash')
  }
  const relativePath = path.replace(/^\/+/, '')
  if (!relativePath || relativePath.split('/').some((segment) => !isPathSegment(segment))) {
    throw new TypeError('API path must not escape the configured base path')
  }
  const url = new URL(relativePath, baseUrl)
  if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) {
    throw new TypeError('API path must not change origin or escape the configured base path')
  }
  return url
}

function isPathSegment(segment: string): boolean {
  return segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes('\\')
}

function isSafeSessionId(value: string): boolean {
  if (!isPathSegment(value) || value.includes('/')) return false
  try {
    const decoded = decodeURIComponent(value)
    return decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\')
  } catch {
    return false
  }
}

function validateTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 0)
    throw new TypeError('timeoutMs must be a non-negative finite number')
  return value
}

function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  if (activeSignals.length === 0) return undefined
  if (activeSignals.length === 1) return activeSignals[0]
  return AbortSignal.any(activeSignals)
}
