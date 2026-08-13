import {
  ApiError,
  createApiClient,
  createAuthApi,
  type ApiClientOptions,
  type ApiRequest,
  type ApiRequestOptions,
  type AuthApi,
  type AuthMutationOptions,
} from './index.js'

const DEFAULT_TIMEOUT_MS = 10_000

export { ApiError, createApiClient, createAuthApi }
export type {
  ApiClientOptions,
  ApiRequest,
  ApiRequestOptions,
  ApiComponents,
  ApiOperations,
  ApiPaths,
  AuthApi,
  AuthMutationOptions,
} from './index.js'

export interface BrowserAuthApiOptions extends ApiClientOptions {
  readonly preauthCsrfCookieName?: string
  readonly sessionCsrfCookieName?: string
  /** Injected only for non-browser tests. Production callers must not persist token values. */
  readonly getCookie?: () => string
}

export interface BrowserAuthApi {
  readonly request: ApiRequest
  readonly auth: Omit<
    AuthApi,
    | 'login'
    | 'logout'
    | 'changePassword'
    | 'forgotPassword'
    | 'resetPassword'
    | 'confirmRecentAuthentication'
    | 'refresh'
    | 'register'
    | 'revokeAllSessions'
    | 'revokeSession'
    | 'resendVerification'
    | 'verifyEmail'
  > & {
    login(
      input: Parameters<AuthApi['login']>[0],
      options?: Omit<AuthMutationOptions, 'csrfToken'>,
    ): ReturnType<AuthApi['login']>
    logout(options?: Omit<AuthMutationOptions, 'csrfToken'>): ReturnType<AuthApi['logout']>
    changePassword(
      input: Parameters<AuthApi['changePassword']>[0],
      options?: Omit<AuthMutationOptions, 'csrfToken'>,
    ): ReturnType<AuthApi['changePassword']>
    forgotPassword(
      input: Parameters<AuthApi['forgotPassword']>[0],
      options?: Omit<AuthMutationOptions, 'csrfToken'>,
    ): ReturnType<AuthApi['forgotPassword']>
    resetPassword(
      input: Parameters<AuthApi['resetPassword']>[0],
      options?: Omit<AuthMutationOptions, 'csrfToken'>,
    ): ReturnType<AuthApi['resetPassword']>
    confirmRecentAuthentication(
      input: Parameters<AuthApi['confirmRecentAuthentication']>[0],
      options?: Omit<AuthMutationOptions, 'csrfToken'>,
    ): ReturnType<AuthApi['confirmRecentAuthentication']>
    refresh(options?: Omit<AuthMutationOptions, 'csrfToken'>): ReturnType<AuthApi['refresh']>
    register(
      input: Parameters<AuthApi['register']>[0],
      options?: Omit<AuthMutationOptions, 'csrfToken'>,
    ): ReturnType<AuthApi['register']>
    revokeAllSessions(
      options?: Omit<AuthMutationOptions, 'csrfToken'>,
    ): ReturnType<AuthApi['revokeAllSessions']>
    revokeSession(
      sessionId: string,
      options?: Omit<AuthMutationOptions, 'csrfToken'>,
    ): ReturnType<AuthApi['revokeSession']>
    resendVerification(
      input: Parameters<AuthApi['resendVerification']>[0],
      options?: Omit<AuthMutationOptions, 'csrfToken'>,
    ): ReturnType<AuthApi['resendVerification']>
    verifyEmail(
      input: Parameters<AuthApi['verifyEmail']>[0],
      options?: Omit<AuthMutationOptions, 'csrfToken'>,
    ): ReturnType<AuthApi['verifyEmail']>
  }
}

