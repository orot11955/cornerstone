import { readFileSync, readdirSync } from 'node:fs'

const codeowners = readFileSync('.github/CODEOWNERS', 'utf8')
  .split('\n')
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter(Boolean)
  .map((line) => line.split(/\s+/))

const requiredOwnership = [
  '*',
  '/.github/',
  '/package.json',
  '/pnpm-lock.yaml',
  '/pnpm-workspace.yaml',
  '/turbo.json',
  '/scripts/',
  '/packages/',
  '/apps/api/src/config/',
  '/apps/api/src/auth/',
  '/apps/api/src/database/migrations/',
  '/docs/adr/',
]

const ownership = new Map(codeowners.map(([pattern, ...owners]) => [pattern, owners]))
const errors = []

for (const pattern of requiredOwnership) {
  const owners = ownership.get(pattern) ?? []
  if (owners.length === 0) {
    errors.push(`CODEOWNERS에 owner가 없는 필수 경로: ${pattern}`)
  }
}

const workflowFiles = readdirSync('.github/workflows', { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
  .map((entry) => `.github/workflows/${entry.name}`)

const immutableAction = /^\s*uses:\s*[^\s@]+@[0-9a-f]{40}(?:\s+#.*)?$/

for (const file of workflowFiles) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (line.includes('uses:') && !immutableAction.test(line)) {
      errors.push(`${file}:${index + 1} immutable SHA가 아닌 action 참조`)
    }
  })
}

const branchProtection = readFileSync('docs/governance/branch-protection.md', 'utf8')
for (const check of ['Quality', 'E2E', 'Security']) {
  if (!branchProtection.includes(`\`${check}\``)) {
    errors.push(`Branch Protection 문서에 required check 누락: ${check}`)
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(
  `Governance check: OK (${requiredOwnership.length} ownership rules, ${workflowFiles.length} workflows)`,
)
