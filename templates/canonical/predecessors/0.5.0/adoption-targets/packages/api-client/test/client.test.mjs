import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, createApiClient, createAuthApi } from '../dist/index.js'
import { createBrowserAuthApi, readCsrfToken } from '../dist/browser.js'

Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: new URL('https://api.example.test'),
})

test('encodes query, headers and JSON body deterministically with manual redirects', async () => {
  let captured
  const request = createApiClient({
    baseUrl: 'https://api.example.test/v1',
    timeoutMs: 100,
    fetch: async (input, init) => {
      captured = { input: String(input), init }
      return Response.json({ ok: true })
    },
  })

  assert.deepEqual(await request('/users', { query: { q: '한 글', page: 1 } }), { ok: true })
  assert.equal(captured.input, 'https://api.example.test/v1/users?page=1&q=%ED%95%9C+%EA%B8%80')
  assert.equal(captured.init.redirect, 'manual')
})

test('does not follow an HTTP redirect', async () => {
  const request = createApiClient({
    baseUrl: 'https://api.example.test',
    timeoutMs: 0,
    fetch: async (_input, init) => {
      assert.equal(init.redirect, 'manual')
      return new Response(null, {
        status: 302,
        headers: { location: 'https://other.example.test' },
      })
    },
  })
  await assert.rejects(
    request('/redirect'),
    (error) => error instanceof ApiError && error.status === 302,
  )
})

test('browser client accepts only the same-origin root URL', () => {
  const options = {
    timeoutMs: 0,
    getCookie: () => '__Host-cs_csrf=session-csrf',
    fetch: async () => Response.json({ ok: true }),
  }
  assert.doesNotThrow(() =>
    createBrowserAuthApi({ ...options, baseUrl: 'https://api.example.test' }),
  )
  for (const baseUrl of [
    'http://api.example.test',
    'https://api.example.test:444',
    'https://other.example.test',
    'https://user@api.example.test',
    'https://api.example.test/api',
  ]) {
    assert.throws(() => createBrowserAuthApi({ ...options, baseUrl }), /same-origin root URL/)
  }
})

test('rejects URL and base-path escapes before making a request', async () => {
  assert.throws(() => createApiClient({ baseUrl: '/api' }), /absolute HTTP\(S\)/)
  assert.throws(
    () => createApiClient({ baseUrl: 'https://api.example.test/v1?unsafe=true' }),
    /without query or hash/,
  )

  const request = createApiClient({
    baseUrl: 'https://api.example.test/v1',
    timeoutMs: 0,
    fetch: async () => Response.json({ ok: true }),
  })
  for (const path of [
    'https://other.example.test',
    '//other.example.test',
    '../users',
    'users?x=1',
    'users#x',
    'users\\x',
  ]) {
    await assert.rejects(request(path), TypeError)
  }
  await assert.rejects(request('/users', { redirect: 'follow' }), /manual redirect/)
})

test('merges a caller AbortSignal with the client timeout and exposes non-success responses', async () => {
  const controller = new AbortController()
  const request = createApiClient({
    baseUrl: 'https://api.example.test',
    timeoutMs: 100,
    fetch: async (_input, init) => {
      assert.notEqual(init.signal, controller.signal)
      assert.equal(init.signal?.aborted, false)
      return new Response(null, { status: 409 })
    },
  })
  await assert.rejects(request('/conflict', { signal: controller.signal }), ApiError)
})

test('propagates a caller abort to an in-flight request', async () => {
  const controller = new AbortController()
  const request = createApiClient({
    baseUrl: 'https://api.example.test',
    timeoutMs: 0,
    fetch: async (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
      }),
  })
  const pending = request('/slow', { signal: controller.signal })
  controller.abort(new DOMException('Cancelled by caller', 'AbortError'))
  await assert.rejects(pending, (error) => error?.name === 'AbortError')
})

