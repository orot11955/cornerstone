import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const config = JSON.parse(readFileSync(join(root, 'test-scope.json'), 'utf8'))
const task = process.argv[2]

if (!task || !config[task]) {
  console.error(`Unknown test task: ${task ?? '(missing)'}`)
  process.exit(1)
}

const manifests = ['apps', 'examples', 'packages'].flatMap((directory) =>
  readdirSync(join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = join(root, directory, entry.name, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      return [manifest.name, manifest]
    }),
)

const workspaceNames = new Set(manifests.map(([name]) => name))
const participants = new Set(config[task].participants)
const exclusions = config[task].excluded
const configuredNames = new Set([...participants, ...Object.keys(exclusions)])

for (const name of workspaceNames) {
  if (!configuredNames.has(name)) {
    console.error(`[test-scope] ${task}: ${name} has no participation decision`)
    process.exit(1)
  }
}

for (const name of configuredNames) {
  if (!workspaceNames.has(name)) {
    console.error(`[test-scope] ${task}: unknown workspace ${name}`)
    process.exit(1)
  }
}

for (const [name, manifest] of manifests) {
  const hasScript = Boolean(manifest.scripts?.[task])
  if (participants.has(name) !== hasScript) {
    console.error(
      `[test-scope] ${task}: ${name} must ${participants.has(name) ? 'define' : 'not define'} the script`,
    )
    process.exit(1)
  }
}

console.log(`[test-scope] ${task}`)
console.log(`  participants: ${[...participants].join(', ') || '(none)'}`)
for (const [name, reason] of Object.entries(exclusions)) {
  console.log(`  excluded: ${name} — ${reason}`)
}

if (process.argv.includes('--run') && participants.size > 0) {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(executable, ['exec', 'turbo', task], {
    cwd: root,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  process.exit(result.status ?? 1)
}
