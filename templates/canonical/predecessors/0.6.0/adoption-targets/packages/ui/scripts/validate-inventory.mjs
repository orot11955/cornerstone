import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const inventory = JSON.parse(
  await readFile(new URL('../release/component-inventory.v1.json', import.meta.url), 'utf8'),
)

assert.equal(inventory.schemaVersion, 1)
assert.equal(inventory.release, 'core-v1')
assert.ok(Array.isArray(inventory.components) && inventory.components.length > 0)
assert.ok(Array.isArray(inventory.referenceRoutes) && inventory.referenceRoutes.length === 4)

const ids = new Set()
const exportsByEntrypoint = new Set()
for (const component of inventory.components) {
  assert.match(component.id, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  assert.ok(!ids.has(component.id), `duplicate component id: ${component.id}`)
  ids.add(component.id)
  assert.ok(['UIF', 'M7', 'M7A', 'excluded'].includes(component.milestone))
  assert.ok(['core', 'preview', 'planned', 'deprecated', 'excluded'].includes(component.status))
  assert.ok(Array.isArray(component.acceptance))
  if (component.status === 'excluded') {
    assert.equal(component.export, null)
    assert.equal(component.entrypoint, null)
  } else {
    assert.match(component.export, /^[A-Z][A-Za-z0-9]*$/)
    assert.ok(['.', './browser'].includes(component.entrypoint))
    const exportKey = `${component.entrypoint}:${component.export}`
    assert.ok(!exportsByEntrypoint.has(exportKey), `duplicate component export: ${exportKey}`)
    exportsByEntrypoint.add(exportKey)
  }
  if (component.status === 'core') assert.ok(component.acceptance.length > 0)
  if (component.status === 'preview') {
    assert.equal(component.milestone, 'M7')
    assert.equal(component.entrypoint, './browser')
    assert.ok(component.acceptance.length > 0)
  }
}

const routePaths = new Set()
for (const route of inventory.referenceRoutes) {
  assert.match(route.path, /^\/(?:[a-z][a-z0-9-]*)(?:\/[a-z][a-z0-9-]*)*$/)
  assert.ok(!routePaths.has(route.path), `duplicate reference route: ${route.path}`)
  routePaths.add(route.path)
  assert.ok(route.components.length > 0)
  for (const id of route.components) assert.ok(ids.has(id), `unknown route component: ${id}`)
  assert.ok(route.states.length > 0)
  assert.ok(route.automatic.length > 0)
  assert.ok(route.manual.length > 0)
}

console.log(
  `UI component inventory: OK (${inventory.components.length} components, ${inventory.referenceRoutes.length} routes)`,
)
