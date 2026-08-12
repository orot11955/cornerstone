import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

for (const filename of ['base.json', 'node.json', 'nest.json', 'react.json']) {
  test(`${filename} is valid JSON`, async () => {
    const config = JSON.parse(await readFile(new URL(`../${filename}`, import.meta.url), 'utf8'))
    assert.equal(typeof config.compilerOptions, 'object')
  })
}
