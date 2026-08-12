import assert from 'node:assert/strict'
import test from 'node:test'
import { createTypeScriptConfig } from '../index.js'

test('requires an explicit project root', () => {
  assert.throws(() => createTypeScriptConfig(), /tsconfigRootDir/)
})

test('creates node and browser flat configs', () => {
  assert.ok(createTypeScriptConfig({ tsconfigRootDir: import.meta.dirname }).length > 3)
  assert.ok(
    createTypeScriptConfig({
      tsconfigRootDir: import.meta.dirname,
      environment: 'browser',
    }).length > 3,
  )
})
