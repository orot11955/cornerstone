import assert from 'node:assert/strict'
import test from 'node:test'

test('generated project is ready', async () => {
  assert.equal((await import('../dist/index.js')).cornerstoneProject, true)
})
