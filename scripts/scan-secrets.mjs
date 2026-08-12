import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const patterns = [
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['GitHub token', /\b(?:github_pat_[A-Za-z0-9_]{50,255}|gh[pousr]_[A-Za-z0-9]{36,255})\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/g],
  ['Slack token', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
]

function runGit(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

  if (result.status !== 0) {
    console.error(result.stderr.trim())
    process.exit(result.status ?? 1)
  }

  return result.stdout
}

function runGitAllowNoMatch(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

  if (result.status === 1) return ''
  if (result.status !== 0) {
    console.error(result.stderr.trim() || `git ${args[0]} failed`)
    process.exit(result.status ?? 1)
  }

  return result.stdout
}

function redact(value) {
  if (value.length <= 12) return '[redacted]'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

function scan(label, content) {
  const findings = []
  for (const [name, expression] of patterns) {
    expression.lastIndex = 0
    for (const match of content.matchAll(expression)) {
      findings.push(`${label}: ${name} ${redact(match[0])}`)
    }
  }
  return findings
}

if (process.argv.includes('--self-test')) {
  const fixture = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')
  if (scan('self-test', fixture).length !== 1) {
    console.error('Secret scanner self-test failed')
    process.exit(1)
  }
  console.log('Secret scanner self-test: OK')
}

const findings = []
const trackedFiles = runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  .split('\0')
  .filter(Boolean)

for (const file of trackedFiles) {
  if (!existsSync(file)) continue
  const content = readFileSync(file)
  if (content.includes(0) || content.length > 2 * 1024 * 1024) continue
  findings.push(...scan(file, content.toString('utf8')))
}

if (process.argv.includes('--history')) {
  const revisions = runGit(['rev-list', '--all']).trim().split('\n').filter(Boolean)
  const history = runGitAllowNoMatch([
    'grep',
    '-I',
    '-n',
    '-E',
    'AKIA|ASIA|github_pat_|gh[pousr]_|AIza|npm_|xox[baprs]-|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY',
    ...revisions,
    '--',
    '.',
    ':(exclude,glob)**/pnpm-lock.yaml',
    ':(exclude,glob)**/node_modules/**',
    ':(exclude,glob)**/.next/**',
    ':(exclude,glob)**/dist/**',
    ':(exclude,glob)**/.turbo/**',
  ])
  findings.push(...scan('git-history', history))
}

if (findings.length > 0) {
  console.error(findings.join('\n'))
  process.exit(1)
}

console.log(`Secret scan: OK (${trackedFiles.length} worktree files)`)
