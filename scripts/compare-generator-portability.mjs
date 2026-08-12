import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const expectedPlatforms = ['darwin', 'linux', 'win32']

export function comparePortabilityReports(reports) {
  if (reports.length !== expectedPlatforms.length) {
    throw new Error(`Expected exactly ${expectedPlatforms.length} portability reports`)
  }
  const platforms = reports.map((report) => report.platform?.os).sort()
  if (JSON.stringify(platforms) !== JSON.stringify(expectedPlatforms)) {
    throw new Error(`Portability platforms must be unique and exact: ${platforms.join(',')}`)
  }
  for (const report of reports) {
    if (
      report.schemaVersion !== 1 ||
      report.gate !== 'standard-candidate' ||
      report.status !== 'passed' ||
      report.lineEndings?.composerOwned !== 'LF' ||
      report.lineEndings?.status !== 'passed' ||
      !/^sha256:[a-f0-9]{64}$/.test(report.byteStableDigest ?? '')
    ) {
      throw new Error(`Invalid ${report.platform?.os ?? 'unknown'} portability report`)
    }
  }
  const digests = new Set(reports.map((report) => report.byteStableDigest))
  if (digests.size !== 1)
    throw new Error('Generator output digest differs across operating systems')
  return {
    schemaVersion: 1,
    gate: 'generator-portability-comparison',
    platforms,
    lineEndings: 'LF',
    byteStableDigest: reports[0].byteStableDigest,
    status: 'passed',
  }
}

function findReports(directory) {
  const paths = []
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name === 'standard-candidate-report.json') paths.push(path)
    }
  }
  visit(directory)
  return paths.sort()
}

function fixture(platform, overrides = {}) {
  return {
    schemaVersion: 1,
    gate: 'standard-candidate',
    status: 'passed',
    platform: { os: platform },
    lineEndings: { composerOwned: 'LF', status: 'passed' },
    byteStableDigest: `sha256:${'a'.repeat(64)}`,
    ...overrides,
  }
}

function runSelfTest() {
  const valid = expectedPlatforms.map((platform) => fixture(platform))
  assert.equal(comparePortabilityReports(valid).status, 'passed')
  assert.throws(() => comparePortabilityReports(valid.slice(0, 2)), /exactly 3/)
  assert.throws(
    () => comparePortabilityReports([fixture('linux'), fixture('linux'), fixture('win32')]),
    /unique and exact/,
  )
  assert.throws(
    () =>
      comparePortabilityReports(
        expectedPlatforms.map((platform) =>
          fixture(platform, platform === 'linux' ? { status: 'failed' } : {}),
        ),
      ),
    /Invalid linux/,
  )
  console.log('Generator portability comparison self-test: OK')
}

if (process.argv.includes('--self-test')) {
  runSelfTest()
} else {
  const input = resolve(process.argv[2] ?? '.artifacts/generator-portability')
  if (!existsSync(input)) throw new Error(`Portability report directory does not exist: ${input}`)
  const paths = findReports(input)
  const result = comparePortabilityReports(
    paths.map((path) => JSON.parse(readFileSync(path, 'utf8'))),
  )
  const output = resolve('.artifacts/generator/portability-comparison.json')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify({ ...result, reports: paths }, null, 2)}\n`)
  console.log(`Generator portability comparison: OK (${result.platforms.join(', ')})`)
}