export function createBrowserAuthApi(options: BrowserAuthApiOptions): BrowserAuthApi {
  validateBrowserBaseUrl(options.baseUrl)
  const requestWithoutRecovery = createApiClient(toApiClientOptions(options))
  const rawAuth = createAuthApi(requestWithoutRecovery)
  const getCookie = options.getCookie ?? defaultCookieReader
  const preauthCsrfCookieName =
    options.preauthCsrfCookieName ?? defaultCookieName('cs_preauth_csrf')
  const sessionCsrfCookieName = options.sessionCsrfCookieName ?? defaultCookieName('cs_csrf')
  let refreshPromise: Promise<void> | undefined
  let terminalAuthFailure: ApiError | undefined

  const request: ApiRequest = async <T>(path: string, requestOptions: ApiRequestOptions = {}) => {
    if (isRecoverableAuthGet(path, requestOptions) && terminalAuthFailure) {
      throw terminalAuthFailure
    }
    const deadline = createDeadline(requestOptions, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const withCredentials = withDeadline(
      { ...requestOptions, credentials: 'include' as const },
      deadline,
    )
    try {
      return await requestWithoutRecovery<T>(path, withCredentials)
    } catch (error) {
      if (!isRecoverableAuthGet(path, requestOptions) || !isUnauthorized(error)) throw error
      return await retryAfterRefresh(path, withCredentials, error, deadline)
    } finally {
      deadline.dispose()
    }
  }

  async function retryAfterRefresh<T>(
    path: string,
    requestOptions: ApiRequestOptions,
    originalError: ApiError,
    deadline: Deadline,
  ): Promise<T> {
    const sharedRefresh = getOrStartRefresh(path, requestOptions)
    try {
      await awaitWithSignal(sharedRefresh, deadline.signal)
      return await requestWithoutRecovery<T>(path, requestOptions)
    } catch (error) {
      if (isUnauthorized(error)) {
        terminalAuthFailure ??= originalError
        throw terminalAuthFailure
      }
      throw error
    }
  }

  function getOrStartRefresh(path: string, requestOptions: ApiRequestOptions): Promise<void> {
    if (refreshPromise) return refreshPromise
    const sharedOptions = withoutDeadline(requestOptions)
    const created = withRefreshLock(async () => {
      try {
        await requestWithoutRecovery(path, sharedOptions)
        return
      } catch (error) {
        if (!isUnauthorized(error)) throw error
      }
      await rawAuth.refresh(await csrfOptions({}, 'session'))
    })
    refreshPromise = created
    void created.then(
      () => {
        if (refreshPromise === created) refreshPromise = undefined
      },
      () => {
        if (refreshPromise === created) refreshPromise = undefined
      },
    )
    return created
  }

  async function csrfOptions(
    options: Omit<AuthMutationOptions, 'csrfToken'> = {},
    scope: 'preauth' | 'session' = 'session',
  ): Promise<AuthMutationOptions> {
    const cookieName = scope === 'preauth' ? preauthCsrfCookieName : sessionCsrfCookieName
    const token = readCsrfToken(getCookie(), cookieName)
    if (token) return { ...options, csrfToken: token, credentials: 'include' }
    if (scope === 'session') {
      throw new TypeError('Expected exactly one readable session CSRF cookie')
    }
    await rawAuth.csrf({ credentials: 'include', cache: 'no-store' })
    const preauthToken = readCsrfToken(getCookie(), preauthCsrfCookieName)
    if (!preauthToken)
      throw new TypeError('Expected exactly one readable pre-authentication CSRF cookie')
    return { ...options, csrfToken: preauthToken, credentials: 'include' }
  }

  return {
    request,
    auth: {
      csrf: (requestOptions) =>
        rawAuth.csrf({ ...requestOptions, credentials: 'include', cache: 'no-store' }),
      me: (requestOptions) =>
        request('/api/v1/auth/me', { ...requestOptions, method: 'GET', cache: 'no-store' }),
      sessions: (requestOptions) =>
        request('/api/v1/auth/sessions', { ...requestOptions, method: 'GET', cache: 'no-store' }),
      login: async (input, requestOptions) => {
        const result = await rawAuth.login(input, await csrfOptions(requestOptions, 'preauth'))
        terminalAuthFailure = undefined
        return result
      },
      logout: async (requestOptions) => {
        await rawAuth.logout(await csrfOptions(requestOptions, 'session'))
        terminalAuthFailure = loggedOutError()
      },
      changePassword: async (input, requestOptions) => {
        await rawAuth.changePassword(input, await csrfOptions(requestOptions, 'session'))
        terminalAuthFailure = loggedOutError()
      },
      forgotPassword: async (input, requestOptions) =>
        rawAuth.forgotPassword(input, await csrfOptions(requestOptions, 'preauth')),
      resetPassword: async (input, requestOptions) =>
        rawAuth.resetPassword(input, await csrfOptions(requestOptions, 'preauth')),
      confirmRecentAuthentication: async (input, requestOptions) =>
        rawAuth.confirmRecentAuthentication(input, await csrfOptions(requestOptions, 'session')),
      refresh: async (requestOptions) =>
        rawAuth.refresh(await csrfOptions(requestOptions, 'session')),
      register: async (input, requestOptions) =>
        rawAuth.register(input, await csrfOptions(requestOptions, 'preauth')),
      revokeAllSessions: async (requestOptions) => {
        await rawAuth.revokeAllSessions(await csrfOptions(requestOptions, 'session'))
        terminalAuthFailure = loggedOutError()
      },
      revokeSession: async (sessionId, requestOptions) =>
        rawAuth.revokeSession(sessionId, await csrfOptions(requestOptions, 'session')),
      resendVerification: async (input, requestOptions) =>
        rawAuth.resendVerification(input, await csrfOptions(requestOptions, 'preauth')),
      verifyEmail: async (input, requestOptions) =>
        rawAuth.verifyEmail(input, await csrfOptions(requestOptions, 'preauth')),
    },
  }
}

function validateBrowserBaseUrl(baseUrl: string): void {
  if (typeof location === 'undefined') {
    throw new TypeError('Browser API client requires a browser origin')
  }
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new TypeError('Browser API client baseUrl must be an absolute same-origin URL')
  }
  if (
    url.origin !== location.origin ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new TypeError('Browser API client baseUrl must be the same-origin root URL')
  }
}

