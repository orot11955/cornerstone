import assert from 'node:assert/strict'

export const standardPolicy = {
  allowedCapabilities: ['api', 'auth', 'database', 'ui', 'web'],
  exactFragments: ['api', 'auth', 'base', 'database', 'ui', 'web'],
  exactWorkspaces: [
    '@cornerstone/api-client',
    '@cornerstone/config',
    '@cornerstone/eslint-config',
    '@cornerstone/schemas',
    '@cornerstone/tsconfig',
    '@cornerstone/types',
    '@cornerstone/ui',
    '@cornerstone/utils',
    'api',
    'web',
  ],
  unselectedCapabilities: {
    observability: {
      paths: [
        /^infra\/observability(?:\/|$)/i,
        /^packages\/observability(?:\/|$)/i,
        /^apps\/api\/src\/observability\/providers(?:\/|$)/i,
      ],
      modules: ['@opentelemetry/api', '@sentry/node', '@sentry/nextjs'],
      environmentKeys: ['OTEL_EXPORTER_OTLP_ENDPOINT', 'SENTRY_DSN'],
      composeServices: ['grafana', 'jaeger', 'otel-collector', 'prometheus', 'tempo'],
      ciMarkers: ['enable-observability-capability', 'otel-collector', 'sentry-release'],
      documentPaths: [/^docs\/observability(?:\/|\.)/i],
      documentMarkers: ['enable-observability-capability'],
    },
    privacy: {
      paths: [/(^|\/)privacy(?:\/|\.|$)/i],
      modules: ['@cornerstone/privacy'],
      environmentKeys: ['PRIVACY_PROVIDER', 'DATA_RESIDENCY_REGION'],
      composeServices: ['privacy-worker'],
      ciMarkers: ['enable-privacy-capability', 'privacy-worker'],
      documentPaths: [/^docs\/privacy(?:\/|\.)/i],
      documentMarkers: ['enable-privacy-capability'],
    },
  },
}

export function validateStandardInventory(inventory) {
  const violations = []
  compareExact(
    violations,
    'resolved-capability-set',
    inventory.capabilities,
    standardPolicy.allowedCapabilities,
  )
  compareExact(
    violations,
    'exact-fragment-set',
    inventory.fragmentIds,
    standardPolicy.exactFragments,
  )
  compareExact(
    violations,
    'exact-workspace-set',
    inventory.workspaceNames,
    standardPolicy.exactWorkspaces,
  )

  for (const [capability, forbidden] of Object.entries(standardPolicy.unselectedCapabilities)) {
    if (inventory.fragmentIds.includes(capability))
      add(violations, capability, 'fragment', capability)
    for (const file of inventory.files) {
      if (forbidden.paths.some((pattern) => pattern.test(file)))
        add(violations, capability, 'path', file)
    }
    for (const dependency of inventory.dependencies) {
      if (forbidden.modules.includes(dependency.name))
        add(violations, capability, 'dependency', `${dependency.owner}:${dependency.name}`)
    }
    for (const [file, keys] of Object.entries(inventory.environmentKeys)) {
      for (const key of keys) {
        if (forbidden.environmentKeys.includes(key))
          add(violations, capability, 'environment', `${file}:${key}`)
      }
    }
    for (const service of inventory.composeServices) {
      if (forbidden.composeServices.includes(service))
        add(violations, capability, 'compose-service', service)
    }
    for (const marker of forbidden.ciMarkers) {
      if (inventory.ci.toLowerCase().includes(marker.toLowerCase()))
        add(violations, capability, 'ci-marker', marker)
    }
    for (const document of inventory.documents) {
      if (forbidden.documentPaths.some((pattern) => pattern.test(document.path)))
        add(violations, capability, 'document-path', document.path)
      for (const marker of forbidden.documentMarkers) {
        if (document.content.toLowerCase().includes(marker.toLowerCase()))
          add(violations, capability, 'document-marker', `${document.path}:${marker}`)
      }
    }
  }
  return violations.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

function compareExact(violations, kind, actual, expected) {
  const normalizedActual = [...actual].sort()
  const normalizedExpected = [...expected].sort()
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    violations.push({ kind, value: normalizedActual.join(',') })
  }
}

function add(violations, capability, kind, value) {
  violations.push({ capability, kind, value })
}

function validFixture() {
  return {
    capabilities: [...standardPolicy.allowedCapabilities],
    fragmentIds: [...standardPolicy.exactFragments],
    workspaceNames: [...standardPolicy.exactWorkspaces],
    files: ['apps/api/package.json', 'apps/web/package.json'],
    dependencies: [],
    environmentKeys: {
      'apps/api/.env.example': ['DATABASE_URL'],
      'apps/web/.env.example': ['SITE_URL'],
    },
    composeServices: ['postgres'],
    ci: 'jobs:\n  quality:\n',
    documents: [{ path: 'docs/adr/0017-release-gates.md', content: 'Standard candidate' }],
  }
}

function runSelfTest() {
  assert.deepEqual(validateStandardInventory(validFixture()), [])
  const injections = [
    ['observability path', (value) => value.files.push('infra/observability/collector.yml')],
    [
      'observability dependency',
      (value) => value.dependencies.push({ owner: 'api', name: '@opentelemetry/api' }),
    ],
    [
      'observability env',
      (value) => value.environmentKeys['apps/api/.env.example'].push('SENTRY_DSN'),
    ],
    ['observability service', (value) => value.composeServices.push('otel-collector')],
    [
      'observability docs',
      (value) => value.documents.push({ path: 'docs/observability.md', content: 'optional' }),
    ],
    ['privacy path', (value) => value.files.push('packages/privacy/src/index.ts')],
    [
      'privacy dependency',
      (value) => value.dependencies.push({ owner: 'api', name: '@cornerstone/privacy' }),
    ],
    [
      'privacy env',
      (value) => value.environmentKeys['apps/api/.env.example'].push('PRIVACY_PROVIDER'),
    ],
    ['privacy service', (value) => value.composeServices.push('privacy-worker')],
    [
      'privacy docs',
      (value) => value.documents.push({ path: 'docs/privacy.md', content: 'optional' }),
    ],
  ]
  for (const [label, inject] of injections) {
    const fixture = structuredClone(validFixture())
    inject(fixture)
    assert.ok(validateStandardInventory(fixture).length > 0, `${label} residue was accepted`)
  }
  const wrongCapabilities = validFixture()
  wrongCapabilities.capabilities.push('observability')
  assert.ok(validateStandardInventory(wrongCapabilities).length > 0)
  console.log('Standard candidate residue policy self-test: OK')
}

if (process.argv.includes('--self-test')) runSelfTest()