test('uses generated Auth API contracts and sets the CSRF header only for mutations', async () => {
  const calls = []
  const request = async (path, options) => {
    calls.push({ path, options })
    return { user: { id: 'user-1' } }
  }
  const auth = createAuthApi(request)
  await auth.me()
  await auth.login(
    { email: 'user@example.test', password: 'not-stored' },
    { csrfToken: 'csrf-value' },
  )
  await auth.revokeSession('session-1', { csrfToken: 'csrf-value' })

  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[1].options.headers.get('x-csrf-token'), 'csrf-value')
  assert.equal(calls[2].path, '/api/v1/auth/sessions/session-1')
  for (const sessionId of ['one/two', 'one\\two', '.', '..', '%2F', '%5C', '%2E', '%2E%2E', '%']) {
    assert.throws(
      () => auth.revokeSession(sessionId, { csrfToken: 'csrf-value' }),
      /safe path segment/,
    )
  }
})

test('reads only one exact readable CSRF cookie', () => {
  assert.equal(readCsrfToken('cs_csrf=value; other=x', 'cs_csrf'), 'value')
  assert.equal(readCsrfToken('wrong_cs_csrf=value', 'cs_csrf'), undefined)
  assert.equal(readCsrfToken('cs_csrf=one; cs_csrf=two', 'cs_csrf'), undefined)
  assert.equal(readCsrfToken('cs_csrf=%E0%A4%A', 'cs_csrf'), undefined)
})

test('browser client obtains CSRF from its cookie and retries only a safe GET after one refresh', async () => {
  let cookie = '__Host-cs_csrf=session-csrf'
  let meCalls = 0
  let refreshCalls = 0
  let mutationCalls = 0
  const client = createBrowserAuthApi({
    baseUrl: 'https://api.example.test',
    timeoutMs: 0,
    getCookie: () => cookie,
    fetch: async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/me')) {
        meCalls += 1
        if (meCalls < 3) return new Response(null, { status: 401 })
        return Response.json({ user: { id: 'user-1' } })
      }
      if (url.endsWith('/api/v1/auth/refresh')) {
        refreshCalls += 1
        assert.equal(init.headers.get('x-csrf-token'), 'session-csrf')
        return Response.json({ refreshed: true })
      }
      if (url.endsWith('/api/v1/auth/logout')) {
        mutationCalls += 1
        assert.equal(init.headers.get('x-csrf-token'), 'session-csrf')
        return new Response(null, { status: 401 })
      }
      throw new Error(`Unexpected URL: ${url}`)
    },
  })

  assert.deepEqual(await client.auth.me(), { user: { id: 'user-1' } })
  assert.equal(refreshCalls, 1)
  await assert.rejects(client.auth.logout(), ApiError)
  assert.equal(mutationCalls, 1)
  assert.equal(refreshCalls, 1)
  assert.equal(cookie, '__Host-cs_csrf=session-csrf')
})

test('same-tab concurrent GET recovery performs one refresh', async () => {
  let protectedRequests = 0
  let refreshCalls = 0
  let resolveRefresh
  const refreshStarted = new Promise((resolve) => {
    resolveRefresh = resolve
  })
  const client = createBrowserAuthApi({
    baseUrl: 'https://api.example.test',
    timeoutMs: 0,
    getCookie: () => '__Host-cs_csrf=session-csrf',
    fetch: async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/me')) {
        protectedRequests += 1
        if (protectedRequests <= 3) return new Response(null, { status: 401 })
        return Response.json({ user: { id: `user-${protectedRequests}` } })
      }
      if (url.endsWith('/api/v1/auth/refresh')) {
        refreshCalls += 1
        await refreshStarted
        return Response.json({ refreshed: true })
      }
      throw new Error(`Unexpected URL: ${url}`)
    },
  })

  const first = client.auth.me()
  const second = client.auth.me()
  await new Promise((resolve) => setTimeout(resolve, 0))
  resolveRefresh()
  assert.equal(refreshCalls, 1)
  assert.deepEqual(await Promise.all([first, second]), [
    { user: { id: 'user-4' } },
    { user: { id: 'user-5' } },
  ])
})

