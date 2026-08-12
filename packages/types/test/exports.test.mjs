import assert from 'node:assert/strict'
import test from 'node:test'

test('type-only package has a runtime-safe root export', async () => {
  assert.deepEqual(Object.keys(await import('../dist/index.js')), [])
})
