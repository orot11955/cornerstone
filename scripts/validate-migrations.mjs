import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

const directory = 'apps/api/src/database/migrations'
const migrationName = /^\d{13}-[A-Z][A-Za-z0-9]*\.ts$/
const phases = new Set(['expand', 'backfill', 'contract'])
const transactions = new Set(['each', 'all', 'none'])
const lockRisks = new Set(['low', 'medium', 'high'])
const errors = []

function requireNonEmptyStrings(metadata, field, file) {
  if (
    !Array.isArray(metadata[field]) ||
    metadata[field].length === 0 ||
    metadata[field].some((value) => typeof value !== 'string' || !value.trim())
  ) {
    errors.push(`${file}: ${field} must be a non-empty string array`)
  }
}

for (const file of readdirSync(directory).filter((name) => name.endsWith('.ts'))) {
  if (!migrationName.test(file)) {
    errors.push(`${file}: expected <13-digit epoch milliseconds>-<PascalName>.ts`)
    continue
  }

  const stem = basename(file, '.ts')
  const metadataFile = join(directory, `${stem}.metadata.json`)
  if (!existsSync(metadataFile)) {
    errors.push(`${file}: missing ${stem}.metadata.json`)
    continue
  }

  let metadata
  try {
    metadata = JSON.parse(readFileSync(metadataFile, 'utf8'))
  } catch {
    errors.push(`${metadataFile}: invalid JSON`)
    continue
  }

  if (metadata.schemaVersion !== 1) {
    errors.push(`${metadataFile}: schemaVersion must be 1`)
  }
  if (metadata.migrationTimestamp !== Number(stem.slice(0, 13))) {
    errors.push(`${metadataFile}: migrationTimestamp must match the filename`)
  }
  if (!phases.has(metadata.phase)) {
    errors.push(`${metadataFile}: invalid phase`)
  }
  if (!transactions.has(metadata.transaction)) {
    errors.push(`${metadataFile}: invalid transaction`)
  }
  if (!lockRisks.has(metadata.lockRisk)) {
    errors.push(`${metadataFile}: invalid lockRisk`)
  }
  if (
    !Number.isInteger(metadata.estimatedDurationSeconds) ||
    metadata.estimatedDurationSeconds < 0
  ) {
    errors.push(`${metadataFile}: estimatedDurationSeconds must be non-negative`)
  }
  if (
    !Number.isInteger(metadata.statementTimeoutMs) ||
    metadata.statementTimeoutMs < 100 ||
    metadata.statementTimeoutMs > 300_000
  ) {
    errors.push(`${metadataFile}: statementTimeoutMs must be 100..300000`)
  }
  if (metadata.lockRisk === 'high' && !metadata.operationsApproval) {
    errors.push(`${metadataFile}: high-risk migration requires operationsApproval`)
  }
  if (typeof metadata.rollback !== 'string' || !metadata.rollback.trim()) {
    errors.push(`${metadataFile}: rollback is required`)
  }

  requireNonEmptyStrings(metadata, 'compatibleAppReleases', metadataFile)
  requireNonEmptyStrings(metadata, 'abortConditions', metadataFile)
  requireNonEmptyStrings(metadata, 'verification', metadataFile)

  const source = readFileSync(join(directory, file), 'utf8')
  if (/\btenant_id\b|\bmemberships?\b/i.test(source)) {
    errors.push(`${file}: single-tenant Core must not define tenant/membership schema`)
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log('Migration metadata check: OK')