test('preserves refresh 5xx, network and retry errors while retaining original refresh 401', async () => {
  const scenarios = [
    { refresh: () => new Response(null, { status: 401 }), expectedStatus: 401 },
    { refresh: () => new Response(null, { status: 503 }), expectedStatus: 503 },
    {
      refresh: () => Promise.reject(new Error('network failed')),
      expectedMessage: 'network failed',
    },
    {
      refresh: () => Response.json({ refreshed: true }),
      retry: () => new Response(null, { status: 500 }),
      expectedStatus: 500,
    },
  ]

  for (const scenario of scenarios) {
    let meCalls = 0
    const client = createBrowserAuthApi({
      baseUrl: 'https://api.example.test',
      timeoutMs: 0,
      getCookie: () => '__Host-cs_csrf=session-csrf',
      fetch: async (input) => {
        const url = String(input)
        if (url.endsWith('/api/v1/auth/me')) {
          meCalls += 1
          if (meCalls <= 2) return new Response(null, { status: 401 })
          return scenario.retry?.() ?? Response.json({ user: { id: 'unused' } })
        }
        if (url.endsWith('/api/v1/auth/refresh')) return scenario.refresh()
        throw new Error(`Unexpected URL: ${url}`)
      },
    })
    await assert.rejects(client.auth.me(), (error) => {
      if (scenario.expectedStatus !== undefined) {
        return error instanceof ApiError && error.status === scenario.expectedStatus
      }
      return error instanceof Error && error.message === scenario.expectedMessage
    })
  }
})

test('terminal refresh 401 is retained for later safe GETs without another refresh', async () => {
  let meCalls = 0
  let refreshCalls = 0
  let readyCalls = 0
  const client = createBrowserAuthApi({
    baseUrl: 'https://api.example.test',
    timeoutMs: 0,
    getCookie: () => '__Host-cs_csrf=session-csrf',
    fetch: async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/me')) {
        meCalls += 1
        return new Response(null, { status: 401 })
      }
      if (url.endsWith('/api/v1/auth/refresh')) {
        refreshCalls += 1
        return new Response(null, { status: 401 })
      }
      if (url.endsWith('/api/v1/health/ready')) {
        readyCalls += 1
        return Response.json({ status: 'ok' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    },
  })

  const firstError = await client.auth.me().then(
    () => assert.fail('Expected terminal authentication failure'),
    (error) => error,
  )
  const secondError = await client.auth.me().then(
    () => assert.fail('Expected terminal authentication failure'),
    (error) => error,
  )
  assert.equal(secondError, firstError)
  assert.equal(meCalls, 2)
  assert.equal(refreshCalls, 1)
  assert.deepEqual(await client.request('/api/v1/health/ready'), { status: 'ok' })
  assert.equal(readyCalls, 1)
})

test('caller deadline stops only its wait while shared refresh remains available', async () => {
  let protectedRequests = 0
  let resolveRefresh
  const refreshStarted = new Promise((resolve) => {
    resolveRefresh = resolve
  })
  const client = createBrowserAuthApi({
    baseUrl: 'https://api.example.test',
    timeoutMs: 100,
    getCookie: () => '__Host-cs_csrf=session-csrf',
    fetch: async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/me')) {
        protectedRequests += 1
        if (protectedRequests <= 3) return new Response(null, { status: 401 })
        return Response.json({ user: { id: 'user-1' } })
      }
      if (url.endsWith('/api/v1/auth/refresh')) {
        await refreshStarted
        return Response.json({ refreshed: true })
      }
      throw new Error(`Unexpected URL: ${url}`)
    },
  })

  const first = client.auth.me({ timeoutMs: 100 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await assert.rejects(client.auth.me({ timeoutMs: 1 }), (error) => error?.name === 'TimeoutError')
  resolveRefresh()
  assert.deepEqual(await first, { user: { id: 'user-1' } })
})
