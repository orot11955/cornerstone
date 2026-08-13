import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, createApiClient } from '../dist/index.js'

test('encodes query, headers and JSON body deterministically', async () => {
  let captured
  const request = createApiClient({
    baseUrl: 'https://api.example.test/v1',
    fetch: async (input, init) => {
      captured = { input: String(input), init }
      return Response.json({ ok: true })
    },
  })

  assert.deepEqual(await request('/users', { query: { q: '한 글', page: 1 } }), {
    ok: true,
  })
  assert.equal(captured.input, 'https://api.example.test/v1/users?page=1&q=%ED%95%9C+%EA%B8%80')
})

test('passes AbortSignal and exposes non-success responses', async () => {
  const controller = new AbortController()
  const request = createApiClient({
    baseUrl: 'https://api.example.test',
    fetch: async (_input, init) => {
      assert.equal(init.signal, controller.signal)
      return new Response(null, { status: 409 })
    },
  })
  await assert.rejects(request('/conflict', { signal: controller.signal }), ApiError)
})
