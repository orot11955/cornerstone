import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const routes = [
  ['/login', 'login.chromium'],
  ['/settings/profile', 'profile.chromium'],
  ['/examples/resources', 'resources.chromium'],
  ['/dashboard', 'dashboard.chromium'],
]

test('reference route fixture annotation은 inventory automatic ID와 상태를 유지한다', async () => {
  const inventory = JSON.parse(
    await readFile(
      new URL('../../../packages/ui/release/component-inventory.v1.json', import.meta.url),
      'utf8',
    ),
  )
  for (const [route, automaticId] of routes) {
    const file = new URL(`src/app${route}/page.tsx`, root)
    const source = await readFile(file, 'utf8')
    const manifestRoute = inventory.referenceRoutes.find((item) => item.path === route)
    assert.ok(manifestRoute)
    assert.ok(manifestRoute.automatic.includes(automaticId))
    assert.match(source, new RegExp(`route=\"${route.replace('/', '\\/')}\"`))
    assert.match(source, new RegExp(`automaticId=\"${automaticId.replace('.', '\\.')}\"`))
    for (const state of manifestRoute.states) assert.match(source, new RegExp(`['\"]${state}['\"]`))
  }
})

test('reference app은 fixture-only이며 HTTP, auth client와 domain stylesheet를 포함하지 않는다', async () => {
  const source = await Promise.all(
    routes.map(([route]) => readFile(new URL(`src/app${route}/page.tsx`, root), 'utf8')),
  )
  for (const page of source) {
    assert.doesNotMatch(page, /\b(fetch|axios|auth|api client)\b/i)
  }
})