function loggedOutError(): ApiError {
  return new ApiError(401, new Response(null, { status: 401 }))
}

interface Deadline {
  readonly signal?: AbortSignal
  dispose(): void
}

function createDeadline(requestOptions: ApiRequestOptions, defaultTimeoutMs: number): Deadline {
  const timeoutMs = requestOptions.timeoutMs ?? defaultTimeoutMs
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError('timeoutMs must be a non-negative finite number')
  }
  const timeoutController = timeoutMs > 0 ? new AbortController() : undefined
  const timeoutId = timeoutController
    ? setTimeout(
        () => timeoutController.abort(new DOMException('API request timed out', 'TimeoutError')),
        timeoutMs,
      )
    : undefined
  const signals = [requestOptions.signal, timeoutController?.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined && signal !== null,
  )
  return {
    ...(signals.length > 0
      ? { signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }
      : {}),
    dispose: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    },
  }
}

function withDeadline<T extends ApiRequestOptions>(options: T, deadline: Deadline): T {
  if (!deadline.signal) return options
  return { ...options, signal: deadline.signal, timeoutMs: 0 }
}

function withoutDeadline(options: ApiRequestOptions): ApiRequestOptions {
  const { signal: _signal, timeoutMs: _timeoutMs, ...requestOptions } = options
  return requestOptions
}

function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function isRecoverableAuthGet(path: string, options: ApiRequestOptions): boolean {
  if ((options.method ?? 'GET').toUpperCase() !== 'GET') return false
  return ['/api/v1/auth/me', '/api/v1/auth/sessions'].includes(`/${path.replace(/^\/+/, '')}`)
}

function isUnauthorized(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401
}

function defaultCookieName(suffix: string): string {
  return typeof location !== 'undefined' && location.protocol === 'https:'
    ? `__Host-${suffix}`
    : suffix
}

function defaultCookieReader(): string {
  if (typeof document === 'undefined')
    throw new TypeError('Browser CSRF requests require a cookie reader')
  return document.cookie
}

export function readCsrfToken(cookieHeader: string, name: string): string | undefined {
  const matches = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${name}=`))
  if (matches.length !== 1) return undefined
  const [match] = matches
  if (!match) return undefined
  const encodedValue = match.slice(name.length + 1)
  if (!encodedValue) return undefined
  try {
    return decodeURIComponent(encodedValue)
  } catch {
    return undefined
  }
}

function toApiClientOptions(options: BrowserAuthApiOptions): ApiClientOptions {
  return {
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  }
}

async function withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
  const browserLocks =
    typeof navigator === 'undefined' ? undefined : Reflect.get(navigator, 'locks')
  if (!isLockManager(browserLocks)) return operation()
  return browserLocks.request('cornerstone-auth-refresh', operation)
}

function isLockManager(
  value: unknown,
): value is { request<T>(name: string, callback: () => Promise<T>): Promise<T> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'request') === 'function'
  )
}
