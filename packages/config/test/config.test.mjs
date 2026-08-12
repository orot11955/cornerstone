import assert from 'node:assert/strict'
import test from 'node:test'
import { definePublicConfig } from '../dist/index.js'
import { readBooleanEnv, readRequiredEnv } from '../dist/server.js'

test('freezes public values and keeps server readers off the root entry', async () => {
  assert.equal(Object.isFrozen(definePublicConfig({ apiVersion: 'v1' })), true)
  assert.equal('readRequiredEnv' in (await import('../dist/index.js')), false)
})

test('validates server environment values without implicit coercion', () => {
  assert.equal(readRequiredEnv({ TOKEN: ' value ' }, 'TOKEN'), 'value')
  assert.equal(readBooleanEnv({ ENABLED: 'false' }, 'ENABLED', true), false)
  assert.throws(() => readBooleanEnv({ ENABLED: '1' }, 'ENABLED', false))
})
